# Stage 5 audit — pack-driven authoring, server-side required content, and review binding

Executed by the coding agent as a single stage. Reviewer: ChatGPT (auditor / technical auditor /
product controller / stage reviewer). Every number below was printed by a command that ran on this
machine; each section names the command or the assertion that produced it, so a claim can be
re-measured rather than re-believed. Where something was **inferred rather than executed, it says so
in those words.** Sections are added as the stage's phases complete; a section that is not yet here
means the phase has not been run, not that it passed.

This document does not calculate a project completion percentage. That is the reviewer's job.

**The one sentence this stage must not blur:** there is still no human-reviewed customer-safe Tamil
ceremonial release. Stage 5 builds the *machinery* that could carry one — a review binding that is
cryptographically tied to the exact bytes a reviewer looked at, a required-content engine that can
refuse a freeze, a maintenance surface with no browser door, and an editor whose section behaviour
comes from the release rather than from product code. The Tamil candidate at the end of this stage is
the same draft candidate it was at the start: `machine_assisted = true`, `human_reviewed = false`,
`customer_selectable = false`, and unapproved.

**Scope of the tranche this file records.** The controlling directive for this pass is the attached
`VIVAAHVARNAM — STAGE 5 CORE IMPLEMENTATION TRANCHE` file (26 349 bytes, sha256 beginning
`79a963f5`, read into this session as an attachment). It continues the numbered Stage 5 roadmap
directive (§0–§33) from §3 onward and stops before the §18 browser journeys. It states its own
stop conditions and its own prohibitions: no Stage 5 merge, no deployment, no remote Supabase, no
DueWeave changes, no fake human review, no Stage 6.

---

## 0. Starting state (§0 gate, re-measured this session)

| Fact | Measured value | How to re-measure |
| --- | --- | --- |
| Expected `origin/main` | `b4b2022c5cdb31c5b0256cc28345759761a62937` | `git rev-parse origin/main` |
| Stage 5 branch | `stage5/pack-driven-authoring-review` | `git branch --show-current` |
| Branch starting SHA / HEAD at §0 | `328f0e3fef5a39aa5f91182fb54bf0a97d717e69` — "test(stage4): make release mint assertion clean-stack safe" | `git rev-parse HEAD` |
| Upstream of the branch | `origin/main` (so a push must name a refspec; never `-u`) | `git rev-parse --abbrev-ref @{u}` |
| Working tree at §0 | clean apart from two untracked files: `pnpm-lock.yaml`, `pnpm-workspace.yaml` | `git status --short` |
| Migrations on disk | 18 (Stage 0–4 chains) | `ls supabase/migrations/*.sql \| wc -l` |
| Node / npm / git / Supabase CLI | v24.21.0 / 11.19.0 / 2.55.0 / 2.118.0 | `node -v; npm -v; git --version; supabase --version` |
| Local stack identity | `project_id = "localvivaahvarnam"` (`supabase/config.toml:20`); kong :54400, db :54401, inbucket :54403 | `grep project_id supabase/config.toml` |

Two untracked pnpm files are **deliberately left in place and never staged**, per the standing rule
that they remain untouched, untracked, unstaged and uncommitted.

## 0A. Recurring `pnpm` interference — findings for the opening state

**What was observed.** Before this stage's `npm ci`, the installed tree at
`node_modules/` had repeatedly been replaced by a `pnpm`-shaped tree between measurements during
earlier stages. Five substitutions were observed historically in this workspace.

**How a substitution is detected** (this is the only reliable instrument; the two shapes are not
interchangeable):

| Signal | npm tree | pnpm tree |
| --- | --- | --- |
| `node_modules/.package-lock.json` | present | absent |
| `node_modules/.pnpm/` | absent | present |
| `node_modules/.modules.yaml` | absent | present |
| `node_modules/vite` | real directory | symlink |

The check is a script outside the repository —
`../tools/installer-markers.sh` (i.e. `C:/Users/Pavithran R A/Documents/Qoder/2026-09-24/37be0a2a/tools/installer-markers.sh`)
— so that adding a file to the repo does not move `npm run product:check`'s scanned-file count, which
Stage 4's own assertions pin at 171. Every Node-dependent measurement in §1 and §16 is bracketed by
this check, before and after.

**Initiator: not identified — recorded as UNKNOWN.** Evidence gathered, and what it rules out:

* `pnpm` 11.18.0 has been installed globally on this host since 2026-08-01, so the capability was
  present for the whole life of the project.
* The repository declares **no** `packageManager` field, no `engines` pin, and no `.npmrc`
  `auto-install-peers`/`manage-package-manager-versions` setting that an npm/pnpm invocation would
  obey, so no in-repo instruction can explain a substitution.
* No task in this session's directive starts `pnpm`, and none of the repository's own scripts does.
* This host runs other agent sessions concurrently, and `DueWeave` shares the Docker daemon with this
  project's local stack, so an external process with access to a filesystem view of this directory is
  plausible. **That is an inference about the environment, not a measurement.** The directive for
  §0A asked for evidence sufficient to identify the initiating process; the evidence collected
  identifies the *mechanism* (an external `pnpm install` against this directory) and does **not**
  identify the process. Stating it that way rather than naming a culprit is the honest answer.

**Mitigation carried forward, not a fix.** Because the cause is outside this repository, the only
 defence available is measurement: restore with
`rm -rf node_modules dist && npm ci` when a substitution is found, and refuse to report any
Node-dependent gate number that was not bracketed by markers. A gate measured on a substituted tree is
not evidence. Global tooling, `PATH`, and other projects were **not** modified, and no unrelated
process was killed.

---

## 1. Stage 4 baseline reproduction — the OLD column

Re-measured on this machine on the Stage 5 branch at `328f0e3`, on a marker-verified **npm** tree
after `npm ci`, with the local stack running for the batteries that need it. These are the numbers
§16's CURRENT column is compared against. Nothing in this table is carried over from an earlier
session's memory: every row was re-run for this tranche.

| Gate | OLD (Stage 4 merge base) | Command |
| --- | --- | --- |
| Stage 0 RLS battery | **24** assertions, 0 failures | `bash supabase/tests/rls/run.sh` |
| Stage 2/3 battery, clean chain | **42 / 46 / 284 / 464 / 103** | `bash supabase/tests/stage2/run.sh both` |
| Stage 2/3 battery, legacy chain | **76 / 49 / 284 / 464 / 103** | same run, second chain |
| Stage 4 SQL battery, both chains | **426 + 57** | `bash supabase/tests/stage4/run.sh` |
| Local HTTP battery | **37 / 56 / 28**, 0 failures | `bash supabase/tests/api/run.sh` |
| ESLint | 0 errors, 8 warnings | `npm run lint` |
| TypeScript | pass | `npm run typecheck` |
| Generated DB types vs schema | 18 tables, 19 views, 0 findings | `npm run dbtypes:check` |
| Product contract | 23 rules over 171 files, 0 violations | `npm run product:check` |
| Unit + component tests | **355 tests in 24 files** | `npm test` |
| Production build | 2194 modules; entry `dist/assets/index-*.js` **491.21 kB / 148.31 kB gzip** | `npm run build` |
| Production advisories | exit **0** at `--audit-level=high`; `--audit-level=critical` exit **0** | `npm audit --omit=dev --audit-level=high` |
| Whitespace | clean | `git diff --check` |

Honesty notes on two of those rows, because both were mis-stated once while being measured:

* The audit figure "4 moderate" is **a count of lines in the report, not a count of advisories**, and
  is not repeated as a number above. Only the exit codes are claimed, and they were read from the
  command itself rather than from a pipe: an earlier attempt at this measurement reported the status
  of `tail`, which proves nothing.
* The build-size row moves on its own between runs (see *Stage 3 measurement instruments* in project
  memory), so it is bracketed by installer markers on both sides.

---

## 2. Architecture inventory — the fifteen questions, answered from the code

Each answer names the file and lines that were read, not a recollection. These are the facts §3 is
allowed to rely on.

**2.1 Does a release definition already have a versioned schema?** Yes.
`public.tradition_pack_releases.definition_schema_version` is a column with a CHECK `> 0`, and the
authoring guard refuses any value other than `1` with `definition schema version % is not understood
by this build` — `supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql:260-265`.

**2.2 What does a section already carry?** Eight authored fields, enumerated exactly by the guard:
`section_key, position, kind, required, host_field, heading, pack_text, allow_english_fallback`
(stage4 migration `:301-309`). A section carrying any other key is refused. The resolved output shape
is **13** fields and is pinned by a Stage 4 assertion (see 2.13).

**2.3 Who owns ordering?** SQL. `private.resolve_invitation_sections` emits
`ORDER BY (s->>'position')::integer` (`:909-111`), and Stage 4's S1/S4 assert that a release written
out of position order still resolves in declared order, and that two releases with the same five
slots in different positions produce different documents
(`supabase/tests/stage4/50_pack_release.sql:1993-2051`).

**2.4 Who owns required-content validation?** SQL, at freeze time, and only five arms today:
`private.invitation_freeze_issues` (`:986-1049`) reports (a) a required `text` section with no
resolved body, (b) an invitation language the release does not cover, (c) an unknown `kind`, (d) a
non-numeric `position`, (e) a `definition_schema_version` this build does not understand. **There is
no arm for a required `people_list` or `event_list` with zero rows** — that is gap G2 in §3.

**2.5 What does a frozen snapshot already record about provenance?** Per section: `body_source`,
`body_language`, `body_fallback_used`, `overrode_pack_text` (part of the 13-key resolved shape), plus
`heading_language` / `heading_fallback_used`. The snapshot's release block carries eleven keys and is
pinned exactly by `supabase/tests/api/stage4_tradition_packs.test.mjs:1058` (`SNAPSHOT_RELEASE_KEYS`).

**2.6 Is the lifecycle already enforced?** Yes, forward-only: draft → reviewed → approved →
deprecated, with `SQLSTATE 23514` for anything else (`:571-581`), plus per-transition metadata rules —
draft→reviewed requires `reviewed_at` (`:583-589`); reviewed→approved refuses any change to the
review sextet (`:591-603`); approved→deprecated refuses any change to the review record
(`:605-618`).

**2.7 Is history immutable?** Yes, in three overlapping arms: the content/provenance immutability
tuple fires once status leaves `draft` (`:550-562`), the review record is immutable on a non-status
UPDATE past draft (`:633-644`), and `DELETE` of any non-draft release is refused with
`restrict_violation` (`:228-234`).

**2.8 Can a browser author review state?** No. `no_client_write_tradition_pack_releases` /
`no_client_delete_…` (`:653-671`) plus column-level `GRANT SELECT (…)` (`:1551-1587`) and RLS.
The HTTP battery measures a forged version row and a forged release write both refused with
`42501` (`stage4_tradition_packs.test.mjs:1122-1138`).

**2.9 Are selection and freeze database-gated?** Both. `private.require_approved_pack_release()`
raises `42501` unless the row reads `approved` to the *calling* role (`:677-736`), and
`private.require_frozen_pack_release()` refuses a version whose release is not the wedding's current
selection (`23514`) and refuses a non-approved release (`42501`) (`:752-798`).

**2.10 Does the renderer read resolved sections or pack rows?** Resolved sections, exclusively.
`src/components/invitation/InvitationRenderer.tsx` branches on `section.kind` (`:219`, `:313`) and
`section.region` (`:312`, `:356-358`), and on nothing that identifies a pack.

**2.11 Where does the client touch the catalogue?** Only in
`src/integrations/supabase/traditionReleases.ts` — four `.from()` sites at `:93, :99, :152, :162`,
against explicit column lists, none of which include any review field. `scripts/check-product-contract.mjs:177`
already includes `tradition_packs|tradition_pack_releases` in the `.from()`-scatter pattern it
refuses outside that adapter, so §G's "fail such scattering" rule already exists and only needs its
allow-list to stay as narrow as it is.

**2.12 Does the client ever re-implement resolution?** Yes, in two places, and both are parity risks
that §I has to settle:
* `src/lib/traditionPackResolver.ts` — a browser-side re-implementation imported **only** by
  `src/test/traditionPackResolver.test.ts:17` and `src/test/traditionPackDraftCandidate.test.ts:26`.
  It exists to decide section behaviour in TypeScript, which is exactly what §C forbids as the
  production path.
* `withLocalProse` in `src/pages/EditProject.tsx:171-204` — a deliberate, documented mirror of
  `resolve_invitation_sections` whose only job is to paint *unsaved keystrokes* onto the canvas.
  Its doc comment names the SQL lines it mirrors.
* And a third: `normalizeInvitationSections` in `src/lib/invitationSections.ts:275-331` pushes
  `render.required_section_empty` / `render.required_list_empty` issues **in the browser**, while
  `internal_api.preview_invitation` (stage4 migration `:1489-1513`) returns no issues at all. So the
  host's "what is missing" list is computed where the freeze cannot see it. That is gap G5.

**2.13 What does Stage 4 already pin about shapes, that Stage 5 must not move?** Measured this
session, and load-bearing for every decision in §3:

| Pin | Assertion | Consequence |
| --- | --- | --- |
| A resolved section carries exactly 13 keys | `50_pack_release.sql:2058-2068` (`s4_universe` over the named set, then a count of `13`) | Stage 5 may **not** add a key to the resolver output. New authoring facts must be *obeyed*, not echoed. |
| The snapshot's release block carries exactly 11 keys | `stage4_tradition_packs.test.mjs:1057-1064` | Stage 5 may **not** add the review hash (or anything else) to the frozen release block. |
| `invitation_freeze_issues` returns `text[]`, and twenty-plus assertions compare it to an **exact array of exact sentences** | `50_pack_release.sql:2659, 2731, 2779-2810, 2843, 2864-2951, 3183` | Its prose and its ordering are a contract. Any refactor must reproduce them byte-for-byte for `definition_schema_version = 1`. |
| The resolution call closure is an exact ten-name list | `50_pack_release.sql:2104-2111` | A new `private.*` function reachable from those five entry points changes the list — and then §2.14's scanner picks it up automatically. |
| Exactly seven function bodies name the catalogue tables, and exactly one is EXECUTE-able by `authenticated` | `50_pack_release.sql:3847-3861` | Stage 5's maintenance functions necessarily re-list this inventory. The second half — one callable by a customer — is the guarantee and must survive. |
| `private.public_invitation_dto` returns NULL unless `p_snapshot_schema_version IS NOT DISTINCT FROM 2` and the snapshot matches a shape guard | stage4 migration `:1184-1202` | Bumping `snapshot_schema_version` would make every Stage 4 frozen document unreadable. It must stay 2 and grow only additively. |

**2.14 Is there a cultural-safety scanner already, and does it cover the database?** Yes, and it is
dynamic. `pg_temp.s4_cultural_hits` (`50_pack_release.sql:~1940-1969`) strips comments from a
function body and reports tests on `religion`, a `pack_key` compared to a literal, a
`tradition_pack_id` compared to a uuid literal, and script-specific layout assignments; `S8`
(`:2113-2120`) runs it over **every function in the resolution closure**, so a Stage 5 helper added to
that path is scanned without anyone editing the test. `S8b/8c/8d/8e` (`:2125-2142`) are its own
positive/negative controls. On the application side,
`scripts/check-product-contract.mjs:207-229` carries `tradition-pack-identity-branch` and
`tradition-selected-from-identity`.

**2.15 Is a SHA-256 computable inside the throwaway batteries?** Measured, because the review-hash
design depends on it and a hash that only exists in the live stack would be unqualifiable:
* `SELECT extname || ' @ ' || nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace`
  against the local stack returns `pgcrypto @ extensions`, and `digest()` is present with two
  overloads.
* Core Postgres `sha256` also works: `encode(sha256('abc'::bytea),'hex')` returns
  `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
* `supabase/tests/rls/00_bootstrap.sql:59` runs
  `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;`, and both `stage2/run.sh:131` and
  `stage4/run.sh:151` play that bootstrap into the databases their batteries create.
* A `SET search_path = ''` function can still reach `pg_catalog` builtins, so the core `sha256` route
  needs no extension at all — which is the route taken, for one less thing that can be missing.

---

## 3. Definition contract — the six decisions, recorded before implementation (§A / directive §3)

The rule behind all six: Stage 4 already owns a versioned definition schema, ordering, resolution,
lifecycle, immutability, selection and freeze gating, provenance recording, and a resolved-section
shape a guest can be shown. Stage 5 does not design any of that again. What follows is the gap list
first, because a gap that does not exist must not be implemented.

### 3.0 The real gaps, after §2

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | Host override is not *declarable*. The host's text always wins; a release cannot say "this wording is reviewed and may not be replaced", nor "this section is the host's alone and is required". | stage4 migration `:923-925`; §2.12 |
| G2 | A required `people_list` / `event_list` with zero rows is warned about **in the browser** and is invisible to the freeze. | `invitationSections.ts:282-293` vs `invitation_freeze_issues`' five arms |
| G3 | No generic "this section needs a venue" requirement exists. | guard `:363-386` bans `host_field` on list kinds and there is no other resource key |
| G4 | Issue records are prose `text[]`, and the freeze interpolates them into an exception message. | `:986-1049`, `:1446-1450` |
| G5 | Preview returns no issues; the browser decides required-ness on its own. | `internal_api.preview_invitation` `:1489-1513`; §2.12 |
| G6 | Nothing binds a review to the bytes that were reviewed. `reviewed_at` proves a status moved, not that a person read a word. | lifecycle arms `:583-618` |
| G7 | No maintenance surface: every lifecycle step is raw SQL through a trusted path. | `supabase/tests/api/fixtures/stage4_mint_release.sql` walks statuses with `UPDATE … SET status` |
| G8 | `snapshot_schema_version` must remain 2 and grow only additively. | §2.13, `:1184` |
| G9 | The definition contract needs a second version, additively, rather than a renamed vocabulary. | §2.13's 13-key pin plus approved v1 definitions being immutable |

### 3.1 Decision — host override is declared per text section by `override_rule`, and the resolver obeys it silently

A v2 section of kind `text` may carry:

```
"override_rule": "host_may_replace" | "pack_only" | "host_must_supply"
```

* `host_may_replace` — Stage 4's behaviour, unchanged: a non-empty host field wins, and winning over
  pack wording is recorded as `overrode_pack_text = true`.
* `pack_only` — reviewed wording may not be replaced. The resolver keeps `body_source =
  'reviewed_pack'` **even when the host has typed into the paired field**, and the issue engine
  reports a non-blocking `host_override_not_permitted` naming the section, so the host is told why
  their paragraph is not landing rather than being silently ignored. This is the arm that makes
  "a host override must never inherit review credit" a two-way rule: the reviewer's credit cannot be
  claimed for the host's words, and the host's words cannot be quietly dropped without a report.
* `host_must_supply` — the release offers no wording for the section; the host's field *is* the
  content. Provenance is `host`, never `reviewed_pack`. If the field is empty and the section is
  required, the engine reports a blocking `required_host_field_empty`.

v1 has no such key. **A v1 definition means `host_may_replace`,** which is not an interpretation but
a restatement of what Stage 4's resolver was measured to do (`:923-925`), so no v1 release changes
behaviour when this build replaces it.

Why this shape: it is one field, on the one kind that has wording to override, and it cannot be
expressed as a new `kind` — a rename would force the renderer to carry two vocabularies for the same
drawing job, and §J forbids that.

### 3.2 Decision — generic kinds declare their domain resource by `kind`, with one new opt-in fact for venues

No new `kind` values. The mapping from kind to the existing domain rows a section consumes is fixed
and tradition-blind:

| `kind` | Consumes | Existing table |
| --- | --- | --- |
| `text` | the host's prose field named by `host_field`, and/or the release's `pack_text` | `invitation_drafts.content` |
| `people_list` | the wedding's people | `wedding_people` |
| `event_list` | the wedding's enabled events | `wedding_events` |
| `text` with `override_rule = pack_only` | reviewed static wording only | the release itself |

`event_list` gains one optional v2 boolean, `requires_venue`: when true, every *enabled* event must
resolve a venue through the snapshot's existing `LEFT JOIN venues … AND v.wedding_id = e.wedding_id`
(`:1072-1156`). A `text` section that needs venue wording keeps taking it from `pack_text` or the
host, so no venue-specific application logic is added anywhere: there is still no `if (Tamil)`, no
`switch (pack_key)`, and §2.14's scanner is what would notice if there were.

No pack-specific domain rows are created. `wedding_people`, `wedding_events` and `venues` stay the
single source of the host's facts, and the release only ever says how much of them a document needs.

### 3.3 Decision — one server engine decides satisfaction, per kind, and only v2 raises the new arms

A required section is satisfied when the resource it consumes has content:

* `text`: a resolvable `pack_text` node (requested language, or a declared fallback), **or** a
  permitted host override that is non-empty, **or** — when `override_rule = host_must_supply` — a
  non-empty host field. None of those → blocking.
* `people_list`: at least one row in the snapshot's `people` array. Zero → blocking.
* `event_list`: at least one row in `events`. Zero → blocking. With `requires_venue`, an event
  without a resolvable venue → blocking, naming the section and the field.
* optional and empty → the section is omitted from the guest document and no issue is raised.

**Both new arms are gated on `definition_schema_version >= 2`, and the reason is a measurement, not a
convenience.** Stage 4's own battery freezes successfully from v1 releases that carry a required
`people_list`/`event_list` on weddings with no rows behind them: the Malayalam wedding in the SQL
battery selects release 2 (which declares `family` required `people_list` and `ceremonies` required
`event_list`, `50_pack_release.sql:658-661`) while the only seeded people/venue/event rows belong to
the main wedding (`:550-562`, `SELECT wed … FROM sf`), and `F7c` then asserts that the checker
reports **exactly one** cause — the unsupported language
(`50_pack_release.sql:2778-2780`). In the HTTP battery, `FRZ-05` freezes the Tamil wedding from
release 1 with the same two required lists (`fixtures/stage4_http_pack.sql:66-69`) and asserts
`error === null` (`stage4_tradition_packs.test.mjs:1143-1148`), and `wedMint` freezes the same way at
`:1153-1158`. Enforcing the new rule for v1 would either break those assertions or require rewriting
Stage 4 fixtures to insert rows they were written not to need. §M's "keep Stage 3/4 tests" and §B's
"as small as the contract permits" both point the other way.

So the honest statement of the contract is: **v1 means "required is reported, text-only"; v2 means
"required is refused at the freeze, for every kind."** That difference *is* the version bump, it is
visible in §19's evidence, and the real Tamil candidate stays a v1 draft until somebody decides to
re-declare it — which is a content decision this stage does not make.

### 3.4 Decision — issue records are the engine; prose is a projection over them

`private.invitation_issue_records(p_snapshot jsonb, p_definition jsonb) RETURNS jsonb` returns a
JSON array of stable machine-readable records:

```
{ "code": "required_list_empty",
  "section_key": "family",
  "field": null,
  "blocking": true,
  "message_key": "required_list_empty",
  "params": { "kind": "people_list" } }
```

`code` and `message_key` are the stable surface; a host adapter maps them to product copy. Codes are
lower_snake machine names and carry no database internals, so nothing in them needs translating at the
boundary, and no message is assembled from a table or column name.

`private.invitation_freeze_issues(jsonb)` — the function Stage 4 pinned — becomes a thin forward
re-definition that projects `message` out of those records, in the same order, producing byte-identical
sentences for v1 documents. That choice is deliberate and it has a payoff worth naming: Stage 4's
twenty-plus exact-array assertions become a **regression test of the refactor**, so any drift in a
sentence or its ordering fails loudly instead of looking like a passing rewrite. §2.13 predicted that
S7's closure list would grow by one name; it grew by **two** — `invitation_issue_records` and
`invitation_issue_messages` — because splitting the engine from its projection is what kept the
projection's wording pinned rather than re-derived. S8's cultural scan picks the new functions up
automatically, which is why Stage 4's total moved from 426 to 428 at the Stage 5 head (§11).

The freeze refuses when any record has `blocking = true`. The server never trusts a React validation
result: the browser's list is a *display* of server records, which is why §3.5 moves it server-side.

### 3.5 Decision — one resolution contract serves preview and freeze, delivered as one new owner-scoped call

`internal_api.preview_invitation_document(p_wedding uuid)` (with the usual `api.` SECURITY INVOKER
wrapper the Stage 3/4 convention uses) returns, from a **single** call to
`private.build_invitation_snapshot`:

```
{ "invitation": <the same DTO the guest route will draw>,
  "issues":     [ <record>, … ],
  "selected_release": { "pack_key", "display_name", "release_number",
                        "definition_schema_version", "status_is_current" } | null }
```

`internal_api.create_invitation_version` freezes from the same snapshot function and the same issue
engine, so preview and freeze cannot disagree by construction. §I's parity test asserts exactly that:
the canonical preview-resolved document equals the canonical frozen guest document, excluding the
operational fields that must differ (`requested` is the same; the version's own identity, its
`snapshot_schema_version` envelope and its timestamps are not part of the comparison).

Two design notes, both measured:

* `internal_api.preview_invitation` is **left exactly as it is**, because Stage 4 pins its shape
  (`s4_preview` indexes `->'sections'->'requested'` at `50_pack_release.sql:2825-2828`, and the HTTP
  battery reads it too). Wrapping it in an envelope would be a §B "destroy an existing guarantee"
  event for no gain.
* Returning the envelope from one function rather than composing two client calls is not a stylistic
  preference: two calls can straddle a save and show a host a document that never existed. One
  snapshot, one answer.

### 3.6 Decision — a review is bound to a SHA-256 over a canonical payload computed in Postgres

**The payload.** `private.tradition_pack_review_payload(pack, release)` returns canonical text:
labelled `key<TAB>value` lines in a fixed order, terminated by newlines, with the JSON definition
serialised by `private.jsonb_canonical(jsonb)`, which walks the tree with keys ordered
`ORDER BY k COLLATE "C"` and strings escaped explicitly. Locale-independent key order is the point —
`COLLATE "C"` is already how Stage 4's inventory assertions pin aggregation order
(`50_pack_release.sql:3827`), and a hash that moved because a machine's `lc_collate` differs would
invalidate reviews for a reason nobody can see.

Covered, because a change to any of it changes what a reviewer judged:

`pack_key`, `display_name`, `scope_statement`, `release_number`, `definition_schema_version`,
`languages`, `definition`, `author_label`, `machine_assisted`, `machine_assistance_notes`,
`source_reference`, `changelog`.

Deliberately **not** covered, with the reason for each:

| Excluded | Why |
| --- | --- |
| `id`, `pack_id` | a surrogate identifier changes nothing a reader saw. |
| `status`, `created_at`, `updated_at`, `approved_at`, `deprecated_at` | operational state that moves independently of the content, and `updated_at` moves on any write. |
| `review_label`, `review_basis`, `review_scope`, `reviewed_languages`, `reviewed_by`, `reviewed_at` | these are the reviewer's *answer*, written in the same statement as the hash. Hashing them would make draft → reviewed unsatisfiable by construction: the value to be matched would not exist until the moment it is matched. |
| `review_packet_hash` itself | self-reference. |

**The binding.** `digest(text, 'sha256')` would need pgcrypto; core `sha256(bytea)` needs nothing, and
§2.15 measured both available in the live stack *and* in the throwaway battery databases. Core
`sha256` is used, so the guarantee does not depend on an extension being present in some future
database.

* One new column, `public.tradition_pack_releases.review_packet_hash text`, is **assigned by the
  guard trigger itself** during draft → reviewed. A caller cannot supply it, because the trigger
  overwrites whatever was sent; a caller cannot forge a hash for material they did not have, because
  the function computes it from the row in front of it.
* reviewed → approved recomputes and **refuses unless stored hash = current hash**. So editing a
  draft changes the hash (the payload covers the definition), and a reviewed row cannot be edited
  backwards to match — its content is already frozen by Stage 4's immutability tuple, and the hash
  column is added to the review-record tuple that the reviewed→approved and approved→deprecated arms
  already protect.
* The packet's *human-readable* half is rendered by the maintenance CLI from
  `internal_api.get_tradition_pack_review_packet(...)`, which returns the same payload plus the
  reviewer-answer block. The CLI computes nothing authoritative: if it and Postgres disagreed about a
  hash, the hash in the table would still be the database's, and approval would still compare against
  it.

### 3.7 Decision — the frozen shape does not change, and provenance is derived rather than duplicated

`snapshot_schema_version` stays **2**. The snapshot's release block stays at its eleven pinned keys. A
resolved section stays at its thirteen pinned fields. The four provenance states §B asks to be
distinguishable are already total and exclusive over those fields:

| Provenance | Derivation |
| --- | --- |
| `reviewed_pack` | `body_source = 'reviewed_pack'` and `body_fallback_used = false` |
| `fallback` | `body_source = 'reviewed_pack'` and `body_fallback_used = true` — the actual `body_language` says what language really arrived |
| `host` | `body_source = 'host'` and `overrode_pack_text = false` |
| `host_override` | `body_source = 'host'` and `overrode_pack_text = true` |

This is recorded as a decision rather than an absence of work because §B explicitly says not to add a
column, and by extension a key, merely because the directive names a concept: a fifth stored
`provenance` field would be a *second* statement of two facts that can then disagree, in a document
format that is immutable once frozen and must stay readable. The derivation lives in
`src/lib/invitationSections.ts` as one pure function, is exercised by §J's renderer tests, and a
historical v2-era frozen document needs no migration to be read by it.

A host override therefore carries `body_source = 'host'` and can never read `reviewed_pack` — the
provenance that §B says must never inherit review credit is the one provenance the resolver already
refuses to claim for it (stage4 migration `:923-925`, and `FRZ-03` at
`stage4_tradition_packs.test.mjs:1088-1108` asserting exactly that).

### 3.8 What this does *not* change, stated so it cannot be re-litigated later

No second authoring schema. No second resolver. No web admin panel. No new `kind` vocabulary. No
change to the guest DTO's shape (its deny-list is re-asserted against the one new field, §3.6's hash).
No new table. No edit to any Stage 0–4 migration file: every Stage 4 behaviour that stays is staying
because a forward `CREATE OR REPLACE` re-declares it, and every behaviour that changes is version-gated
to v2 definitions. `npm test`, the SQL batteries and the HTTP battery all still have to pass
unmodified except for the two inventory re-listings §2.13 predicted (S7's closure, I6's function
list) — and if any other Stage 4 line needs editing to pass, that is a finding to be reported, not a
test to be relaxed.

That last sentence is the one this tranche was most likely to break quietly, so §11 lists every Stage 4
and Stage 3 line that moved and says which of them moved because a fact changed and which because a
checker was reading a superseded definition of a function.

---

## 4. Server-side required/optional semantics (§C, §D)

One engine, `private.invitation_issue_records(p_snapshot, p_definition)`, and per-kind satisfaction —
never per-pack. What §C asks for is that "required" mean something computable without knowing which
tradition is being rendered, and each arm below is that:

| Kind of section | How the engine decides it is satisfied | Record when it is not |
| --- | --- | --- |
| `text` with `override_rule` other than `host_must_supply` | a body resolved in the requested language, or in English where the release permitted that | `required_text_missing`, `field` = the host field the line reads |
| `text` with `host_must_supply` | the host's own field is non-blank — same arm, because the only difference is an authoring rule the document does not carry | `required_text_missing` |
| `people_list` | the snapshot's own `people` array is non-empty | `required_list_empty`, `params.kind = people_list` |
| `event_list` | the snapshot's own `events` array is non-empty | `required_list_empty`, `params.kind = event_list` |
| `event_list` declaring `requires_venue` | every *enabled* event has a resolvable venue, counted from the same array the renderer will draw | `event_venue_missing`, `params.missing` = the count |
| any kind, unknown to this build | refused rather than skipped | `kind_unorderable` / `position_unorderable` / `contract_unsupported` / `language_not_covered` |

Three things about that table are load-bearing and are asserted rather than argued:

* The snapshot's arrays are the measure, not a `count(*)` on a table. A row count and the document a
  guest would be shown are two opinions about one fact, and only one of them can be wrong in front of
  a customer.
* Every v2 arm is gated on `definition_schema_version >= 2`. §3.3 records the two qualification runs
  that prove the gate is real (a Malayalam wedding in the SQL battery, the Tamil one in the HTTP
  battery, both with required lists and no rows, both asserted to freeze).
* `language_not_covered` is one record for the whole document, not one per empty section. Without it
  the same wedding produces a pile of symptoms and the host has to infer the cause; with it the
  sentence names the language and the coverage (`stage5/70_document_resolution.sql` I6, I6b).

## 5. Schema and migration delta (§B)

One file: `supabase/migrations/20260929120000_stage5_pack_driven_authoring_review.sql`. It is the
only Stage 5 migration, and the Stage 0–4 files are untouched (`git status` shows the Stage 4
battery's edit and nothing else among committed migrations).

| What changed | Measured at the Stage 5 head |
| --- | --- |
| `public.tradition_pack_releases.review_packet_hash text` + a `^[0-9a-f]{64}$` CHECK | 30 catalogue columns, up from 29; no new table, no new policy, no other column |
| `private` helpers | 26 functions (was 20); the guard and the resolver re-declared forward |
| `internal_api` | 19 functions (was 8); 11 maintenance, 1 paired body, 1 re-declared freeze |
| `api` | 8 functions (was 7): the one new wrapper, `preview_invitation_document` |
| Total across the three schemas | 53 functions, up from 32 — the count Stage 4's I-group now expects at this head |
| Grants | every new name revoked from `PUBLIC, anon, authenticated`; the eleven maintenance names revoked from `service_role` too |

Two Stage 5 decisions that §B invited a different answer on, recorded because they will be asked
again:

* **No `provenance` column and no `override_rule` column.** Both are facts inside the versioned
  `definition` jsonb, which is where §B says to keep a fact the existing JSON can carry verifiably.
  The one column added is a digest, which is not representable inside the material it hashes.
* **`SECURITY DEFINER` only on the two functions that need it.** The eleven maintenance functions are
  `SECURITY INVOKER` with `search_path = ''` and no grant to any client role: each performs writes
  the calling maintenance identity could already perform on the row, so escalation would buy nothing
  and would have to be justified. The preview and freeze bodies stay DEFINER because they read
  `private` on the caller's behalf, which is the Stage 3 boundary they inherit.

### 5.1 The nested call, and why `service_role` holds five grants

Stage 4's own comment recorded that the release guard "calls no other `private` function, because it
is SECURITY INVOKER and a nested call would be privilege-checked against whoever issued the statement".
Stage 5 could not keep that and still have one implementation of *what a review covers*: the guard
computes the digest by calling `private.tradition_pack_review_hash`, and the trigger fires as the
role that issued the `UPDATE`.

This was first observed as a failure, not as a theory: `supabase/tests/stage4/60_reviewed_fixture.sql`
died with `permission denied for function tradition_pack_review_hash` at the Stage 5 head, after 15
PASS lines, because that fixture performs the `draft → reviewed` step as `service_role`. Root cause,
measured rather than assumed: every function in `private` carries ACL `{postgres=X/postgres}` once
the per-object `REVOKE … FROM PUBLIC, anon, authenticated` is applied, and revoking from PUBLIC removes
a role that held the grant only through PUBLIC — so `service_role`, which Stage 2 measured as the
trusted backend with write access to the catalogue, could move the row but could not run the function
the row's own trigger needed.

The repair is five `GRANT EXECUTE … TO service_role` statements, on
`tradition_pack_review_hash`, `tradition_pack_review_payload`, `review_field`, `jsonb_canonical` and
`canonical_token`. The alternatives were considered and refused in the migration's own comment:
inlining the payload duplicates the definition of a review in two places; making the guard or the
hasher `SECURITY DEFINER` is refused by Stage 2's C32b, which names `guard_tradition_pack_release`
among the gates that must not decide against the owner's view; and narrowing `service_role`'s write
access would silently withdraw a Stage 2 guarantee to dodge a problem.

What is still true afterwards, asserted in `stage5/50_review_binding.sql` group M:

* `service_role` holds EXECUTE on **exactly those five** functions in `private`, and on none of the
  other 21 — including `reject_client_write`, which stays unexecutable by it, so Stage 2's C69 holds
  at this head and the grant is a named set rather than a door.
* `anon` and `authenticated` hold EXECUTE on **nothing** in `private` (count 0), and their probe call
  is refused at the schema: `permission denied for schema private`.
* The guard is still `SECURITY INVOKER`, and no trigger on either pack table is `SECURITY DEFINER`.
* The behaviour the grant exists for is measured, not the ACL alone: `service_role` completes
  `draft → reviewed` *and* `reviewed → approved`, and the digest it stored equals the recomputation.

One consequence for §8: because `service_role` holds no `USAGE` on `internal_api` at all (Stage 2's
`40_catalog.sql` :444-451), the maintenance CLI must connect as the local **owner** identity. That is
a design fact, not an accident, and §8 records what it made of it.

## 6. Preview/freeze parity (§I)

Read this heading as *server-side* parity, because that is the only claim its table supports: every
row in it is a SQL assertion about two database reads of the same snapshot. At the intermediate
checkpoint no product component called `preview_invitation_document`, so no host-facing screen
showed the server's issue records; see §17 item 2 and, after the correction, §18.4.

`internal_api.preview_invitation_document` resolves the snapshot once and returns
`{invitation, issues, selected_release}`; `internal_api.create_invitation_version` re-resolves it
under `SELECT … FOR UPDATE` on the wedding row and recomputes the verdict from the row. Three
properties were needed and are measured:

| Parity claim | Where it is asserted |
| --- | --- |
| The preview document equals the frozen guest document, byte for byte | `stage5/70_document_resolution.sql` **P1** |
| The freeze's refusal is the projection of the preview's own records | **F4** (exact string equality against `invitation_issue_messages(issues)`) |
| No wedding can freeze while its preview reports a blocking issue | **F8**, over every wedding in the battery, offenders-named |
| Editing the draft after a freeze changes version 1 by nothing | **P4**, md5 of the snapshot before and after |
| The live preview and the frozen version disagree *by exactly the edit* | **P4c** |
| A retirement, a newer approval and a re-selection leave version 1's bytes alone | **H2, H2b, H9c** |
| The freeze RPC accepts one argument | **F8b** — `proargnames = {p_wedding_id}`, so no verdict, issue list or snapshot is sendable |

The lock is the part worth re-reading in the migration: Stage 4 read the mutable
`weddings.tradition_pack_release_id` pointer twice inside one freeze transaction without locking it,
which meant a selection change landing between the two reads could pin release B over a snapshot
resolved from release A. Nothing observable proved it had happened; nothing had proved it could not.
`FOR UPDATE` closes the window for one row lock, and release rows are content-immutable once
approved, so the pointer was the only thing that could move.

## 7. Provenance (§D)

The frozen document keeps Stage 4's thirteen keys per section and `snapshot_schema_version = 2`. The
four provenance states the directive names are the four combinations the resolver emits, and
`stage5/70_document_resolution.sql` **R6** derives them from one document rather than listing them:

| State | Section in the fixture | Emitted as |
| --- | --- | --- |
| `reviewed_pack` | `blessing` | `body_source = reviewed_pack`, `overrode_pack_text = false` |
| `host` | `event_notes` | `body_source = host`, `overrode_pack_text = false` — the release supplied nothing to replace |
| `host_override` | `opening` | `body_source = host`, `overrode_pack_text = true` |
| `fallback` | `closing` | `body_source = reviewed_pack`, `body_language = en`, `body_fallback_used = true` beside a requested `ta` |

Two refusals follow from this and are asserted: a host override can never read `reviewed_pack`
(R2/R3 — no review credit for the host's words), and the authoring rules themselves stay out of the
document (**D3/D4**: `override_rule` and `requires_venue` appear at no depth of the frozen snapshot
or the preview, because a document that recorded `override_rule` could later disagree with its own
`body_source`).

**Not yet done:** the derivation is a pure function in SQL and in `invitationSections.ts` for the v1
path, but the renderer-side provenance cases §J asks for are listed in §17. Neither the renderer nor
any editor drew a `host_override` or `fallback` section at the intermediate checkpoint — the four
states are proved to be *emitted* by the resolver and *stored* by the freeze, which is a narrower
claim than "the product renders them", and §18.4 records what the correction tranche did about it.

## 8. The maintenance-only privileged surface and the CLI (§B, §F)

Eleven functions in `internal_api`, none in `api`, no grant to `anon`/`authenticated`/`service_role`
(§5 above), and — measured over HTTP rather than inferred from the grant — unreachable:
`supabase/tests/api/stage3_publication.test.mjs` **API35** asserts each one's posture from the live
catalogue (INVOKER, `search_path=''`, owner `postgres`, grantees empty, no wrapper in `api`) and then
probes `/rest/v1/rpc/tradition_pack_catalog` and the schema-qualified spelling with three credential
shapes. Measured result: **404 `PGRST202`** for all six probes, and the body is byte-identical per
requested name across anon key, bearer and service key — PostgREST fails to resolve the name in the
exposed profile before any privilege check, which is a stronger answer than a permission error and
not an oracle into whether the function exists.

`scripts/tradition-pack-admin.mjs` is the operator's tool. It is deliberately not a web panel, has no
`delete` verb, and refuses to run without an explicit local target:

| Gate | Measured behaviour |
| --- | --- |
| No target given | `REFUSED: no maintenance target was supplied…`, exit 2 |
| `--linked`, `--project-ref` | `REFUSED: this tool is local-only…`, exit 2, checked before the command is even read |
| `--via-docker some_random_thing` | refused: the name must be the local stack's `supabase_db_<project>` container |
| `--db-url-env` with a `*.supabase.co` URL in the env var | refused: "the URL names a hosted target" |
| Any mutating command without `--yes` | prints the pack, the release, the current status, the requested transition and the digest, then refuses; nothing executed |
| Connection | `psql` inside the local container (peer-authenticated) or a loopback URL read from an **environment variable** — never argv, so a password cannot land in shell history |

**No Node Postgres driver was added.** The directive allows one with justification; the
justification for not adding one is stronger: the only identity that can reach the maintenance
surface is the local owner role (§5.1), it is reachable without a credential only through the
container's own socket, and a `pg` dependency would put a connection string with a password into the
tool's environment for no capability this stack does not already provide. `package.json` and
`package-lock.json` are therefore **unchanged** by Stage 5, and the production bundle cannot contain
a driver that was never added — `npm run build` succeeded with the same dependency set §1 measured.

Injection is closed structurally rather than by escaping cleverly: JSON documents travel
base64-encoded and are decoded inside Postgres (`convert_from(decode(...,'base64'),'UTF8')::jsonb`),
text values are standard literals with doubled quotes, every value is shape-validated first
(uuid/hash/slug/language-tag regexes), and the session is required to report
`standard_conforming_strings = on` before anything is sent. Two real defects were found while
exercising it and fixed: uuids were being interpolated **unquoted** (which fails loudly, as it did
here, rather than silently — but it was a hole in the rule "everything goes through `lit`"), and a
flag parser swallowed a following command as `--linked`'s value, which meant the local-only refusal
fired for the wrong reason.

End-to-end against the local stack: create pack → create release (v2 definition) →
`validate-release` → `review-packet` (Markdown + JSON written, digest printed) → submit against a
stale digest (**refused by the database**, naming both digests) → submit against the current digest →
approve → `retention`. The measured digest for that fixture release was
`ec761d93…`; `retention` reported `review_binding_current: true`, `can_delete: false`,
`can_deprecate: true`, `weddings_selecting: 0`, `live_wedding_attached: false`.

**No customer data was touched**: the probe pack was created against the local development database,
which had just been reset from migrations and contains no customer rows; the local stack was then
reset again before the HTTP battery, so the probe rows are not part of any qualified state. Measured
afterwards, the local database holds five packs, all named `stage4_http_*` — the fixtures Stage 4's
own HTTP battery creates, which by design it cannot clean up because a release that has left `draft`
is undeletable and the local database is throwaway. That is pre-existing behaviour, not Stage 5
residue, and it is recorded here so a later reader does not mistake it for either.

## 9. Review packet and the authoritative hash (§E)

The digest is computed in Postgres by `private.tradition_pack_review_hash` (core `sha256(bytea)` +
`encode(...,'hex')`, not pgcrypto — measured available in both the live stack and the throwaway
qualification databases, so the guarantee does not depend on an extension being installed
somewhere). The CLI renders a packet and computes nothing.

Covered by the payload, and asserted present by name in the canonical text (`P5`): pack key, pack
display name, pack scope statement, release number, contract version, languages, definition, author
label, machine-assisted, machine-assistance notes, source reference, changelog.

Excluded, each with a reason (`P6` asserts none of them appears): the row's and pack's ids, `status`,
every lifecycle timestamp, the review record (`review_label`, `review_basis`, `review_scope`,
`reviewed_languages`, `reviewed_by`, `reviewed_at`) and the digest column itself. The reviewer's
answer is written in the same statement that computes the digest, so hashing it would make
`draft → reviewed` unsatisfiable by construction.

Measured properties, with the assertion that produced each:

| Property | Evidence |
| --- | --- |
| Same bytes → same hash | **P7** — a section object re-emitted with its keys in the opposite order digests identically (jsonb is normalised on input, so reformatting cannot create a spurious review difference) |
| Different material → different hash | **P8** (section array re-ordered), **P8b** (one position rewritten), **P9** (one character of Tamil wording), **P10** (the machine-assistance disclosure), **P11** (only the release number) |
| Absent is not empty | **P12** — `review_field` prints `-1` for a missing value and a byte length for a present one, so deleting a source reference moves the digest |
| Submitting against a stale digest is refused, and writes nothing | **S18/S18a** (fingerprint captured immediately before the refused statement, so the claim is about that statement), and the same path measured through the CLI against the live stack (§8) |
| The packet's printed digest is the value the trigger stores | **P2**, **S14**, **S20a** |
| A caller cannot choose the digest | **B3** (a draft's is reverted), **B7/B7b** (a forged invalid value at the review edge is overwritten by the recomputation) |
| A reviewed row cannot be edited to make a digest match | **B8** (content frozen), **B8b** (the hash is inside the frozen review tuple) |
| Approval re-compares rather than re-stamps | **B9**, **S22/S22a**, and **H3/H3b** for a retired release |
| The column cannot hold anything but a SHA-256 | **P13**, read from `pg_constraint` |

The unapprovable-with-no-binding arm (a release reviewed before bindings existed) is real but
unreachable through any client path — B7b shows the review edge always writes a digest — so it is
asserted as a property of the shipped body (**B15**) rather than left as a prose claim.

## 10. Candidate truth status (§20, directive §D)

Unchanged, and stated plainly: **there is no human-reviewed, customer-safe Tamil ceremonial
release.** The Tamil candidate is a repository artefact, not a catalogue row — measured: every
release in the qualified catalogue belongs to a `stage*_doc*`/`stage*_*` TEST ONLY fixture, and
`stage5/50_review_binding.sql` **T3** asserts across the whole catalogue that no release records a
review basis that does not disclaim human cultural authority. Nothing in this tranche approved,
reviewed or selected it; §12's browser-visible facts are asserted against synthetic TEST ONLY packs
only. The candidate remains draft, machine-assisted, not human-reviewed, not customer-selectable.

## 11. Lifecycle and immutability attack evidence (§L)

`supabase/tests/stage5/` is a new chain runner plus three batteries, and it answers two questions
separately: does Stage 4 still pass *at the new head*, and do Stage 5's own guarantees hold.

| Suite | Stage 4 head | Stage 5 head |
| --- | --- | --- |
| `stage4/50_pack_release.sql` | **426** | **428** |
| `stage4/60_reviewed_fixture.sql` | **57** | **57** |
| `stage5/50_review_binding.sql` | not applicable (v2 vocabulary does not exist) | **111** |
| `stage5/60_definition_vocabulary.sql` | not applicable | **50** |
| `stage5/70_document_resolution.sql` | not applicable | **92** |

Every number above is the suite's own reported total **cross-checked against the `NOTICE: PASS`
lines it printed**, which is what `run.sh` refuses to print otherwise. Both Stage 5 chains (clean
and legacy) produced identical totals.

The 426 → 428 delta is two assertions, both in S8, and both are the closure scan noticing two more
members rather than a changed expectation — `private.invitation_issue_records` and
`private.invitation_issue_messages`.

Four Stage 4 expectations were made head-aware, each by *stating both* expectations and selecting on
a declared head (`PGOPTIONS=-c app.stage_head=stage5`), never by reading the schema under
measurement: LC9x's contract version, S7's closure list, F11's unnamed-definition sentence, A7d's
column count, and group I's function inventory. Stage 4's runner was not changed and still reports
426/57 on both chains.

§L's enumerated attacks, and where each is now measured:

* Browser refusals to create/edit/promote/approve/deprecate/set-hash/forge-label-or-basis/alter
  reviewed-languages/machine-disclosure/source/changelog → **M2/M3/M4** (all eleven maintenance
  functions refused for `anon`, `authenticated` and `service_role`, one assertion per role,
  offenders named) and **M5** (no wrapper in `api`), plus API35 over HTTP.
* Cannot select draft / reviewed / deprecated / nonexistent; can select an approved TEST ONLY fixture;
  cannot mutate a release after selection → **S1–S5** and **H7**.
* Maintenance cannot: stale hash, `draft→approved`, `reviewed→draft`, `reviewed→deprecated`,
  `approved→reviewed`, `approved→draft`, `deprecated→anything`, delete reviewed/approved/deprecated
  → **S18, B10, B10b, B12, B14, B14b** and the Stage 4 LC group at this head.
* Freeze cases (no pack still possible, approved-and-complete, required missing, deprecated selected,
  foreign/guessed ids) → **F1, F9, F4–F6, F7**.
* Provenance and the recursive DTO walk → **R1–R8, D1–D5**.
* History → **H1–H9c**. Retention → **S27, S28** and §8's live run.

### 11.1 Three defects the Stage 5 batteries found in the migration

Reported because §L's purpose was to be able to fail, and these are what failing usefully looks
like. All three were in code written earlier in this same tranche, and none was visible to Stage 4's
battery because each only affects v2 material:

1. **The guard's section whitelist omitted `override_rule` and `requires_venue` from the base list**,
   so the clause written to permit them on a v2 release could never be reached and no v2 definition
   could be authored at all. Found by `60_definition_vocabulary.sql` refusing to get as far as its
   first assertion.
2. **The `pack_only` arm had the NULL trap** the guard's own comment says every arm avoids:
   `jsonb_typeof(section -> 'pack_text') <> 'object'` is NULL when the key is absent, so the
   declaration that most needed refusing — `pack_only` with nothing reviewed — was accepted. Found by
   case **R07**.
3. **The `event_vocabulary` presence tests had the same trap** for `event_key` and `labels`, so an
   entry missing either was accepted. Found while adding **R13/R14** as the version-2 analogue.

## 12. Catalogue and selection evidence (§L, §M)

`internal_api.tradition_pack_catalog()` is scoped-checked rather than absolutely counted — the
assertion reads this battery's own pack's release states (`S1`: `1=deprecated, 2=draft, 3=draft,
4=draft, 5=reviewed`), because by the time a Stage 5 battery runs, Stage 4's fixtures and the
battery's own rows are both in the table. `inspect` reports `binding_current` recomputed rather than
repeated (§9), and reports it honestly for a draft: `false`, because a draft holds no digest, so
"the stored value describes the material" is false rather than vacuously true. Selection is exercised
through the browser's own UPDATE, as `authenticated`, in `S1–S5`.

## 13. Renderer contract (§J)

`InvitationRenderer` was not changed by this tranche, and that is a measured statement rather than an
assumption: the build's `InvitationRenderer-*.js` chunk is 13.94 kB / 4.53 kB gzip, and Stage 4's
document battery still pins its 13-key input at 426/428 assertions. No pack key, tradition name,
Tamil-specific ordering or religious inference was added to it.

**Not done:** §J's four new cases (each provenance state drawn, an unknown optional section, a
required-unknown section blocked before freeze, a historical v1 snapshot still rendering) and the
10 × 4 render sweep are in §17. The renderer's existing tests were not modified, so nothing in this
tranche claims a rendering result it did not run.

*Pointer, appended at §22's closure:* the four cases above are closed by §20, and §20.4 qualifies the last
one — the renderer keeps honouring a v1 payload, while `C11c` shows this build's projection refusing a v1
snapshot. The 10 × 4 sweep remains open as §30. The 13.94 kB chunk figure above has not been re-measured
since; §22 changed no file in the app's import graph, and §34 re-measures the build.

## 14. Pure and component tests (§N)

| Change | Effect |
| --- | --- |
| `src/test/traditionPackAuthoringRules.test.ts` (new) | 15 tests: the client mirror of every v2 authoring rule, each refusal beside its accepted form, plus the vocabulary and version-list pins |
| `traditionPackDefinition.test.ts` | the "unreadable contract version" case moved from 2 to 3, and a new case asserts both 1 **and** 2 parse clean |
| `traditionPackDraftCandidate.test.ts` | the candidate's claimed version is now a **membership** test rather than an equality with the authoring version — the candidate is a v1 artefact and stays one until re-authored |
| `traditionPackPanel.test.tsx` | the "unreadable format" notice moved to version 3, because version 2 became readable and the old fixture was asserting a refusal this build no longer owes |
| `traditionReleases.test.ts` | the release fixture names `review_packet_hash` (null, as a pre-binding row is) so the generated Row type and the fixture agree |

`npm test`: **371 tests in 25 files, 0 failures** (OLD: 355 in 24). No assertion was deleted to get
there; the three changed files are listed above with why each premise moved.

## 15. HTTP qualification (§M)

`bash supabase/tests/api/run.sh` against the local stack at the Stage 5 head: **38 / 56 / 28, 0
failures**, and the runner's own leak checks passed. Stage 4's HTTP battery needed one update, and it
is the kind of update §2.13 predicted rather than a relaxation: **CAT-08** pins the exposed `api`
function inventory, Stage 5 added the eighth name, so the list was extended and the reason for the new
door recorded (its ruling is §3.5), plus a new assertion that every `%tradition_pack%` function lives
in `internal_api` or `private` and nowhere a browser can name.

**Not done:** §M's *new* Stage 5 HTTP cases — the synthetic approved pack's selection/freeze/retirement
journey over REST, the reviewer-facing packet round trip, and the draft-released/deprecated refusals
measured through PostgREST rather than through `SET ROLE`. API35 covers the maintenance surface's
HTTP unreachability, which was the §L item that could only be proven at the transport; the rest is
§17.

## 16. Checkpoint gates — OLD → CURRENT

Node gates bracketed by installer-marker checks; the tree was `npm` on both sides
(`installer=npm`, `pnpm_dir=ABSENT`, `npm_marker=PRESENT`, lock digest unchanged from §1), and no
`pnpm` file was touched, staged or committed.

| Gate | OLD (§1) | CURRENT | Result |
| --- | --- | --- | --- |
| Stage 0 RLS battery | 24 | 24 | pass |
| Stage 2/3, clean chain | 42 / 46 / 284 / 464 / 103 | identical | pass |
| Stage 2/3, legacy chain | 76 / 49 / 284 / 464 / 103 | identical | pass |
| Stage 4 battery, Stage 4 head | 426 + 57 | 426 + 57 | pass |
| Stage 4 battery, Stage 5 head | not measured | 428 + 57 | pass |
| Stage 5 batteries | — | 111 + 50 + 92 | pass |
| Local HTTP battery | 37 / 56 / 28 | 38 / 56 / 28 | pass |
| ESLint | 0 errors, 8 warnings | 0 errors, 8 warnings | pass (warnings unchanged, all pre-existing `react-refresh`) |
| TypeScript | pass | pass | pass |
| Generated DB types vs schema | 0 findings | 19 public + 10 non-client tables, 19 client type tables, 29 column groups, 0 findings; self-test OK | pass |
| Product contract | 23 rules / 171 files, 0 violations | 172 files scanned, 0 violations | pass |
| Unit + component tests | 355 in 24 files | 371 in 25 files | pass |
| Production build | 491.21 kB / 148.31 kB gzip entry | 491.21 kB / 148.30 kB gzip entry | pass |
| `npm audit --omit=dev --audit-level=high` | exit 0 | exit 0 | pass |
| Migration ordering, full incl. `_stage0_` | applied | `supabase db reset --local` applied all 19 migrations to the Stage 5 head | pass |
| `git diff --check`, working tree | clean | clean (exit 0; two `core.autocrlf` LF→CRLF *warnings* on test files are not findings) | pass |
| `git diff --check origin/main...HEAD` | clean | clean (exit 0) | pass |

Two honest qualifications. First, the build-size row moves between runs on its own and is quoted
here as printed for this run, not as a delta this stage caused — the only Stage 5 source additions
are one script and one test file, and the entry chunk is the same bytes at one-hundredth-of-a-kilobyte
resolution. Second, `dbtypes:check`'s "19 views" wording in §1 came from an older report format; the
current line names what it counts.

## 17. Remaining work — what is NOT finished at this checkpoint

This tranche does not complete Stage 5, and §Q's stop condition is reached on the server side
rather than on the client side. Named explicitly, because a list of what passed is not a list of
what is done:

1. **Editor driven by the resolved definition (§H).** The authoring vocabulary, the adapter's
   `previewInvitationDocument`, and the version/`isReadable` handling are in place, but the editor
   page still drives its slot list from the Stage 4 shape. The resolved definition's
   `override_rule`/`requires_venue` must decide which controls a host sees, and the
   deprecated-historical state ("This invitation uses an older release.", view existing truth, no
   new freeze, explicit re-selection offered) is asserted in SQL (**H4–H10**) but not yet rendered.
2. **Preview adapter wiring (§I).** `previewInvitationDocument` exists and is typed; no component
   calls it yet, so the editor's issue list is not yet the server's records. Until that lands, the
   freeze remains the only enforcement point — which is the safe direction, but is not what §I asked
   for, and this audit will not describe it as though it were.
3. **Renderer provenance cases (§J)** — the four states, unknown optional section, required-unknown
   refusal before freeze, historical v1 snapshot; plus the 10 shapes × 4 viewports render sweep and
   the accessibility/mobile pass over any new copy.
4. **Stage 5 HTTP battery (§M)** — the synthetic approved pack's selection/freeze/retirement journey
   over REST, the draft/reviewed/deprecated/guised selection refusals at the transport, and the
   DTO deny-list walk against a published guest document rather than a preview of one.
5. **Cultural-safety static rules (§K)** — the existing product-contract rules were not extended to
   fail active source that derives a pack from name/surname/religion/community/location or language,
   or that calls AI for reviewed ceremonial wording; and §K's ≥2 identity-profile tests proving the
   decision logic produces no recommendation were **not written**. The resolver's body is asserted
   culture-free in SQL (**R8**), which is a narrower claim than the one §K asks for.
6. **Browser E2E journeys A/B/C** and the §18 customer journey — deliberately not started; the
   directive stops this tranche before them.
7. **React Router advisory decision** — 2 moderate advisories remain, below the `--audit-level=high`
   gate threshold, unfixed by choice, and still requiring a documented decision.
8. **Independent final security review** of the Stage 5 migration and the CLI, by a second reader.
9. **Final clean gate run, secret scan, commits, branch push (with an explicit refspec), remote
   verification, and the final Stage 5 report.** Nothing is committed by this tranche: the migration,
   the three Stage 5 SQL files, the runner, the CLI, the checker extension, the adapter and contract
   additions, and the regenerated types are all working-tree state on
   `stage5/pack-driven-authoring-review`. No merge, no main push, no deploy, no Tamil approval, no
   Stage 6.

## 18. Reconciliation with the Stage 5 completion tranche (appended, not a rewrite)

This section is an appendix in the sense §11.1 and §16's qualifications are: nothing above it is
edited to match a later conclusion, and the numbers in §16 keep the column header they were measured
under. What changes here is what those numbers are *called*.

### 18.1 The authority that produced this section

| Directive | Bytes | mtime | sha256 | Status |
| --- | --- | --- | --- | --- |
| EXTENDED STAGE 5 roadmap, §0–§33 | 39 387 | 2026-09-29 15:14 | `fd1df276ce78b97ca84136d9842358e3dacdf05baccfbd5500636ba862b72121` | underlying roadmap |
| STAGE 5 CORE IMPLEMENTATION TRANCHE, §A–§Q | 26 349 | 2026-09-29 16:50 | `79a963f5d5cbf141c4079a577707c10612f1cf73795e528bbcd8da67d1f0bf0f` | produced §§1–17 above; **its §Q stop is superseded** |
| STAGE 5 COMPLETION TRANCHE, §18–§40 | 29 532 | 2026-09-29 20:16 | `7a63d321b9f7e83fcfd4db3070f8591c2bf72d4b96145a9086263a4b9a466759` | **current authority** |

The completion tranche states the correction in its own words: the previous stop was an intermediate
checkpoint, not satisfaction of §Q, and work continues until Stage 5 is branch-complete. Its §18–§40
replace the letter-numbered §A–§Q as the to-do list; §§1–17 above stay as the record of what was
measured before that correction.

### 18.2 What the correction is *not*, stated from the file rather than from memory

The correction as received said the previous report marked editor adaptation, renderer provenance and
preview/freeze parity as landed "at §10/§11 of the audit". Read literally, §§10 and 11 of this audit are
"Candidate truth status" and "Lifecycle and immutability attack evidence", and neither is about the
editor, the renderer or parity: §10's claim is that no human-reviewed customer-safe Tamil release
exists, §11's is a table of SQL totals and where each enumerated attack is measured. The numbering
collision is real and worth naming, because it is exactly the reading that turns a section title into a
false claim: the **roadmap's** §5/§6/§7/§13/§14 are authoring UI, preview/freeze parity, historical
release behaviour, snapshot provenance and the renderer, while this audit's §§5–§14 are different
subjects with similar numbers.

Where a claim genuinely could be over-read, it is now annotated rather than silently reworded:

* §6's heading is "Preview/freeze parity (§I)" and its table is entirely SQL assertions. It now opens
  by saying so, because no product component called `preview_invitation_document` at the checkpoint.
* §7 already ended with a "Not yet done" line for the renderer cases; it now also says the parity it
  measures is server-side.
* §§12–15 and §17 never claimed the missing pieces, and are unchanged.

So the honest summary of the discrepancy is: **no measurement in this audit was wrong, and two section
headings were capable of being read as more than they measured.** The list of what is missing is §17,
and it was, and remains, accurate — the error was in stopping.

### 18.3 §16's rows reclassified: intermediate-only vs carried forward

§16 was reported under the header "Checkpoint gates — OLD → CURRENT". Under §34 the same gates are run
again and reported OLD → MIDPOINT → FINAL, and the §16 CURRENT column **is** the MIDPOINT column.
Nothing in it is a final number, and every row must be re-measured before §37, because §19–§24 add
application source, product-contract rules and a new HTTP suite, and may add migration surface.

| §16 row | What it actually measured | Classification | Re-measure because |
| --- | --- | --- | --- |
| Stage 0 RLS battery 24 → 24 | SQL only, unaffected by client work | midpoint; carried as a *no-regression* target | §34 runs it again |
| Stage 2/3 both chains (identical to §1) | SQL only | midpoint; carried as a no-regression target | §34 |
| Stage 4 at Stage 4 head 426 + 57 | SQL only | midpoint; carried | §34 |
| Stage 4 at Stage 5 head 428 + 57 | SQL only, at the current head | midpoint | any §19–§22 change to the migration or DTO |
| Stage 5 batteries 111 + 50 + 92 | SQL only | midpoint | the authoring-declaration surface, if §19 adds one |
| Local HTTP battery 38 / 56 / 28 | existing suites only; §15 records that Stage 5's *own* HTTP cases were never written | **intermediate-only**, and the row most likely to move — §23 adds a suite whose count cannot be inferred from 38/56/28 | §23, then §34 |
| ESLint 0 errors / 8 warnings; TypeScript pass | client source as it stood at the checkpoint | midpoint | §19–§24 edit client source |
| dbtypes 19 public + 10 non-client tables, 19 client type tables, 29 column groups, 0 findings | generated types vs the local schema | midpoint | any migration change; regeneration is §G's rule |
| product:check "172 files scanned, 0 violations" | 23 rules at OLD; the scanned-file count moves between runs on its own (project memory, *Stage 3 measurement instruments*) | midpoint | §24 adds rules, so FINAL must name **both** rule and file counts |
| Unit + component 371 in 25 files | client tests as at the checkpoint | midpoint | §19–§25 add tests |
| Production build "491.21 kB / 148.30 kB gzip entry" | entry chunk only | midpoint, **and incomplete**: §1's OLD column names a module count (2 194) that §16's CURRENT column does not, so those two columns were never the same measurement. The intermediate module count was not captured, and is not invented here. | FINAL must report modules **and** entry size on both sides |
| `npm audit` exit 0 / `--audit-level=high` exit 0 | exit codes read from the command, not a pipe | midpoint | §26 may change dependencies |
| `supabase db reset --local`, 19 migrations | full forward application incl. `_stage0_` files | midpoint | §34 from zero |
| `git diff --check`, both ranges clean | whitespace, working tree and `origin/main...HEAD` | midpoint | §37 commits change the range |

### 18.4 What §§19–§40 now owes, mapped to §17

| §17 item | Completion tranche | State at this appendix |
| --- | --- | --- |
| 1 editor from the resolved definition | §19 | open |
| 2 preview adapter wiring | §20 | open |
| 3 renderer provenance cases + sweep + a11y | §22, §30, §31 | open |
| 4 Stage 5 HTTP battery | §23 | open |
| 5 cultural-safety static rules + profile tests | §24 | open |
| 6 browser journeys | §27, §28, §29 | open — the roadmap's "§18 customer journey" is now this tranche's §§27–29, not its §18 |
| 7 React Router decision | §26 | open |
| 8 independent security review | §33 | open |
| 9 gates, secrets, docs, commits, push, report | §34–§40 | open |
| (not in §17) CLI pinned by tests | §25 | new requirement; §8 records manual exercise only |
| (not in §17) deprecated-release UX | §21 | §17 item 1 named it; SQL-proven only |
| (not in §17) network/privacy recheck | §32 | carried from the roadmap's §24 |

### 18.5 §18 gate, re-measured for this appendix

Read-only, on 2026-09-30, before any measurement in the completion tranche:

| Check | Measured |
| --- | --- |
| branch | `stage5/pack-driven-authoring-review` |
| HEAD | `328f0e3fef5a39aa5f91182fb54bf0a97d717e69` — Stage 4's merge base; all Stage 5 work is uncommitted |
| `origin/main`, local ref **and** `git ls-remote origin refs/heads/main` | both `328f0e3…`, so nothing external moved it |
| Stage 5 branch on the remote | `git ls-remote origin refs/heads/stage5/pack-driven-authoring-review` returned **no rows** — never pushed |
| branch upstream | **none configured.** An earlier note in this session recorded `origin/main` as the upstream; the measurement is `fatal: no upstream configured for branch`, which is why §38's push uses an explicit refspec and never `-u`. |
| staged files | none (`git diff --cached --name-only` empty) |
| working tree | 13 modified tracked files; untracked: the Stage 5 migration, `supabase/tests/stage5/` (runner + 3 batteries), `scripts/tradition-pack-admin.mjs`, `src/test/traditionPackAuthoringRules.test.ts`, this audit, and `pnpm-lock.yaml` / `pnpm-workspace.yaml` |
| migrations in the working tree | 19 |
| installer markers, before any Node command | `node_modules/.pnpm` absent, `node_modules/.modules.yaml` absent, `node_modules/.package-lock.json` present, `node_modules/vite` a real directory not a symlink → npm-shaped tree, so §18 forced no reinstall |
| Docker | the daemon is **not reachable** (`failed to connect to the docker API at npipe:…dockerDesktopLinuxEngine`) |

The last row is the binding constraint on the rest of this tranche: no SQL battery, HTTP suite, browser
journey, render sweep or `dbtypes:check` can be re-measured until this repository's local stack can run,
and none of the §16 numbers above were re-run while it was down. Client-side work (§19–§26) can
proceed against the checked-in sources; the stack is needed again before §30.

**Superseded by measurement on the same date, further down at §19: the Docker row was true when it was
written and is not true now.** The stack became reachable during §21, and the SQL batteries were
re-run — which is what found the three stale counts §19 records. Nothing above this paragraph is
edited; §19 is the correction, appended.

## 19. §21 closure, and the three audit numbers it proved stale (appended, not a rewrite)

Measured 2026-09-30, on the branch, after §19–§21 landed in the client. This section exists because
§21's own evidence requirement ("Test R1/R2") was checked against the batteries rather than taken from
§11, and that check failed.

### 19.1 What §21 landed

`status_is_current` already crossed the wire from `internal_api.preview_invitation_document` and was
ignored by every consumer. §21 wired it, without inventing a second source of truth:

| Piece | Where | What it does |
| --- | --- | --- |
| `usesRetiredRelease`, `retiredReleaseNotice` | `src/lib/invitationAuthoring.ts` | one derivation, one sentence, printed twice rather than written twice |
| freeze gate + notice | `src/components/invitation/PublicationPanel.tsx` | new required `retiredRelease` prop; the freeze control is held back with a reason that names the server as the refuser |
| explicit newer-release offer | `src/components/invitation/TraditionPackPanel.tsx` | compares the returned catalogue against the standing selection; chooses nothing by itself |
| page wiring | `src/pages/EditProject.tsx` | reads the retirement off the *same* document resolution as the findings, so the freeze button's two reasons describe one snapshot |

Publishing an already frozen version stays offered. That asymmetry is the schema's, not an oversight:
`versions_pack_release_gate` refuses a **new** freeze from a retired release and there is no
publication-time release gate, because a retired release must keep serving every document already
frozen from it.

§21's R1/R2 assertions were confirmed to exist in SQL, and the correct range is **H4, H8, H9, H9b, H9c**
in `stage5/70_document_resolution.sql` — §17 item 1 cited "H4–H10", and there is no H10. `H6` holds the
freeze refusal, `H7` the fresh-selection refusal, `H5` the `status_is_current = false` fact the editor
renders.

### 19.2 Three superseded numbers, and one process failure

§11 recorded "both Stage 5 chains produced identical totals" — and they did, for the schema that existed
then. `private.invitation_authoring_declaration` and the `authoring` key it produces landed in the
migration afterwards, to satisfy §19's requirement that the editor be driven by the resolved
declaration, and **the batteries were not re-run against it**. The recorded 92 was a number about a
schema that was no longer the one in the working tree.

| Claim in this audit | Was | Measured now | Where it is asserted |
| --- | --- | --- | --- |
| `private` helpers (§5 table) | 26 | **27** | `stage4/50_pack_release.sql` **I4** |
| total across the three schemas (§5 table) | 53 | **54** | **I4**, **I8**, **I10b** — three separate head-dependent expectations of the same fact, which is why one repair was not enough |
| `stage5/70_document_resolution.sql` (§11 table) | 92 | **99** | the suite's own reported total, cross-checked against its `NOTICE: PASS` lines by `stage5/run.sh` |

`stage4/50_pack_release.sql` and the two other Stage 5 batteries were unchanged in intent and still
report 428 / 57 / 111 / 50 at this head. Stage 4's own runner at the Stage 4 head is untouched by these
edits: every value changed here sits in a `s4_head() = 'stage5'` branch.

### 19.3 The two assertions that were wrong, not merely small

A count that moves is a nuisance; two assertions were contradicted by the design, and how they were
resolved is the part worth recording.

1. **P2** asserted the preview document is "exactly three things" and named
   `[invitation, issues, selected_release]`. The envelope is four now. Left alone it fails; widened to a
   substring or a `@>` containment it would have passed while losing the property it exists to hold. It
   now names all four keys and keeps the closed list, and **P2c/P2d/P2e** bind the new member to a
   producer: `private.invitation_authoring_declaration` is named, `SECURITY INVOKER`, pinned, executable
   by neither browser role, called from `internal_api.preview_invitation_document`'s own body, and
   re-scanned by the same culture-free body test **R8** runs on the resolver. That last point is a real
   gap **found**, not closed elsewhere: Stage 4's **S7** closure walk seeds the *freeze* path, so a helper
   reachable only from the *preview* path is outside its scan, and S8 would have reported a clean
   inventory while skipping the newest body. §24 owns the wider instrument; P2e covers this body now.
   **That instrument now exists** — it is group **C** of the resolution battery, audit §22.1, and it walks
   from every body a browser can reach in order to decide a document rather than from the freeze path alone.
2. **D4** asserted `override_rule` and `requires_venue` never appear anywhere in a preview document. The
   authoring block's whole purpose is to appear there — a screen that read the raw definition instead
   would be a second implementation of the contract. Deleting the assertion would have removed the
   guarantee; keeping it would have blocked §19. It is re-scoped into three claims that are each
   stronger than what they replace: **D4** the two words appear nowhere outside `authoring`; **D4b**
   every entry carries exactly the seven declared fields — no heading, no reviewed wording, no language
   map; **D4c** no entry pairs a rule with a kind that cannot honour it. **D6** and **D7** then pin the
   block's full contents, line by line in the resolver's own order, for a pack-selected wedding and for
   the wedding that chose no pack.

D6's expectation is the same literal whether the wedding stands on release 1 or release 2, because
release 2 differs from release 1 in one line of *wording*. That is not an accident being tolerated:
choosing a newer release changes what a guest reads, not what controls a host is offered, and the
assertion says so.

### 19.4 Gates re-run for this closure

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 9 warnings — all `react-refresh/only-export-components` in `src/components/ui/*`, none in a file this section touched |
| `npm run product:check` | 175 active files, 0 violations |
| `npm test` | 26 files, **412** tests passed (was 400 before §21) |
| `bash supabase/tests/stage5/run.sh clean` | exit 0 — 428 / 57 / 111 / 50 / **99**, each cross-checked against its own PASS lines |
| `bash supabase/tests/stage5/run.sh legacy` | exit 0 — identical totals, so the §11 claim is now true again rather than merely recorded |

The SQL batteries ran in a throwaway container (`vivaahvarnam-stage5-$$`, removed by the runner's own
trap) plus one probe container this work created and removed by exact name. DueWeave's stack and this
project's `supabase_db_localvivaahvarnam` were not touched; 17 containers were running before and after.

## 20. §22 closure: what the renderer was asked to prove, and one line it was not owed (appended, not a rewrite)

Measured 2026-09-30 on the branch. §13's "Not done" paragraph named four owed cases; this section closes
them and records where each one turned out to be already held by something else.

### 20.1 The finding first: no production code moved

`InvitationRenderer.tsx`, `invitationSections.ts` and `publicInvitation.ts` are byte-for-byte what they
were before §22 — `git diff` for `src/components/invitation/InvitationRenderer.tsx` is empty at the end of
this section, after the two deliberate mutations below were reverted. That is not laziness standing in
for a result; it is what §22's instruction ("keep the renderer pack-agnostic", "no snapshot migration")
leaves you with once you check which halves already exist:

| §22 requirement | Server half, already measured | Client half before §22 | Client half now |
| --- | --- | --- | --- |
| `reviewed_pack` | **R1**, **R6**, **R6b** | `invitationSections.test.ts` asserted the arm | unchanged (was already tested) |
| `host` | **R4** | same file, no-pack document | unchanged |
| `host_override`, never inheriting pack credit | **R2**, **R3** | the *nice* case only: `overrodePackText: true` on a well-formed body | `will not hand a host's line the release's credit, whatever the payload offers it` — a host body carrying `language: 'en'` and `fallback_used: true`, which the projection never writes, still normalizes to the host's three facts and `toEqual` on an exact key set means no field can buy credit |
| `fallback` | **R5** (a `ta` request reaching an `en` line, `body_fallback_used = true`) | **nothing** — no test anywhere put `fallback_used: true` in front of the client | `reports a release's declared fallback…` (data: `source`/`language: 'en'`/`fallbackUsed: true`, `requested` still `'ta'`, no issue) + `draws a release's English fallback with the page still in the wedding's own language` (page: `lang="ta"`, line drawn, no `lang="en"`, no provenance word) |
| unknown **optional** section does not crash the guest renderer; handled upstream | **I8** blocking record; the authoring guard refuses such a definition outright (**V**-group case **R12**, `60_definition_vocabulary.sql:211–212`, sqlstate `23514`) | required-section case only (fixture index 1, `required: true`) | optional case added at both layers: the skip + `render.unknown_kind_skipped` naming `venue_list`, and the guest page losing one paragraph and keeping its `lang`, its names and its date |
| unknown **required** section: freeze blocked before publication | **I8** + the version gate's refusal on blocking findings (**F5**, **F6**) | the client's freeze control (`publicationPanel.test.tsx` "holds the freeze button back while the server has a blocking finding") | unchanged |
| Stage 3/v1 snapshot still renders | **C11c** refuses it: `public_invitation_dto(1, …)` *and* `(2, …)` both return NULL for the bytes this repository's Stage 3 build actually froze — read §20.4 before treating this row as a pass | only a v2 document with `sections` *deleted* — never the real Stage 3 fixture | `legacyGuestPayload()` through the parser and the renderer, and the pair test below |
| Stage 4/v2 snapshot still renders | groups R/P/H | the packed fixture, by many assertions | named as one of the two historical shapes in `renders a Stage 3 document and a Stage 4 document from one code path` |
| no snapshot migration | no migration `UPDATE`s a stored snapshot — the only writes to `invitation_versions` in `supabase/migrations/` are INSERTs (measured by grep, and it is a claim about the repository rather than a runtime behaviour, so it is recorded here rather than turned into a unit test) | — | the pair test above shows the same component drawing both shapes with no branch on which produced them |

Two of those rows hold by composition rather than by one assertion, and saying which is the difference
between a record and a boast.

**"Unknown required section: freeze blocked before publication" is proven in three parts, and cannot be
proven as one.** **I8** shows the checker emitting `kind_unrenderable` with `blocking: true` for a
snapshot whose section list carries a kind no renderer knows; **F5** and **F6** show
`create_invitation_version` refusing a freeze when the engine reports a blocking finding; **R12** shows
the definition guard refusing to *store* such a section at all. There is therefore no reachable input
for a single assertion that freezes an unknown kind through the host's own RPC — which is the correct
outcome for a two-gate design and not a hole in the evidence, but it is stated as composition because no
test in this repository pretends otherwise.

**The v1 row is not a pass, and §22's line about it is only half satisfiable.** See §20.4.

### 20.2 The two new instruments were verified by breaking each promise on purpose

A test that passes against code that was never wrong proves nothing, so both headline assertions were
run against a mutation before being kept:

| Mutation to `InvitationRenderer.tsx` | Expected | Measured |
| --- | --- | --- |
| `lang` derived from `invitation.traditionPack?.key === 'z-other-pack-key'` — a real pack branch | the identical-page test goes red, nothing else | `1 failed | 34 passed`, the failure reading `the page changed shape over another release of another pack: expected '<article lang="en" …'` |
| `lang` taken from the first section body whose `fallback_used` is true | the fallback test goes red, nothing else | `1 failed | 34 passed`, failing only `draws a release's English fallback…` |

Both were reverted; the file's diff is empty, and its §J line — `lang={invitation.language.primary ?? undefined}`
at line 366 — is the original. The pack-agnostic test is the discriminating one: it renders one frozen
document under four identities (another pack and release number, no pack block at all, another template)
and compares `innerHTML` against the baseline byte for byte, which is the only form of the instruction
that can fail.

### 20.3 Gates re-run for this closure

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 9 warnings — the same pre-existing `react-refresh/only-export-components` set in `src/components/ui/*` |
| `npm run product:check` | 175 active files, 0 violations |
| `npm test` | 26 files, **419** tests passed (§19.4's 412 + the 7 above: 3 in `invitationSections.test.ts`, 4 in `invitationRenderer.test.tsx`) |
| `npm run build` | **not re-run.** Only files under `src/test/` changed in this section, which are not in the app's import graph, so §13's 13.94 kB / 4.53 kB gzip renderer chunk is unchanged by construction rather than by re-measurement. It gets re-measured at §30 and §34. |

No SQL ran for this section, and none was owed: the server halves of all four provenance cases are group
R's, and this section changed no migration and no battery. What reading the SQL *did* turn up is §20.4.

### 20.4 "A historical Stage 3 snapshot still renders" is true of this client and false of this server

§22 asks for two historical render guarantees and one non-guarantee: a Stage 3/v1 frozen snapshot still
renders, a Stage 4/v2 frozen snapshot still renders, and no snapshot migration is required. The client now
proves the first two from their real fixtures. The server does not honour the first one at all, and this
is the sentence in this section that a reader most needs from the audit rather than from the tests:

- **C11c** (`supabase/tests/stage4/50_pack_release.sql:3312`) asserts
  `private.public_invitation_dto(1, v_v1) IS NULL AND private.public_invitation_dto(2, v_v1) IS NULL` for
  a document transcribed from Stage 3's own committed `build_invitation_snapshot`, and **C11d** establishes
  that the transcription is a real document — every block typed, no `sections` key — so the refusal names
  the cause rather than catching junk.
- The projection refuses for **two independent reasons**, which the battery states as a pair: a version
  number this build does not project, and a missing section list that a v2 projection needs. Relabelling
  the version would not rescue such a row.
- Consequence, stated as the behaviour it is: on a database that has applied Stage 4's migration, a guest
  link pinned to a pre-Stage-4 version reaches the *unavailable* state, not the document. The client's v1
  path is the half that keeps a **payload** rendering — a bundle that already has the JSON keeps drawing it,
  which is what makes the promise worth testing at all — and it is not a claim that the platform will hand
  that JSON out.

Two things follow, and neither is a §22 repair.

1. **`50_pack_release.sql`'s own comment points at a document that does not say it.** The block above C11c
   says the consequence "is measured at the projection, not through the guest door, and
   `docs/audits/stage-4-tradition-pack-foundation.md` states it as a disclosed gap". That audit contains no
   such statement — `grep` for `disclosed gap`, `legacy`, `v1` and `unavailable` across the file returns no
   line about a Stage 3 snapshot. §36 owns the wording fix; the pointer is recorded here so it is not lost
   between now and then.
2. **Whether a real pre-Stage-4 link exists to break is a deployment question, and this repository cannot
   answer it.** Both chains of the Stage 4 battery apply every migration before they freeze anything, so no
   row frozen by the Stage 3 build exists in either database to be re-read — the battery says so itself.
   There is no hosted Supabase in scope for Stage 5 (directive prohibition), so no real legacy row was
   inspected anywhere. If such a row exists in some future deployment, the honest options are a forward
   projection that accepts v1 bytes or an explicit "this invitation predates our current format" page; a
   silent unavailable is the one outcome nobody chose. That decision belongs to the human review after this
   tranche, not to §22.

What §22 therefore gets credit for: the guest renderer, the normalizer and the parser keep honouring the v1
shape, and a v2 page and a v1 page now go through one code path with no branch on which stage produced them.
What it does not get, and is not claimed anywhere in the tests: that a v1-frozen link resolves.

## 21. §23 closure: the Stage 5 HTTP battery, and the seven places the transport disagreed with the draft (appended, not a rewrite)

Measured 2026-09-30 on this branch, against this repository's own local stack (`project_id
= localvivaahvarnam`, Kong on `http://127.0.0.1:54400`). §23 asks for a Stage 5 suite that goes through
Kong → PostgREST → JWT → RLS/functions → database rather than through `SET ROLE`, on synthetic TEST ONLY
content, in six areas, run twice — once from zero, once without a reset.

### 21.1 What was added

| file | lines | what it is |
| --- | --- | --- |
| `supabase/tests/api/stage5_pack_driven_http.test.mjs` | 1598 | 28 cases in 6 groups, 259 `assert.*` calls, one file picked up by `run.sh`'s existing `supabase/tests/api/*.test.mjs` glob |
| `supabase/tests/api/fixtures/stage5_http_pack.sql` | 221 | the fixed seed: 4 packs, 5 releases (two `approved`, one `draft`, one `reviewed`, one `deprecated`-only), all `definition_schema_version = 2`, five sections that between them cover every v2 arm (`override_rule` in all three spellings, `requires_venue` on/off). Applied through the trusted route in `before()`, idempotent — a second apply reports 0 mutations — and it walks each release to its state one *legal* edge at a time so the fixture cannot teach the lifecycle a shortcut |
| `supabase/tests/api/fixtures/stage5_mint_pair.sql` | 124 | the one pair of rows the retirement journey is allowed to spend: R1 approved, R2 stopped at `reviewed` so that approving it is an event *inside* the run. Minted with fresh uuids per run for the reason §21.2 records |

The file starts the same way every HTTP file in this directory does — refuse unless the four containers of
*this* project are running, refuse unless `SUPABASE_LOCAL_URL` is loopback, and it inherits `run.sh`'s
second interlock that the URL's port equals `supabase/config.toml`'s `[api] port`. Nothing in it reaches a
remote project.

### 21.2 The two official runs

Directive wording: "Run the Stage 5 HTTP suite twice: first from zero / second without reset. Both must
pass. No test may require residue from run 1."

| | how the database got there | stage3_publication | stage3_security | stage4_tradition_packs | stage5_pack_driven_http | runner |
| --- | --- | --- | --- | --- | --- | --- |
| run 1 | `npx --yes supabase@2.118.0 db reset --local --no-seed` re-applied all 19 migrations, then `bash supabase/tests/api/run.sh` | 38 pass | 56 pass | 28 pass | **28 pass, 0 fail** | `RESULT: PASS`, exit 0 |
| run 2 | the same `bash supabase/tests/api/run.sh`, no reset, run 1's rows still in the catalogue | 38 pass | 56 pass | 28 pass | **28 pass, 0 fail** | `RESULT: PASS`, exit 0 |

150 tests in each pass, the same per-file counts in both, and `run.sh`'s post-run leak check came back to
`weddings 0 / auth.users 0 / invitation_drafts 0` both times. The §23 file was therefore never the only
thing green: it runs alongside the Stage 3 and Stage 4 HTTP files in sequence against one shared database,
which is why it mints its own rows instead of spending the seed's.

The residue that growth *is* not a dependency: run 1's `before()` reported 7 Stage 5 catalogue rows, run 2
reported 9 — one new undeletable mint pair, exactly as designed. The five seed rows read the same in both
runs (`stage5_http_v2` 1 and 2 `approved`; the draft-only, reviewed-only and deprecated-only packs still in
their own states), which is the mechanism that lets run 2 tell the same story without inheriting run 1's
ending. Ruling A2 refuses `DELETE` of a release that has left `draft`, so each pass leaves its mint pair
behind permanently until a from-zero reset; `RET-05` prints the catalogue rather than asserting it away, and
§39 records the count.

### 21.3 Coverage against §23's six areas

| area | cases | the refusal or the guarantee each one pins |
| --- | --- | --- |
| CATALOGUE | CAT-01…06 | anon cannot enumerate the release catalogue (and the grant, not the transport, is what stops it — proven by the same call as `authenticated`); an authenticated host sees the approved selectable TEST ONLY release in customer shape; `draft` and `reviewed` are not selectable *and* not visible as a choice; a `deprecated` release cannot newly be selected whatever its pack looks like; a guessed uuid and a real-but-invisible one get an identical answer, so the API is not an existence oracle; another account's wedding cannot be pointed anywhere — and that answer is silence, not a refusal |
| BROWSER WRITE SECURITY | WRT-01…04 | no create/edit/delete of a pack or release from a browser role; no read or write of a review, machine disclosure, digest or maintenance timestamp *by column name*; no maintenance step callable over HTTP in either spelling, with the maintenance surface pinned to `internal_api`; the only `internal_api` function a browser role may call is the one §23 built a door for |
| PREVIEW | PRV-01…07 | the answer is a product shape (four named parts, records with six fields, rules with seven, no words from the release); incomplete host prose / missing people / missing events / a venue the release promises but the event lacks are each their own blocking record; a forbidden host line is an *advisory* that keeps the reviewed wording and does not stop the freeze; a complete document carries no blocking entry in either language the release covers; the preview is the owner's and the refusal names nothing about the row |
| FREEZE | FRZ-01…03 | the document the preview called incomplete is refused by name with no version row written; a complete document freezes and the version pins the release the preview named; the invitation a host previewed and the one a guest is given are the same bytes |
| PUBLICATION | PUB-01…03 | an anonymous guest resolves the frozen version with the sections in the release's own order; a recursive walk of the whole response finds none of `review_packet_hash`, `review_label`, `review_basis`, `review_scope`, `reviewed_by`, `reviewed_languages`, `machine_assistance_notes`, `source_reference`, the raw definition, internal ids or maintenance fields; no credential, wrong credential and revoked credential all get the same shape |
| RETIREMENT | RET-01…05 | a published guest document survives its release being retired byte for byte while a new freeze is refused; a retired release cannot newly be selected by its own host or anybody else; approving a newer release moves nothing; only an explicit host selection puts a second version on the wedding |

### 21.4 Seven places the transport disagreed with the draft

Each of these began as an assumption in the first version of the file and was corrected against measured
behaviour, so each is now asserted at its real value with a comment naming the wrong guess. That is also the
form of proof here: every one of these cases was seen red before it was seen green.

1. **An unknown RPC name is 404 / `PGRST202`, not 400.** Message: `Could not find the function api.<name>
   without parameters in the schema cache`.
2. **Omitting `Content-Profile` is not a neutral act.** PostgREST then searches `public`, so a call to a
   real function that lives in `api` answers 404/`PGRST202` for a function that does exist — which is how a
   missing header can be misread as a missing grant. `FRZ-01`'s raw fetch carries the header, and the earlier
   404 is recorded in the file so nobody re-derives it.
3. **A PATCH signed by a non-owner is silence (200 with `[]`), not a refusal.** Three catalogue cases first
   reported a passing "cannot select" that was really RLS answering nothing. The selection-gate assertions now
   run as the owner (403 / `42501`, `hint: null`), and the out-of-owner call is kept as its own assertion about
   the *other* rule.
4. **Two freeze refusals, two codes.** Completeness is raised as `check_violation` (`23514` → HTTP 400) and
   lifecycle as `insufficient_privilege` (`42501` → HTTP 403) — "your invitation is not ready" versus "you may
   not do this at all", which is a difference a host can be shown.
5. **A frozen snapshot carries no release uuid, on purpose.** `build_invitation_snapshot`'s own comment gives
   the reason ("an identifier in a published payload is a leak with no use case"), so pinning is asserted by
   reading `public.invitation_versions`, not the payload (`FRZ-02`, `RET-04`).
6. **`wedding_events` has a composite `(wedding_id, venue_id)` foreign key.** A venue cannot be shared between
   two weddings: the first draft's single shared venue failed with `23503` before any test reached its own
   claim. Each fixture wedding now mints its own venue through the same client, which is also the honest data
   model — `venues` is owner-scoped.
7. **A wedding holds exactly one live guest link.** `publish_invitation_version` returns the raw credential in
   the call that created it and answers `path: null, link_reused: true` on a later publish, repointing the
   existing address. `RET-04` was rewritten around that: what the retirement must not move is the *frozen
   bytes*, proven from the two version rows (`1|Minted to be retired…`, `2|Minted to be approved…`) plus one
   `active` publication and one `revoked` one — not from two live links, which the product does not have.

### 21.5 An instrument weakness this found, which §36 owns

`run.sh` validates deployment by comparing `supabase_migrations.schema_migrations` against the migration
file count, and that check passed (`ok 19 migrations applied`) against a stack whose *function bodies* were
older: `private.invitation_authoring_declaration` did not exist and `internal_api.preview_invitation_document`
had no `authoring` key. So a count match is not a schema match, and an HTTP suite can be handed failures
that belong to the stack rather than to the code. The repair was the command `run.sh` itself names
(`npx supabase db reset --local --no-seed`), verified before re-running by two cheap reads —
`select count(*) from pg_proc where proname = 'invitation_authoring_declaration'` and
`position('authoring' in prosrc) > 0`.

Whether `run.sh` should grow a fingerprint of deployed function signatures is a decision with consequences
for every later stage, so it is recorded here rather than patched silently in a closure section, and §36
carries the documentation item.

### 21.6 What this battery does not claim

- **No case here is cultural review.** Every `reviewed_by`, `review_label`, digest and `machine_assisted`
  value in the fixtures is synthetic, written by the maintenance route to make the *lifecycle* reachable for
  a transport test. `RET-05` is a refusal rather than a property report: no release whose provenance points at
  the Tamil candidate artifact may hold any state past `draft`, and none may carry a reviewer or claim human
  authorship — which is directive §23's "do not approve the Tamil candidate", asserted against this stack at
  the end of this run. The candidate's own probe row is read by name and reported, so an empty result cannot
  silently mean "nothing happened".
- **Nothing left this machine.** No remote project, no hosted Supabase, no deployment, no merge, no Stage 6.
- **This was not zero-network, and does not say it was.** The from-zero run shelled out to
  `npx --yes supabase@2.118.0` (npm registry; the Postgres image was already in local Docker cache) and the
  suites make HTTP requests to a loopback port. §32 classifies them; this section only refuses the phrase.
- **No browser, so no UI claim.** §23 qualifies the transport and the database behind it. §§27–29 own the
  React routes over the same stack, and §31's accessibility pass is a separate obligation; no case in this
  file touches a DOM and none claims WCAG conformance.
- **The callable surface did not grow in §23.** Stage 5's one new RPC, `api.preview_invitation_document`, was
  added by the migration and is already pinned by `stage4_tradition_packs.test.mjs` CAT-08 (nine names, with
  the ruling for the ninth recorded in that case's comment); §23 exercises it and adds nothing to it. The two
  maintenance-only reads the §23 suite reaches for (`catalog`, `inspect`) stay in `internal_api` and are
  asserted unreachable over HTTP by WRT-03, in either spelling.

## 22. §24 closure: the pack decision measured as behaviour, and the culture-free scan widened to the whole document path (appended, not a rewrite)

Measured 2026-09-30 on this branch. §24 states one property — no active application source may contain
decision logic that *derives or selects* a tradition pack from religion, caste, community, sect, surname,
family name, given name, location, city, state, region, ethnicity or language — and then draws a boundary
inside its own list: "language can choose TRANSLATION/FALLBACK behavior inside an already host-selected
release. Language must NOT choose the release itself." It also names four product claims to refuse, asks for
hostile self-tests for every rule, near-miss controls so honest prose does not become noise, at least two
actual decision-logic tests over profiles that deliberately differ in name, language and location-like data,
and one prohibition that shapes the whole section: "Do not create demographic inference merely to test
refusing it."

The answer is two instruments that fail for different reasons, which is the only way the property can be
held at all. A text rule can refuse the *shapes* a derivation arrives in and cannot show that the decision
this build makes is invariant; running the decision can show invariance for three profiles and cannot stop a
fourth shape being written tomorrow. §22.1–22.2 are the shapes, §22.3 is the behaviour, and §22.4 is the one
mutation that was seen refused by both.

### 22.1 The scan widened: group C, seventeen bodies, found rather than listed

`supabase/tests/stage5/70_document_resolution.sql` grew a `C` group (1358 → 1534 lines; the file is LF,
verified 0 CR bytes) and the battery's measured floor moved 99 → 124. The ledger comment now breaks the
total down as "BASE 4, PUB 5, S 7, R 10, I 19, F 13, P 11, H 15, D 9, C 25, T 6 — 124 in all", which is the
arithmetic a reader can check rather than a number to trust.

What the group does, and why Stage 4's instrument was reused instead of the blunter one:

| assertion | what it measures |
| --- | --- |
| **C1** | the call closure from the six seeds — `api.preview_invitation_document`, `api.create_invitation_version`, `internal_api.preview_invitation_document`, `internal_api.create_invitation_version`, and the two release gates — equals exactly seventeen named bodies, `= pg_temp.s7_sorted(ARRAY[...])`, so the inventory is a closed list the walk produced, not a list the file wrote |
| **C2** | the closure reaches `{api, internal_api, private}`: a document is not decided in only one schema, and a scan that only looked at `private` would have missed the two `api` doors Stage 5 added and the `internal_api` bodies behind them |
| **C3** | the two trigger seeds are *derived*, not assumed: the gates the walk starts from are read out of `pg_trigger` joined to `pg_attribute` for the column `tradition_pack_release_id` (`a.attnum = ANY (t.tgattr::int2[])`, `NOT t.tgisinternal`), so a third gate added on that pointer shows up here as a name missing from the closure instead of being scanned by nobody |
| **C4** | every name in the inventory resolves to a body this run can read — count of unresolved = 0, which is what stops a renamed or moved producer from being reported as a clean scan of one fewer function |
| **C5** | one culture-free body test per closure member, seventeen rows, each naming the function it cleared |
| **C6–C9** | four controls on the scan itself: a planted branch is caught, a banned word behind a comment is not, `'pack_key', p.pack_key,` in code is not mistaken for branching on it, and `section` is not `sect` |

The vocabulary is Stage 4's `s4_cultural_hits` **term for term**, copied into `pg_temp.s7_cultural_hits`
rather than re-invented, with its `s7_code_only` comment-stripping step in front of it. That reuse is the
point, not a convenience: Stage 5 moved the decision (a browser now calls `api.preview_invitation_document`,
whose body lives in `internal_api`, and two producers — `private.wedding_invitation_definition` and
`private.invitation_authoring_declaration` — are called by no Stage 4 body), so the *set* had to widen. The
*claim* did not change, and a widened scan that quietly used a different word list would have been a weaker
claim wearing a bigger number.

Why not widen R8's blunt whole-source test instead was measured before writing anything, and the answer is
in the group's own preamble: the whole-source word test is false for four of these seventeen bodies, for two
reasons both already answered by Stage 4's instrument. Three fire on `pack_key` appearing in **code** —
`'pack_key', p.pack_key,`, the line that credits the release a document came from, which is required
behaviour and is exactly what C8 refuses to confuse with branching on it. The fourth fires on 'tamil' and
'malayalam' appearing in its **comments**. Widening the blunt test would therefore have meant deleting
credit lines and comments to make a number appear. R8 and P2e keep their stricter word list untouched —
the two bodies they name genuinely contain none of those words, comments included — so the narrower claim
about those two functions stays the narrower claim.

The walk's non-muteness is structural rather than asserted: eleven of the seventeen names are reachable only
by following a call edge from a seed, and C1 pins the exact set, so a walk that stopped early would print a
different array and fail.

Verification, at two levels:

- the official chain, `bash supabase/tests/stage5/run.sh clean` and `bash supabase/tests/stage5/run.sh
  legacy`, both exit 0, both printing `stage 5 70_document_resolution: PASSED (124) [assertion lines
  observed: 124]` — the runner's own `reported == observed` cross-check, which is what makes 124 a count of
  assertions that actually ran.
- a label-level read, because a green chain deliberately hides which assertions were green: the group was
  replayed inside `BEGIN … ROLLBACK` against the live local stack and printed all 25 `PASS` labels. The
  replay's `DO $C$ … END $C$;` block was then diffed against the battery file's own block (104 lines each
  side, byte-identical after the runner's `\r` normalisation), so the labels quoted here are the battery's
  assertions and not a hand-copy of them. C1's line, verbatim: `PASS C1 the document path is these 17
  bodies, found by walking the call closure from every browser-reachable document RPC plus the release gates
  rather than from a hand-written list (api.create_invitation_version, api.preview_invitation_document,
  internal_api.create_invitation_version, internal_api.preview_invitation_document,
  private.build_invitation_snapshot, private.default_invitation_definition, private.dto_text,
  private.invitation_authoring_declaration, private.invitation_issue_messages,
  private.invitation_issue_records, private.map_link_or_null, private.pack_text_for,
  private.public_invitation_dto, private.require_approved_pack_release, private.require_frozen_pack_release,
  private.resolve_invitation_sections, private.wedding_invitation_definition)`. The replay wrote nothing:
  every function it creates is in `pg_temp`, and the transaction rolled back.

### 22.2 Four rules added, and the precision that keeps the boundary writable

`scripts/check-product-contract.mjs` went from 23 to 27 rules (+146 / −15 lines). The four new ones are all
about §24's sentence rather than its nouns, and each carries a hostile fixture in `selfTest()`:

| rule | the shape it refuses | why it is written this way |
| --- | --- | --- |
| `pack-selection-derived-by-name` | `suggestTraditionPack(…)`, `releaseIdFor(host.primary_language)`, "pack recommendation", "release derived" | the same decision wearing a function name: `deriveRelease(profile)` hides the identity column inside `profile`, so a proximity rule cannot see it. `select` is deliberately absent from the verb list — `selectTraditionRelease` is this product's own write, which *is* the host deciding |
| `place-tested-for-a-tradition` | `if (wedding.city === "Madurai") packKey = "tamil-english-foundation";` | a place read as a proxy for a community. Kept apart from the name rule because it does not need a selection token to be a violation: inferring a tradition from a district is the invention whoever consumes it |
| `tamil-candidate-status-claim` | "the Tamil candidate is approved for customer use", "it is now selectable for the Tamil candidate" | §24's first three named claims. The candidate noun is required, because `release 2 is approved` is true of a synthetic TEST ONLY fixture and must stay writable in the panel that lists it; a copula is required, which is what lets the honest denial — "the Tamil candidate is **not** approved" — stay a sentence the product can print |
| `machine-assisted-claimed-approved` | "The AI-generated ceremonial wording is human-reviewed", "machine-assisted wording counts as approved content" | §24's fourth and fifth. The negation guard is the whole of the precision: "AI-assisted wording has not been reviewed by a Tamil reader" stays writable and the silent merge does not |

The language boundary itself is held by a rule that predates this section and had to be read against it.
`tradition-selected-from-identity` requires an operator *and* a selection token *and* that the identity word
not be in object-key position. The middle condition is what makes the rule about logic instead of vocabulary;
the third is directive §24's permitted half, measured at `src/lib/traditionPackResolver.ts:273`, where the
resolver builds `{ source: 'reviewed_pack', packKey: source.packKey, language: lang as string, fallbackUsed }`
— a language choosing which wording of the release the host already owns is drawing. A vocabulary-only rule
would have forbidden the fallback feature, and `language-gated-rite`'s comparison requirement is the same
lesson from the other direction: its first version matched any line carrying both classes and fired on the
landing page's display name `title: "Telugu Ceremonial"`, which is a style name, not a branch. That name is
still in the repository and is now a checked near-miss rather than an unexplained exemption, and it remains
disclosed as a content question for the human review in `docs/content-review/` — §24 forbids logic, and it
did not authorise renaming a design direction.

Near-miss controls grew with the rules: eight new `MUST_NOT_MATCH` phrases (the resolver projection, the
host's own write, the candidate denial in both dialects, an address validation, a layout-region lookup, and
the boundary sentence itself), and the `culturalNearMiss` block inside `selfTest()` is read at an in-scope
`src/` path — seventeen entries now, of which these eight are §24's — because the Stage 4 rules are scoped
to `src/` and
a governance sentence in `docs/` would pass even against a rule that had been widened to the whole
repository. The twin, `scripts/product-contract.test.mjs` (+38 lines), adds both halves of that argument:
six rules fired against their real derivation shape, scanned under a `src/pages/Editor.tsx` label — a path the
repository has no file at, deliberately, because these rules are scoped by path and the fixture has to be read
as if it sat inside `src/` for the scan to reach it; and four measured shapes from
`traditionPackResolver.ts` where a language value and a pack identifier sit close enough to look like one to
a vocabulary rule, asserted to produce nothing.

The coverage check is two-way, which is what makes "hostile self-tests for every rule" more than an
intention: a rule without a fixture fails the self-test, and a fixture naming an unknown rule fails it too,
so neither half can rot without the other noticing.

### 22.3 The decision itself: nine tests over three profiles that differ on every axis §24 names

`src/test/culturalSafetyDecisionLogic.test.tsx` (578 lines, new, 9 tests) runs the real adapter
`getSelectedTraditionRelease`, the real picker `TraditionPackPanel`, and the real
`resolveTraditionPack` against three weddings: Tamil-speaking/Madurai with partners named Anaya Krishnan and
Karthik Raman; Urdu-speaking/Hyderabad with Imraan Sheikh and Nikhil Rao; English-speaking/Leeds with Meghana
Iyer and Sara Whitfield. Different owners, different rows, different names, different language columns
(`ta` / `ur` / `en` plus different `additional_languages`), different addresses, different coordinates — and
one pack, one release, one definition throughout.

What it asserts, against §24's two required decisions:

- **given no host selection**, all three profiles are answered `{ data: null, error: null }`, `queriedTables()`
  is exactly `["weddings"]`, and the host-visible radio shown as chosen is `No tradition pack — write it
  yourself`. Not an empty pack and not a failure: the same option the platform shows anybody who decided to
  write everything themselves. The layer below answers the same way — `resolveTraditionPack` with no source
  returns `{ sections: [], issues: [], release: null }` in all three languages, so no issue is invented to
  explain an empty choice.
- **given an explicit host selection**, all three get the same release object *and* the same query
  signatures, with the two ids masked so a primary key cannot defeat the comparison. That is §24's second
  sentence expressed as data: the identity around the selection is not an input to it.
- **language inside the release the host owns** is asserted in both directions at once, because that is where
  a boundary either gets respected or quietly erased: the three profiles draw three different receipts from
  one release (`ta` reads the Tamil line with `fallbackUsed: false`; `ur` is not covered by the release, so it
  arrives at the English line with `fallbackUsed: true`; `en` reads the same English line directly), the
  Tamil-only section that offers no fallback comes back as a named `read.language_unavailable` gap rather
  than a guess, and through all of it the section list and `release.packKey#releaseNumber` are identical.
- **no identity column is touched on the way to either answer.** `IDENTITY_COLUMNS` names the columns that
  carry identity in the three tables that store it, `wedding_people` and `venues` are *planned readable* so a
  layer that wanted a name or an address could have had one, and the assertion is that no such query happens
  across all six runs. Its control is in the same test: the tables it did read are the three expected ones,
  `languages` and `tradition_pack_release_id` are named as columns it legitimately asked for, and the profile
  strings are checked to contain "Krishnan" and "Madurai" — so an empty result means the scan saw plausible
  bait, not that the bait was absent.

§24's "do not create demographic inference merely to test refusing it" is honoured by construction: nothing
in this file adds a branch to be denied. The tables it forbids itself against are real and already owned by
the product; the only invented thing is a third wedding.

### 22.4 One mutant, refused twice, restored and re-hashed

This section was not going to claim two instruments work without watching them work. At 22:34 on
2026-09-30, one line of production code was changed — a selection read that also asks for the wedding's own
language column:

```
- const SELECTION_COLUMNS = 'id, tradition_pack_release_id';
+ const SELECTION_COLUMNS = 'id, tradition_pack_release_id, primary_language';
```

Both layers refused it, independently, naming the same file:

- `node scripts/check-product-contract.mjs`: `Product contract FAILED — 177 file(s) scanned, 1
  violation(s): src/integrations/supabase/traditionReleases.ts:73:1:
  [tradition-selected-from-identity] connects an identity, name, place or language field to a tradition pack
  selection`.
- `npx vitest run src/test/culturalSafetyDecisionLogic.test.tsx`: `Test Files 1 failed (1) / Tests 3 failed |
  6 passed (9)`, with `AssertionError: Tamil-speaking, Madurai: expected [ 'weddings.primary_language' ] to
  deeply equal []` twice (the no-selection and the selected runs) and, in the aggregate scan, the six-element
  received array `['weddings.primary_language', …]`.

Worth stating plainly about what that mutant is: a column in a select list is not yet a branch — nothing in
the product would have *chosen* a pack from it. It is the shape §24's sentence makes unreadable, the
one-edit-away version of a derivation, and the honest reading of these two refusals is that this build
treats even the *read* of an identity column on the selection path as a finding. That is stricter than the
directive's minimum, and it was verified rather than inferred.

The file was restored immediately and verified by an independent route: `sha256sum` returned
`01523b3f8a0f9b9e7758220cad4c14087c16aeb71c3f442d2076edf4e6e42cee`, the identical hash it held before the
mutation; `node scripts/check-product-contract.mjs` returned `Product contract OK — 177 active file(s)
scanned, 0 violation(s).`; and the suite returned `Tests 9 passed (9)`.

### 22.5 The gates, as measured for this section

| gate | command | result |
| --- | --- | --- |
| cultural-safety decision logic | `npx vitest run src/test/culturalSafetyDecisionLogic.test.tsx` | 9 passed (9), 1 file |
| checker, against the repository | `npm run product:check` | `Product contract OK — 177 active file(s) scanned, 0 violation(s).` |
| checker, against itself | `node scripts/check-product-contract.mjs --self-test` | `Product contract self-test OK — 27 rule(s) verified.` |
| checker twin | `scripts/product-contract.test.mjs` inside `npm test` | 14 tests, all passing |
| whole node suite | `npm test` | `Test Files 27 passed (27) / Tests 428 passed (428)` |
| Stage 5 SQL chain | `bash supabase/tests/stage5/run.sh clean` | exit 0 — `428 / 57 / 111 / 50 / 124`, each with `reported == observed` |
| Stage 5 SQL chain, legacy fixture | `bash supabase/tests/stage5/run.sh legacy` | exit 0 — identical five totals |
| types | `npm run typecheck` | no output, 0 errors |
| lint | `npm run lint` | `✖ 9 problems (0 errors, 9 warnings)`, all `react-refresh/only-export-components` under `src/components/ui/*` — pre-existing, and 0 errors is the gate |

### 22.6 What §24 does not claim

- **The scanner is not a proof.** It matches line shapes across active source (`src/`, `index.html`,
  `README.md`, `content/`, and for the two copy rules `docs/product/` and `docs/content-review/`), and it
  excludes `docs/audits/` and `scripts/` by design, because a historical record and the checker's own
  vocabulary are not active product claims. It cannot see a derivation that never puts an identity word and a
  selection token on one line; §22.3's tests are what measure behaviour, and §22.4 is the only evidence that
  the two instruments are not both decorative.
- **One mutant is one mutant.** Both layers fired on a read-shaped change; neither was fired against a
  genuinely conditional derivation in production code, because writing one to watch it fail would have been
  §24's forbidden act — inventing demographic inference to test refusing it. The hostile fixtures cover that
  shape at rule level; the behaviour level stays covered by the profiles.
- **No browser, no DOM, no WCAG.** These tests run against a fake PostgREST client and pure functions. §24
  asks nothing of the viewport and this section claims nothing there; §§27–29 own browser journeys and §31
  owns accessibility, with no conformance claim in either.
- **The three profiles are invented.** Names, cities and coordinates were written for this file so that the
  invariance assertion is a fact about the decision rather than about shared data. No real host's row was
  read anywhere in §22, and the profiles are not demographic sampling — which is why they can differ on
  language and place without the build being said to *know* anything from either.
- **The Tamil candidate's state was not changed here.** §24 added *copy* rules that refuse the claims; the
  candidate remains `draft` / `machine_assisted = true` / `human_reviewed = false` /
  `customer_selectable = false`, and that state is asserted against the live stack by `RET-05` in the HTTP
  battery (§21.6), not by this section.
- **One reachability finding is disclosed, not closed.** `private.invitation_freeze_issues` — Stage 4's
  completeness projection, re-declared forward by Stage 5 — appears in none of C1's seventeen names. No
  browser RPC and no document-path trigger reaches it at this head; the only caller left is Stage 4's own
  battery. It is a `REVOKE`'d `private` helper, so this is not a privilege finding, and deleting it would be
  a change to a Stage 4 guarantee rather than to §24's scope. It is recorded here for §33's independent
  review and §36's documentation pass, and §22 does not describe it as resolved.
- **Nothing left this machine.** No remote project, no hosted Supabase, no deployment, no merge, no Stage 6.

## 23. §25 closure: the tool's refusals become exit codes, and two of them had to be earned (appended, not a rewrite)

Measured 2026-09-30 on this branch. §25 gives the instrument one sentence and the work a list: "The CLI
exists and was manually exercised. Now pin it." The list is what made this the longest-running section of
the tranche so far — six target refusals that must each be exit 2 (no target, hosted Supabase URL,
non-loopback URL, `--linked`, `--project-ref`, invalid local container name); the read-only verbs (`list`,
`inspect`, `retention`, `validate-release`, `review-packet`); "mutation requires `--yes`" for all six
mutating verbs; "No delete command."; "Stale review hash: exit 2 / database unchanged"; "review packet:
same bytes → same digest / one character → different digest"; and stdout/stderr checked for a
"password-like URL / service key / JWT / raw invitation credential — Do not print them."

What existed before this section was §F's header comment and the fact that a person had run the tool. That
is evidence about one afternoon. The tool is the only surface in this build that can move a release from
`draft` to `approved` — the instant at which platform wording becomes something a customer can select — so
the guarantees that make that power local, explicit and digest-bound had to become things a run fails on,
not things a file asserts.

### 23.1 the instrument, and what it deliberately does not re-derive

`supabase/tests/api/stage5_admin_cli.test.mjs`, 940 lines, 5 suites and 36 tests (CLI-TARGET 9,
CLI-SURFACE 7, CLI-READ 15, CLI-SECRET 3, CLI-RESIDUE 2), measured green twice over: standalone
(36/36, exit 0, 245.9 s) and inside the full API battery (§23.7).

It runs the tool as a **subprocess** because the behaviour §25 names *is* the process contract — exit code,
stdout, stderr — none of which an `import` can observe, and an import would additionally share the parent's
`argv` and environment. `spawnSync` with an argv array means no shell, so nothing in the file is a quoting
test. Every invocation goes through one `cli()` wrapper, which records the child's full stdout and stderr in
a `LEDGER` that the secret audit then reads as a single body of text: the "nothing was printed" claim is
made over every run the suite performed, and its first test pins that at least 40 invocations were
captured, so the audit cannot silently degrade into a sample. Each child is also handed canary values
(a `postgresql://…:canary-pw-<tag>@…` URL in both loopback and hosted spellings, an `sb_secret-…` key, a
real-shaped `eyJ….….…` JWT, a raw `inv_<tag>_raw_publication_credential`) in its environment, so a leak
would have something to leak.

The file does not re-derive a hash. `supabase/tests/stage5/50_review_binding.sql` already proves in SQL that
`review_packet_hash` is produced by the database from the row's own material, that a submission against a
different digest writes nothing, and that the maintenance functions are revoked from every browser role; the
two HTTP batteries already prove the same rules through Kong → PostgREST → JWT; the lifecycle edges
themselves are Stage 4's guard. This suite drives the tool against those same functions and reads the rows
back, which is the only way to test the operator surface without duplicating the guarantees behind it.

### 23.2 the exit-code contract, including the two refusals that are not exit 2

The tool's contract, now pinned rather than documented: **0** it answered, **2** an operator refusal, **1**
the database or the route refused. §25's list is written as though every bad target is a 2, and measurement
said otherwise in two places, so the suite asserts the measured answer instead of the tidy one:

| input | measured | why this and not the other |
| --- | --- | --- |
| no target at all | **2**, names both supply routes | it refuses in `resolveTarget()`, before any connection, and the message offers `--via-docker` and `VIVAAHVARNAM_MAINT_DB_URL` rather than inventing one; stdout is asserted empty |
| hosted `supabase.co` URL, non-loopback URL, `--db-url-env` pointing at an unset variable | **2** | each is a target decision the operator got wrong; the non-loopback message names the *host*, not the URL, so the refusal cannot echo a connection string back |
| `--linked`, `--project-ref` | **2**, even next to a perfectly valid local target | a flag that means "some other project" is refused rather than silently ignored, which is the difference between a local tool and a remote tool with good intentions |
| `--via-docker-x`, `--via-docker=evil`, five malformed container names | **2**, by the name/prefix rule | the parser never lets a flag value be mistaken for the command, and a name that is not `supabase_db_…` never reaches docker |
| `supabase_db_this_repo_has_no_such_stack` | **1**, `ERROR:`, not `REFUSED:` | the shape gate is a *name* gate, not an existence gate: a well-formed name for a stack that does not exist passes the gate and then fails in `docker inspect`, which is a route failure. The test first asks docker itself to confirm the name is a ghost, so the exit code cannot be the answer to a question about a container that exists |
| approve against a `draft`, `--hash` naming a packet the row was never reviewed against at that moment | **1** | the lifecycle sentence belongs to the database guard; see §23.4 |

### 23.3 the verb surface, the `--yes` gate, and a delete command that is absent at three levels

- **Verb list.** With no command the tool prints the eleven verbs it offers and exits 2; the list itself is
  pinned, so a verb added without a test is a failing test rather than an undocumented capability.
- **All six mutating verbs refused without `--yes`.** For each of `create-pack`, `create-release`,
  `update-draft`, `submit-review`, `approve`, `deprecate`: exit 2, stdout carries the `# plan for <verb>`
  block (the operator sees what would happen before being asked to confirm it), stderr carries "nothing was
  executed" and "Re-run with `--yes`", and a whole-world row count over `tradition_packs`,
  `tradition_pack_releases`, `weddings` and `invitation_versions` is asserted byte-identical to before the
  six calls. The release the suite is walking stays `draft`, its `review_packet_hash` stays null, its
  `approved_at` stays null.
- **No delete command, proved three ways.** Eight plausible names (`delete`, `delete-pack`,
  `delete-release`, `remove-release`, `purge`, `destroy`, `drop-release`, `erase`) are each refused as an
  unknown command with the name quoted back, stdout stays empty, and the world count is unchanged. Then the
  tool's own source is scanned for `delete from`, `truncate` and any `'delete'` command arm. Then `pg_proc`
  is asked whether `internal_api` contains a function whose name or body could delete a pack row — count
  `0` — which is what turns "there is no delete verb" from a UI convention into a property of the schema.
  Ruling A2 already refuses deleting a release that has left `draft`, so the absence is not a gap.
- **Operands.** A malformed uuid, hash, slug, decision or language list is exit 2 *with `--yes` supplied*,
  before any call, so argument validation is not accidentally downstream of the confirmation gate.

### 23.4 the walk, and the digest determinism §25 asked for

The read-only verbs are answered against the tool's own fixture (`list`, `retention`, `inspect`,
`validate-release`, `review-packet`), and the packet is then held to the two properties §25 named. Same
bytes → same digest, checked twice over; one character → different digest, produced by editing
`heading.en` from `Invitation` to `Invitations` through `update-draft`, which is the smallest possible
change of material and the smallest possible demonstration that the digest is not a row identifier in
disguise. Both digests come back from Postgres — the tool computes nothing about a review, and a second
implementation of "what a review covers" would have made the review meaningless.

Two refusals in this group are the interesting ones, and they point in opposite directions:

- **A stale packet is refused, and nothing is written** — exit 2, and the message names *both* digests:
  `refused: this review names packet <expected>, but the material as it now stands digests to <current>.
  Nothing was written: that packet is stale, so produce it again with review-packet and submit against the
  digest it prints.` The row is re-read afterwards and asserted unchanged.
- **Approve against a draft is refused by the guard, not by this tool** — exit **1**, with the database's
  lifecycle sentence ("only a reviewed release can be approved"), and the test asserts
  `doesNotMatch(/stale/i)`: the new pre-flight must not steal a refusal whose true reason belongs to the
  row's lifecycle. Intercepting it would have produced a confident digest message about a problem that was
  never about the digest.

### 23.5 the two repairs §25 earned, and the one false claim it cost

§25 was not only a test-writing task: two of its asks were red because the tool did not do them. The
convergence is recorded as measured, because the shape of the trail is the evidence that the assertions were
driving the code and not the other way round:

| run | result | what the failures were |
| --- | --- | --- |
| measure 1 | 26 pass / 9 fail | 7 were bugs in the new tests (`--via-docker-x` mispositioned, a `deepEqual` against an un-`trim`ed verb list, an unbalanced paren in a diagnostic); 2 were real tool gaps; 2 were cascades from those gaps |
| measure 2 | 34 / 2 | both mine: `^REFUSED:` anchors, when every post-connection refusal is preceded by the `# maintenance identity:` line |
| measure 3 | 35 / 1 | one of mine, and the worst kind: an assertion written from the header's prose rather than from measurement — I had claimed a document-operand refusal arrives before the session guard, and `main()` runs `assertSession()` before `buildCall()`, so it does not |
| measure 4 | **36 / 36, exit 0** | — |

The two real gaps, now fixed in `scripts/tradition-pack-admin.mjs` (553 lines):

1. **An unreadable or unparsable document operand was a crash-shaped `ERROR:` (exit 1), not an operator
   refusal.** `readMaybeStdin()` now raises `Refusal` for a missing file, for a file that cannot be read,
   and for text that is not JSON — "refused: `X` is not valid JSON, so there is no document to send." —
   which is the difference between telling a reviewer their operand was wrong and telling them the database
   route failed.
2. **A review submitted against a stale digest reached the database and failed there (exit 1).** §25 asks
   for exit 2 *and* an unchanged database, so `assertDigestStillBinds()` (line 269, hooked at line 421
   between `buildCall()` and execution for `submit-review` and `approve`) now reads
   `internal_api.inspect_tradition_pack_release()` and compares three values it did not compute: the digest
   the operator named, the digest the row records, and `review_payload_recomputed` — the material as it
   stands, digested inside Postgres. `submit-review` refuses when the named digest is not the recomputed
   one; `approve` refuses both when the named digest is not the row's binding and when the row's binding is
   no longer the material's digest, i.e. the review it would sign off has gone stale underneath it.

The pre-flight is a courtesy, not the enforcement. The same comparison still runs inside the write — that is
what `50_review_binding.sql` proves — and the suite keeps asserting the database's own refusal for a path
that skips the tool. What changed is that an operator holding a stale packet now learns it before issuing a
write, and learns it as a refusal they can act on.

The third lesson is the one §33 should keep: measure 3's failure was not a tool defect and not a typo. It
was an assertion I wrote from a comment in my own file. A green suite that contains a claim derived from
prose is exactly the artefact this audit is meant to prevent, which is why the replacement asserts
`CONNECTED(run.err)` — the measured fact — and rests the "nothing executed" claim only on the unchanged
world and row-state readings.

### 23.6 the secret audit

CLI-SECRET makes one claim over the whole `LEDGER`: no canary value, no `user:password@` URL in either
libpq spelling, no JWT-shaped token, no `sb_secret`/`service_role_key`/`eyJhbGciOi` string, no
`role = service_role` session report, nothing shaped like a live guest credential in an `/i/` or `/p/`
segment, no `.pgpass` pointer, and none of the real `.env.local` secrets — checked by exact string, on top
of the shape rules. It carries positive controls in the same test (a planted `postgresql://…:canary-pw-…@`
string and the suite's own JWT must both match the detectors), because "no canary found" is otherwise
indistinguishable from a detector that was never wired up. Two narrower claims: the identity line the tool
prints is a role and a database name and nothing else (no `@tcp`, no port), and a whole successful
`--via-docker` run mentions neither `127.0.0.1` nor `54401` nor a password, because that route keeps its
`psql` inside the container and needs no credential in this process at all.

### 23.7 residue, and the battery the new file was added to

The suite mints one pack and one release to walk a real review through, and ends the walk with `deprecate
--yes`. Measured after the full battery: `tradition_packs` 15 → **17**, `tradition_pack_releases` 23 →
**27**, approved-and-therefore-selectable 8 → **9**. This run's pack is
`stage5_cli_stage5cli_muoeuhsf_8foit6`, whose single release is `deprecated` with `reviewed_by` NULL,
`machine_assisted = true`, a `TEST ONLY` scope statement, a review basis and scope that both begin "TEST
ONLY", an author label containing "no human cultural review has been recorded", 0 weddings selecting it and
0 versions frozen from it. The ninth approved release is **not** the CLI's: it is
`stage5_retire_stage5http_muof0e6h_fc2gil` release 2, minted by the §23 HTTP battery's retirement journey
later in the same run (its tag sorts after this run's CLI tag, which is the arithmetic that attributes it),
and the two older approved `stage5_retire_stage5http_*` releases predate this section. All approved rows
carry the TEST ONLY scope, and CLI-RESIDUE pins that no pack without a `TEST ONLY` scope statement exists
and that no such pack is `approved` — which is also where the Tamil candidate is measured: as the catalogue
sees it, `(no pack key matching %tamil%)`. It is a content file in this build, not a release, so "nothing
non-fixture is customer-selectable" is the honest form of that claim and §23's suite is what pins the
candidate file's own state.

The per-run assertions are keyed on **this run's exact pack key**, never on `stage5_cli_%`, so no test
requires residue from an earlier run; the number of runs still visible in the catalogue is printed as a
diagnostic and never asserted. That the residue is permanent is ruling A2, not an oversight — the only
forward move available is the deprecation the suite already performs.

One residue hazard was caught by measurement rather than by this prose. Measure 1 failed mid-walk and left a
TEST ONLY release **approved**, i.e. selectable. It was located by its exact pack key
(`ea4cf04e-c46f-4989-9209-c24d564805f6`) and retired with the tool's own `deprecate --yes`; all five
`stage5_cli_*` releases now read `deprecated`. A suite that can leave a selectable pack behind on failure is
a suite that needs a residue assertion, which is what CLI-RESIDUE's status check is.

The new file was then run as part of the battery rather than only alone, because "green in isolation" is not
the property a shared local database needs:

```
bash supabase/tests/api/run.sh  →  exit 0, RESULT: PASS
  stage3_publication          38 tests / 38 pass / 0 fail   22.85 s
  stage3_security             56 / 56 / 0                    3.97 s
  stage4_tradition_packs      28 / 28 / 0                   42.68 s
  stage5_admin_cli            36 / 36 / 0                  274.57 s   (new)
  stage5_pack_driven_http     28 / 28 / 0                  41.04 s
  total                      186 tests, 0 failures
preconditions: 19 migrations applied == 19 in supabase/migrations; public schema 19 tables, 45 policies;
               the private/legacy objects the suite expects to be unreachable do exist; the Stage 3
               draft-invariant trigger is deployed
post-run:      weddings back to 0 rows, auth.users back to 0 rows, invitation_drafts back to 0 rows,
               0 orphaned drafts
```

The CLI suite costs 274.57 s inside the battery against 245.9 s standalone. The difference is wall-clock
contention from ~40 sequential `node`+`docker exec` children, not a behaviour change; both numbers are
recorded because the audit should not quietly quote the faster one. `npm run product:check` measured
**178** active files, 0 violations, exit 0 — up from the 177 §22 recorded, and the +1 is this suite's own
file, which the checker scans (`docs/audits/` and `scripts/` are the excluded prefixes; `supabase/tests/`
is not). That the canary JWT, the `sb_secret-…` string and the `service_role` wording inside it do not trip
any rule is a fact about rule *scopes*, not additional evidence for §23.6.

### 23.8 what this section does not claim

- **The `--via-docker` shape gate is not an existence gate, and it is still name-only.** A container whose
  name satisfies the rule is driven whatever it contains: `docker ps -a` at this head shows exactly one
  `supabase_db_*` container on this host (`supabase_db_localvivaahvarnam`), so no second candidate was
  available to measure, and no claim is made here about any other project's stack. What stops the
  well-formed-but-wrong name today is this file's own prelude (`project_id === 'localvivaahvarnam'`, the
  container name spelled as a constant, loopback URL) and the operator's choice of name. The tool does not
  verify that the container belongs to this repository. Carried to §33.
- **The URL route was never exercised for a successful call.** Every `--db-url-env` assertion in this file
  is a refusal. A successful run through that route needs `psql` on the host, and host `psql` availability
  is not part of this qualification, so §25's secret claim is proven for the docker route as a *successful*
  run and for the URL route as *refusals only*. Stated rather than averaged.
- **The pre-flight does not replace the database.** It narrows when an operator learns about a stale packet.
- **No determinism claim about the digest beyond same-bytes/same-digest and one-character/different-digest
  within this build**, which is exactly §25's ask, and no claim that a review recorded by this tool was read
  by anyone with cultural authority — every reviewer string in the file is TEST ONLY and says so.
- **Nothing about the browser.** §25 is a subprocess suite; §§27–29 own the journeys and §31 owns
  accessibility, with no conformance claim in either.
- **No change to the Tamil candidate.** It remains `draft` / `machine_assisted = true` /
  `human_reviewed = false` / `customer_selectable = false`.
- **Nothing left this machine.** No remote project, no hosted Supabase, no deployment, no merge, no push,
  no Stage 6, no change to DueWeave.

## 24. §26 closure: the deferred router decision closes on measurement, and the production dependency graph is now clean (appended, not a rewrite)

Measured 2026-10-01 on this branch. §26 opens with "Do not carry this indefinitely", instructs "Use
CURRENT upstream evidence before editing", lists four facts to verify, asks whether 7.18+ can be adopted
"without architecture rewrite", and pre-authorises both outcomes without softening either: upgrade if the
gates show it is straightforward, or document the blocker — including "whether the vulnerable mechanism is
reachable here" — if a real one exists. It closes with the sentence that decides the argument in advance:
"'leave 6.x because npm calls it moderate' is not an adequate decision by itself."

### 24.1 the four facts, each read from upstream rather than recalled

| fact | how it was measured | what it said |
| --- | --- | --- |
| the project uses React Router 6.x | `node_modules/*/package.json`, `package.json:64`, `package-lock.json` | declared `^6.30.1`, **installed `react-router@6.30.6` + `react-router-dom@6.30.6`** |
| the policy no longer supports 6.x | `SECURITY.md` read out of the upstream repo at this head via `gh api` | `\| 8.x \| ✓ \|`, `\| 7.x \| ✓ \|`, `\| 6.x and below \| ✗ \|` |
| GHSA-wrjc-x8rr-h8h6 affects `>=6.0.0,<7.18.0` | `gh api advisories/GHSA-wrjc-x8rr-h8h6` | "React Router: Open redirect via backslash in `<Link>` and `useNavigate` (CVE-2025-68470 bypass)"; range `>= 6.0.0, < 7.18.0`; medium; published 2026-07-23; not withdrawn |
| the patched line is `>=7.18.0` | same record, `first_patched_version` | `7.18.0` |

Two things the four lines do not mention were measured anyway, because Stages 0–4 had recorded them as part
of the same deferral. The second advisory in that chain — `GHSA-337j-9hxr-rhxg`, "Arbitrary Constructor
Injection via `deserializeErrors()` in React Router SSR Hydration", `>= 6.4.0, < 7.18.0`, patched
**7.18.0** — is closed by the same version bump, which is why this section can say the pair is gone rather
than one of two is gone. And the version survey matters for the choice: `npm view` reports
`react-router` `latest` 8.4.0 / `version-7` 7.18.4 / `version-6` 6.30.6, while `react-router-dom`
`latest` is **7.18.4** and `react-router-dom@8` returns "No match found for version 8". So 7.18.4/7.18.4 is
the only mutually-compatible ≥7.18.0 pair that exists under both package names, and `react-router-dom`
declares `react-router: 7.18.4` exactly — no resolution ambiguity. Taking 8.x instead would mean moving all
23 import sites to `react-router`, which is a larger change than "make the smallest compatibility changes"
licenses during a stage closure.

### 24.2 what this application actually asks of the router

23 files, 23 import sites, all from `react-router-dom`: `BrowserRouter`, `Routes`, `Route`, `Navigate`,
`Link`, `NavLink` + the `NavLinkProps` type, `MemoryRouter`, `useNavigate`, `useParams`, `useLocation`. The
data-router surface that normally makes a v6 → v7 jump architectural was searched for and is absent — no
`createBrowserRouter`, no `RouterProvider`, no `useRoutes`, no `HashRouter`, no `future={…}` flags, no
`useRevalidator`, no `useFetcher`, no `useRouteError`/`ErrorBoundary`, no `unstable_*`. Constraints on the
other side were read rather than assumed: `react-router-dom@7.18.4` peers `react >=18` (installed 18.3.1),
engines `node >=20.0.0` (v24.18.0), and it ships both `main` and `module`/`exports` entries, so the
`moduleResolution: "bundler"` already in `tsconfig.app.json` resolves it without a config change.

**Is the vulnerable mechanism reachable here?** Every destination the app can navigate to was enumerated:
33 `to=` occurrences outside tests, 3 `navigate()` calls, zero absolute or url-shaped destinations. Each one
is either a literal (`"/login"`, `"/dashboard"`, `"/cookie-policy"`, `"/"`) or a template whose *leading*
segment is a constant — `` `/project/${id}/edit` ``, `` `/project/${weddingId}/configure` `` — where the
interpolated `id` can only appear after `/project/`. There is no `location.state`, no `?next=`, no
`?redirect=`, and no post-login return path anywhere in `src/`, so nothing takes an untrusted value into the
authority position of a URL, which is the only place the backslash bypass does its work. That is §26's
requested answer, and it is *not* the reason for the decision: an unsupported line is unsupported, and the
mechanism being unreachable today is a property of 33 call sites that any later commit can change.

### 24.3 the change, and its entire footprint

`package.json` one line (`^6.30.1` → `^7.18.4`), installed with `npm install` and nothing else — no
`--force`, no `--legacy-peer-deps`, no hand-editing of the lockfile. `npm install` printed the tempting
"run `npm audit fix --force`" line, which would have jumped **vitest** to 5; it was not run. The lockfile
delta is 41 insertions / 25 deletions and names exactly five packages:

```
- @remix-run/router@1.23.4        (v6's routing engine, no longer used)
+ cookie@1.1.1                    (react-router 7's dependency; the only advisory on `cookie`
                                   is GHSA-pxg6-pf52-xh8x, `<0.7.0`, so ^1.0.1 is above the fix)
+ set-cookie-parser@2.7.2         (no advisory at any version)
  react-router     6.30.6 → 7.18.4
  react-router-dom 6.30.6 → 7.18.4
```

**Source files changed: zero.** That is the measured answer to "can 7.18+ be adopted without architecture
rewrite" — yes, and not by argument but because `git diff --stat` shows only the two dependency files. The
`src/components/NavLink.tsx` legacy wrapper (which imports `NavLinkProps` and passes `activeClassName` /
`pendingClassName`, and which has no importers) typechecked unchanged; it is unused, so it stays out of
§26's scope.

The tree was validated after three installs (7.18.4 → control 6.30.6 → 7.18.4): `node_modules` holds both
packages at 7.18.4, `package-lock.json` and `package.json` agree with it, `npm ls react-router
react-router-dom` resolves the pair with no duplicates or invalid marks, and the only installer marker
present is `node_modules/.package-lock.json` — no `.pnpm`, no yarn metadata. The untracked `pnpm-lock.yaml`
and `pnpm-workspace.yaml` were not touched, not staged and not used to install.

### 24.4 the gates — including the one that did not go green, and what it was actually measuring

| gate | command | before (6.30.6) | after (7.18.4) |
| --- | --- | --- | --- |
| types | `npm run typecheck` | exit 0 | **exit 0**, no source edit |
| targeted router/auth tests | `npx vitest run` over `appRoutingAuthIsolation`, `brandLockup`, `editInvitationPage`, `publicInvitationPage`, `weddingQueries` | 62 / 62 | **62 / 62**, twice |
| production build | `npm run build` | 2196 modules, exit 0 | **2204 modules, exit 0**, 30 chunks (identical set), per-route lazy chunks intact |
| entry chunk | `dist/assets/index-*.js` | 491.21 kB / 148.30 kB gzip | **509.14 kB / 154.54 kB gzip** — +17.93 raw, +6.24 gzip |
| untouched chunks | `EditProject`, `Header`, `index.css` | 101.26/30.09, 127.59/42.14, 69.08/12.20 | byte-identical values, so the whole cost is in the entry |
| node suite | `npm test` | 428 / 428 (§22's record) | **424 / 428**, 4 timeouts — see below |
| production audit | `npm audit --omit=dev` | 2 moderate (the router pair) | **found 0 vulnerabilities** |
| CI gate | `npm audit --omit=dev --audit-level=high` | exit 0 | **exit 0** |

The node suite is the honest part. Four tests failed, every one with `Error: Test timed out in 5000ms`, and
the failing set **rotated between runs** — run A named `scripts/product-contract.test.mjs`; run B named
`contentEditor`, `culturalSafetyDecisionLogic`, `editInvitationPage`; run C named
`appRoutingAuthIsolation` (twice), `contentEditor`, `culturalSafetyDecisionLogic`. All three of run C's
files then passed standalone on 7.18.4 (`5 / 5`, `19 / 19`, `9 / 9`). A regression does not move between
files; paging does. The host had **1.0–1.4 GB free of 17 GB**, `vmmemWSL` holding ~37 GB reserved for the
Docker/WSL VM, several other sessions' browsers resident and 24 `node.exe` processes on the machine, and
`vitest`'s default per-test budget is 5 s of *wall clock*.

To keep that from being an excuse, the variable was isolated: the same 62-test subset was run on **6.30.6**
under the same conditions and took **99.23 s** against **83.75 s** on 7.18.4 — the old router is the slower
one right now, so no part of the slowdown is attributable to the upgrade, and the earlier 21.68 s figure for
that subset is the number from when the machine had headroom. Two consequences are recorded rather than
smoothed: **§34's final gate run has to happen with host headroom or it will fail on timing rather than
behaviour**, and a reviewer on a loaded machine will see the same rotating timeouts. No timeout was raised
and no assertion was weakened to get this section closed; `424 / 428` is what this run measured.

Build *timing* was deliberately not used as evidence: three builds of nominally identical work printed
59.23 s, 59.23 s and 55.65 s, and two identical figures to the hundredth from different trees is a reason to
distrust the metric, not to quote it. Chunk sizes and module counts are deterministic and are what the table
above reports.

### 24.5 the trail this closes

The same finding was recorded and deferred at five consecutive stages, and each record explicitly refused to
make the line quiet by widening the range: `stage-0-truth-security.md:219–220` ("**Recorded, not
upgraded.** … Tracked as a Stage 1+ upgrade"), `stage-1-product-reset.md:524–528, 635, 791`,
`stage-2-domain-database.md:571`, `stage-3-public-invitation.md:788, 1299, 1384, 1616` ("the range was
**not** widened or bumped to make this line quiet"), `stage-4-tradition-pack-foundation.md:89, 1053,
1073–1074`. §26 is where that chain ends: the gates show the upgrade is straightforward, so it was done
rather than documented as a blocker. Those five files are historical records and are not edited here; the
forward-looking consequence is §36's documentation pass, which measured that **no current-state doc** (README,
`docs/product/**`, `docs/**` outside `docs/audits/`) names the router or its version, so there is no stale
version claim to correct — the only new statement of record is this section.

### 24.6 what this section does not claim

- **No browser evidence yet.** §26 qualifies v7 routing at typecheck, node-test and build level. The routes
  are exercised in a real browser by §§27–29, which now run against a 7.18.4 production build; if any of
  those journeys shows a routing difference, that is where it will surface, and this section does not
  pre-empt it.
- **The reachability analysis is about today's 33 call sites.** It is not pinned by a test, and a later
  route that puts an untrusted value at the *start* of a `to` would change the answer. The upgrade makes the
  question moot for this advisory; nothing makes it moot for the next one.
- **`react-router-dom` at v7 is the compatibility re-export package** upstream expects applications to leave
  behind in favour of `react-router`. Nothing in this change moves the 23 imports, and at 7.18.4 npm marks
  the package **not deprecated**, so this is a named maintenance follow-up (move imports, then drop the
  shim), not a defect and not something to perform inside a stage closure.
- **The dev-only advisory stays open and is now the only one.** `@vitest/mocker 2.1.0 – 4.1.10`
  (GHSA-82fw-gwwq-j7x9, path traversal / arbitrary file read via a mocker redirect) reaches the installed
  `vitest`, and npm's only offered fix is `vitest@5`, a breaking major on the test stack with its own
  consequences for every suite in this repository. It is not a production-surface finding — the CI gate uses
  `--omit=dev` — and §26 does not license resolving it here. Recorded for §33 and for a maintenance pass.
- **The node suite is not green at this head**, for the timing reason above, and this section reports
  `424 / 428` rather than the standalone-passing numbers.
- **Nothing left this machine.** No merge, no push, no deployment, no hosted Supabase, no Tamil-candidate
  approval, no Stage 6, no change to DueWeave. The lockfile change is local and uncommitted, and enters
  history only when §37 stages it by name.


## 25. §27 closure: journey A walked the no-pack path through the shipped UI, and two instrument repairs were the price (appended, not a rewrite)

### 25.1 what was run, and against what

`node scripts/stage5-ui-journeys.mjs` at the §26 head, against the **production bundle** (`npm run preview`
on `http://127.0.0.1:4173`, entry chunk `dist/assets/index-DeHza3gb.js`, 509 185 B) and this repository's
own stack on Kong `:54400`. Run tag `stage5ui-muqqtfgb-fvpvi`, log `s5-journeys-run11.log` read in full
rather than through a pipe. That run printed **checks 86, measurements 11, findings 0** and the line
`STAGE 5 BROWSER JOURNEYS: PASS`, with `exit=0` recorded by the runner itself — the exit code was read from
the log, because two background-completion notifications in this session reported `exit code 0` for
processes that had exited 1 (recorded at §33).

Journey A is the *no pack at all* case, which §27's directive asks for as the primary product claim: a
host with no tradition pack, no reviewer, no catalogue row and nothing machine-assisted must be able to
reach a live guest link. Every step below was performed by clicking, typing and pressing in the page, not
by writing to the database.

### 25.2 the path, as measured

| step | what the page did | evidence the run carried |
| --- | --- | --- |
| sign-up → session | `s5a-host` pressed sign-up, routed to `/login`, reached `/dashboard` | "reached the dashboard with no email-confirmation step" |
| create | wedding `670048cf…` through the UI | measurement, not an assertion |
| tradition panel | loaded, radio value `none`, says packs are optional | three checks, one of them a measurement (below) |
| four prose slots | all four editable | `opening, familyIntroduction, eventNotes, closing` |
| structured rows | person, venue, ceremony added through the UI | page state **and** `1 people, 1 venues, 1 events` from `psql` |
| server verdict | no blocking issue on the completed draft | `[]`, and the issue panel absent from the DOM |
| freeze V1 | button enabled, pressed, HTTP 200 | `asked create_invitation_version: HTTP 200 · the page says: … Version 1 is frozen. It cannot be edited.` |
| publish | pressed, HTTP 200, address shown once | token read from the page, masked in the log |
| provenance | V1 pins no release; no section claims pack wording | `NONE`; `host, host, (none), (none), host, host` |
| guest | rendered in a context with no session | host's own words, venue, ceremony, people all present |
| guest privacy | no `localStorage`, no `sessionStorage`, no cookies | `{"local":[],"session":[],"cookies":[]}` |
| immutability | editing the draft after publish left the guest page byte-identical | `43c5fd95974b → 43c5fd95974b`, **with the positive control in the same run**: "the host preview did move, so the comparison is not two stale reads" |

### 25.3 the repairs this journey forced, and why the pass was not worth anything before them

Three of the four items below are instrument defects that journey A exposed while being re-read, not
product defects. They are recorded because a green line from a broken instrument is the failure mode this
stage is supposed to catch.

1. **`guestPayload()` passed by having nothing to walk** (`stage5-ui-journeys.mjs:675–687`). The leak
   check consumed `seen.length ? JSON.parse(body) : null`, so in a run where the guest document never
   arrived it walked `null` and reported *no leaked fields*. Now it throws when there is no response with
   a status, or when the response carries no retrievable body. Found 2026-10-01 while re-reading journey A.
2. **A press that reported `pressed` had not necessarily done anything** (`:578–585`). `handleCreateVersion`
   can return before any request (its unsaved-changes guard, `EditProject.tsx:531`) and `runPublication`
   can answer with a notice instead of a row (`:507`). Run 8 measured exactly this: journey A's freeze said
   `pressed`, no version row appeared, and the check's only evidence was the first 200 characters of the
   page — the top of the editor, which cannot distinguish "handler never ran" from "server refused" from
   "the app explained further down". `pressEvidence()` now prints the RPC the app asked for, the HTTP
   statuses it got, and the page's own `[role=status]`/`[role=alert]` lines beside the press result. Every
   freeze/publish line in §§25–27 above is in that form.
3. **A preview that predated the action** (`:610–619`). Row edits and draft saves each trigger their own
   preview read, and a request started *before* a write can answer *after* it; measured on 2026-10-01 as
   §28's ceremony insert being followed by a preview that still reported `required_list_empty` for a
   section that already had an event. The harness now waits for a new response *and* for the endpoint to go
   quiet, then takes the newest answer.
4. **The product sentence journey A contradicted.** The prelude's own measurement — "reached the dashboard
   with no email-confirmation step" — is the observable fact, and `src/pages/Signup.tsx` told the host to
   "check your email to confirm your account" on the path where the stack is configured never to send one
   (`supabase/config.toml:72 enable_confirmations = false`). That is a real product defect, repaired in this
   head's build by branching on the session the server actually returned; it is recorded as a §36 truth-sync
   item, and no browser assertion of the new sentence exists yet.

### 25.4 what this section does not claim

- **The four prose slots being editable is not the same claim as "every host field is editable"** — the
  measurement is about the slots a pack-less document exposes.
- **The byte-identical re-visit proves the published snapshot is what the guest reads.** It does not prove
  anything about caching layers that do not exist in this stack, and it is not a claim about a CDN.
- **Journey A carries no pack provenance because there is no pack.** That is the point of the journey, but
  it means the "no section claims reviewed-pack credit" line is the weak form of the claim; the strong form
  — a document that *does* carry pack wording still attributing correctly — is journey B (§26 of this
  document), not this one.
- **No accessibility claim.** Focus order, contrast and target size are §31's measurement, and the sweep's
  own §27 table reports contrast as a measurement rather than an assertion.


## 26. §28 closure: journey B put a synthetic approved release through the editor, and the server — not the button — did the blocking (appended, not a rewrite)

### 26.1 the fixture, stated as what it is

The pack was minted, reviewed and approved through `scripts/tradition-pack-admin.mjs` (the §F maintenance
CLI), which is why §28 is a *UI* journey with a *CLI*-made fixture: no browser role can move a release
through the lifecycle, and the point is not to fake that it can. Every string in it is
`TEST ONLY — …`, `machine_assisted = true`, and its review basis disclaims a human reader with cultural
authority. The release is `a9234229…` (release 1 of `TEST ONLY — Stage 5 UI Journey Pack`).

### 26.2 the blocking, measured from both sides

| state of the draft | server's blocking set | button | what the page showed |
| --- | --- | --- | --- |
| pack chosen, nothing else filled | `required_list_empty × 2, required_text_missing` | disabled | the same list, verbatim, under "What the server says" |
| ceremony with no venue | `event_venue_missing, required_text_missing` | — | per-issue line |
| `host_must_supply` line written | `event_venue_missing` | — | that issue only |
| complete | `[]` | enabled | freeze succeeded |

Two things in that table are the substance of §28's requirement, and both were measured independently of
the other: **the UI refuses and the server refuses the same draft**, and the refusal is reached by asking
the RPC directly (`rpcAsHost`) so a disabled button cannot be the only defence — `HTTP 400`, no version
row created.

### 26.3 provenance, and the host's attempt to overwrite reviewed wording

The frozen per-section record journey B wrote:

```
opening:host:true:?:? | family:?:?:?:? | ceremonies:?:?:?:? | invitation:reviewed_pack:false:true:en | closing:host:false:?:?
```

which is four separate claims: the host's override stays credited to the host, the two list sections carry
no body source, the `pack_only` line keeps `reviewed_pack` credit, and the line drawn from the fallback
records `en` as the language actually drawn — on a Tamil document. The last one is the bilingual behaviour
§12 asked for, measured in the guest payload rather than asserted in a unit test.

The host's attempt to replace the reviewed `family_introduction`/`invitation` wording **was accepted as a
row write** (`HTTP 200` — the row is theirs) and **did not change what the guest reads**: the reviewed
wording survived, and the server recorded `host_override_not_permitted` with `blocking: false`. The editor
then said so in the toast the run captured ("அழைப்பு keeps the wording your chosen pack supplies, whatever
you wrote here earlier. Nothing you wrote has been deleted — your own line is kept."). Advisory rather than
blocking is the designed answer, and the run measures both halves of it.

Section order came from the release and was rendered from the server's declaration, not hard-coded:
`opening → family → ceremonies → invitation → closing` at both layers.

### 26.4 the honest parts of this section

- **The refusal body carries a Postgres SQLSTATE.** The browser-visible answer to the freeze was
  `{"code":"23514", … "message":"this invitation cannot be frozen yet: section ceremonies is required and
  has no events to show yet; …"}`. §28's check is that no **table, function or constraint name** leaks, and
  that holds — the sentence is the product's own authoring language. The `23514` is still a database error
  class surfacing at the HTTP edge, and it is recorded as a documented limitation rather than rewritten as
  a pass. Stage 3 §15's equivalent line and §21's DTO notes are where the same shape was previously
  accepted.
- **`asked create_invitation_version: HTTP 400, HTTP 200` on the successful freeze** is not a retry the app
  performed. `responsesFor()` counts every response the page saw on that RPC URL, and the 400 is journey
  B's own deliberate direct-RPC probe from §26.2 above. The pass therefore rests on the **last** status plus
  the page's "Version 1 is frozen" line plus the row count, and it is written here so that a reader of the
  log does not mistake the pair for a double submit.
- **The guest/preview parity check is the one that matters most and it passed on content, not pixels**: the
  heading sequence and every body matched between the host preview and the guest page (`order true, bodies
  true`), including the `null` bodies of the two list sections.


## 27. §29 closure: journey C retired the release a live link was standing on, and the guest document moved exactly once (appended, not a rewrite)

### 27.1 the sequence, in the order the run performed it

Journey C starts from journey B's wedding and its published V1 (`b7927cfc23f2…`, 350 characters):

1. V1 exists, the wedding points at R1 (`a9234229…`) — asserted **before** any R2 exists, so step 3 is not
   the same fact twice.
2. R2 (`c1fd3949…`) is created, reviewed and approved through the CLI.
3. Approving R2 does not move the wedding. A fresh visit still shows V1 on R1.
4. R1 is deprecated through the CLI. A fresh visit to the existing link is **byte-identical**
   (`b7927cfc23f2 → b7927cfc23f2`).
5. The editor tells the host "This invitation uses an older release"; the freeze button is `disabled`; a
   direct `create_invitation_version` as the host is refused `403`; and the refusal created no version
   (`1`).
6. R2 is offered as an explicit choice, and the option's only extra words are the UI's own —
   "release 2— newer release of the one you chose" — not a reviewer, machine or provenance string.
7. The wedding moves to R2 **only after the host selects it**, and V1 plus its link are untouched by the
   reselection.
8. The preview is complete on R2, V2 freezes (`HTTP 403, HTTP 200` — same counting note as §26.4) and pins
   R2 rather than the release it inherited, V2 publishes to the existing address, and only then does the
   guest document change: `b7927cfc → f9ddbfe4`, "drawn from 5 resolve responses (the visit before this one
   was 4)".
9. The changed document still draws no review or provenance string, and the host's own override from
   journey B is still the host's words.

### 27.2 the instrument clause that makes step 4 and step 8 mean anything

`revisitGuest()` (`stage5-ui-journeys.mjs:695–708`) navigates `about:blank → /i/‹token›`, waits for the
`<article>`, and then **requires the resolve endpoint to have answered again** — if the visit count has not
increased by the deadline it throws `revisiting the guest address drew a document but asked the server
nothing`. Before that, a "byte-identical after deprecation" line could be produced by re-reading the DOM the
previous visit left behind, which is a pass with nothing in it. The response-count pair printed in step 8
(`5`, after `4`) is that guard's evidence, and it is the reason the changed-hash line is a measurement of
the server's answer rather than of a reload.

### 27.3 what §29 does not claim

- **One wording changed between R1 and R2, by design.** The releases were minted to differ in exactly one
  line so that "the guest changed" is falsifiable; that is not a claim that a real pack's releases differ
  only in one line, and no real pack is involved.
- **The 403 on the direct freeze is the server refusing, and the disabled button is the UI agreeing.** Only
  the first is a security-relevant refusal; the second is a convenience and the run keeps them apart.
- **No WCAG conformance claim, and no native-speaker approval.** Journey C's page assertions are text
  presence/absence and byte identity.


## 28. §30 closure: the 10 × 4 render sweep, its two hangs, and what the instrumentation did and did not prove (appended, not a rewrite)

### 28.1 the scope this section is written under

§30's directive words are the boundary of the claim: **rendering verification only. No native-speaker
approval. No WCAG conformance claim unless a full WCAG audit was actually run.** No part of this section
says a Tamil reader reviewed anything, and the shapes it draws are synthetic documents with `TEST ONLY`
wording.

### 28.2 the run that closed it

`node scripts/stage4-render-qualification.mjs`, run tag `stage4render-muqr7z2q-nme9uk`, against the same
production bundle and the same loopback stack as §§25–27 — i.e. after the last `npm run build`, with no
product source newer than `dist/` (checked with `find src index.html package.json -newer dist/assets/index-DeHza3gb.js`,
which returned nothing). Log `s5-render-sweep-diag-1.log`, read in full. Result:

```
==> checks: 143, measurements: 33, findings: 0
STAGE 4 RENDER QUALIFICATION: PASS      exit=0
```

All ten shapes were measured at all four viewports (360×740, 390×844, 768×1024, 1440×900): horizontal
overflow `0px` in every one of the 40 cells, zero clipped elements inside the article, no injected internal
key or provenance string, no unsafe link scheme, the frozen `lang` on the article, the clamped lead size
where one was saved (30 → 30, 60 → 44, 8 → 22, 3 → 22) and the readable default (26 px) where none was,
the saved alignment applied, and shape 10's out-of-vocabulary values *not* applied
(`not-a-colour → rgb(44, 36, 33)`, unknown alignment → `center`, unknown font → the declared stack).

### 28.3 the two failed runs, and the state of the diagnosis

The first two attempts on this head (`s5-render-sweep-final.log`, `s5-render-sweep-final-2.log`) both
exited **1** at the identical position — after shape 3's last assertion, before shape 4's first row — with
`Error: Runtime.evaluate timed out` from the driver's own 60 s per-send timeout (`:729`). Nothing else in
the log changed between the two, and both background-completion notifications reported "exit code 0",
which was false both times.

Rather than retry until a run happened to pass, the instrument was given diagnostics: a `mark()` label for
the in-flight shape/viewport, `Inspector.targetCrashed` and `Page.javascriptDialogOpening` capture with an
auto-dismiss, and the state of the WebSocket in the timeout message. That version passed, and its log
carries shape 3's font measurement (`72 declared · status {"unloaded":64,"loaded":8} · Tamil subset files
loaded=3`) and the follow-up "every Tamil code point the page drew has a loaded Tamil face — 97 Tamil chars
· 24 distinct · without a face=none".

**What that evidence supports, stated precisely:** the hang sat at or immediately after shape 3's
`document.fonts` probe, which is the only `await`-based evaluation in an otherwise synchronous matrix, so
the leading explanation is the async font probe waiting on `document.fonts.ready` while the shared host
starves the font loads. **What it does not support:** a proven root cause. The defect was not reproduced
against the instrumented build, so no fix was made to the measurement logic; the repair was to observability
only (`scripts/stage4-render-qualification.mjs`, a tracked file, disclosed at §33). A recurrence would now
name the shape and viewport in flight rather than the timeout line, and this section records the two failed
runs as the §30 evidence trail rather than dropping them.

### 28.4 two sweep measurements that look like findings and are not, and one that is a real limitation

- Shapes 4 and 6 report `["outside transition:background-color on MAIN", …]` under "the document itself runs
  no animation" and pass. Those are CSS `transition` declarations on the page shell outside the `<article>`,
  not the invitation document animating; the check's scope is the document, and it says so in its own label.
- The sweep found **one** interactive element in the whole 40-cell matrix (`2-no-pack-full` @ 360×740, where
  the venue map link exists) and its focus indicator measured `outline 3px solid rgb(92, 26, 27)`. 36 of the
  40 cells contain no interactive element at all, which is listed by name in the log. That is a genuine
  limitation of what a render sweep can say about keyboard behaviour — the guest document is largely
  non-interactive by design — and it is §31's subject, not something this sweep should claim coverage of.
- Contrast is **reported, not asserted** (`h1 12.17 · body 12.17`, `13.9`, `16.32`), exactly as §30's scope
  line requires: no WCAG conformance claim is made from four numbers.

### 28.5 the cleanup the sweep performed, and the residue it is allowed to leave

Rows owned by the run were removed (`table totals after cleanup: weddings=0 invitation_versions=0
publications=0 invitation_drafts=0`). The minted releases were **retired, not deleted** —
`12=deprecated UPDATE 1` — because the retention rule that forbids deleting a release that has left draft
is the same rule the sweep exists to protect, and a test that deleted its way out would be weakening the
schema to keep a log line tidy. The catalogue therefore still carries the fixture releases
(`stage4_http_fixture` 1–12, of which 3–12 are deprecated, plus the language-gaps and reviewed-only/retired-only
fixtures). They are `TEST ONLY` by scope statement and disclaim a human reader, which §30's truth boundary
and the SQL batteries' `T2`/`T3` groups assert on every run.

## 29. The review-digest forgery window, the repair, and the four runs it took to close it (appended, not a rewrite)

### 29.1 what the window was

Found while re-reading the release guard to write §30's truth boundary, and carried forward as **FINDING 1**
for §33 to classify. `20260929120000_stage5_pack_driven_authoring_review.sql` states in comment (c) that a
caller cannot forge a review digest "from any direction, because the only code that produces one is a function
of the material in front of it". The guard's pin did not cover that sentence:

```sql
IF NEW.status = 'draft' THEN            -- the version that shipped in the draft stage
  NEW.review_packet_hash := OLD.review_packet_hash;
END IF;
```

Two later edges were left open by that test rather than by the lifecycle:

- `reviewed → approved`: the approval arm validates the **stored** `OLD.review_packet_hash` against a
  recomputation and never reads what the caller put in `NEW`, and the content-immutability tuple deliberately
  excludes the hash column (the review edge has to be able to write it). So
  `UPDATE … SET status = 'approved', review_packet_hash = <chosen 64 hex>` cleared both, and the value the
  caller chose became the binding a guest document's provenance is later bound to.
- `approved → deprecated`: same shape, same reason.

**Scope, measured rather than asserted:** both edges are reachable only from the trusted maintenance identity.
`anon` and `authenticated` hold column-level SELECT and are refused by `private.reject_client_write` before any
write lands — which is what `WRT-02` and `CAT-08` in the HTTP tier already prove. So this is **not a
browser-reachable forgery**, and no §30/§31/§32 number suggests it was. It is a defect against the invariant
this migration states about itself, on the one surface (a maintainer under pressure, or a compromised
maintenance credential) that the binding exists to constrain.

### 29.2 the repair, and the first version of it that was worse

The pin now covers exactly the edges that move a row's state, plus drafts, and deliberately stays out of the
way of arm (d):

```sql
IF NOT (OLD.status = 'draft' AND NEW.status = 'reviewed')
   AND (NEW.status IS DISTINCT FROM OLD.status OR OLD.status = 'draft') THEN
  NEW.review_packet_hash := OLD.review_packet_hash;
END IF;
```

The first repair attempt dropped the second clause and pinned "anything that is not the review edge". That
**weakened** a guarantee: a same-status rewrite of a published release's digest was restored to `OLD` before
arm (d) could refuse it, so a caller got silence where the schema had been saying *its review record is part of
the frozen unit*. The two-chain battery caught it — `FAIL B8b` in `s5-sql-battery-repair-1.log` — which is the
reason the repair was not declared done on the strength of the forgery cases passing. No existing assertion was
relaxed to get there; the pin was narrowed until the old refusal still fired.

### 29.3 the ten controls added, and the fixture the first version of them destroyed

Group B gained `B16b`, `B17a`, `B17`, `B17b`, `B17c`, `B18`, `B18b`, `B18c`, `B19`, `B19b` (111 → 121
assertions in `50_review_binding.sql`). They mint their own row — release **7** of the group's pack — rather
than reusing release 5. That was not the first attempt: the version that worked release 5 retired it, and
`S1`'s expectation that the pack holds a `reviewed` release then failed
(`s5-sql-battery-repair-2.log`: `got [1=deprecated,2=draft,3=draft,4=draft,5=deprecated]`). Reusing a fixture
to prove one rule would have silently removed the state that `S1` and `S27` (the retention report's view of a
*reviewed* release) are measured on. Consuming a fixture to prove a rule, and in doing so deleting the state
another rule tests, is how a battery shrinks; the ledger expectations were instead updated additively
(`B16` 5 → 6 surviving releases, `S1` gains `7=deprecated`, `S27` gains its row, `T1b` 6 → 7 releases).

`B19`/`B19b` are the falsification control for §29.2: a valid-shaped digest rewrite with **no** transition on
the deprecated row must still be refused by name (`23514 … review record is part of the frozen unit`) and must
leave the digest exactly where it was. Without them the narrowed pin would be an untested carve-out.

### 29.4 the evidence chain, in the order it was obtained

| gate | log | result |
| --- | --- | --- |
| two-chain SQL battery, at the Stage 5 head | `s5-sql-battery-repair-3.log` | both chains `exit=0`; per chain 428 (stage 4 documents) + 57 (stage 4 §8 tooling) + **121** review-binding + 50 authoring-vocabulary + 124 document-resolution |
| the repaired function applied to the live local DB | direct `pg_proc.prosrc` scan of `private.guard_tradition_pack_release()` | `repaired-scope INSTALLED` |
| HTTP tier against that live stack | `s5-http-battery-after-guard.log`, read in full | 38 + 56 + 28 + 36 + 28 = **186 tests, 0 failures**, `==> RESULT: PASS`, `exit=0`, and its own post-run check that `weddings`, `auth.users` and `invitation_drafts` are back to 0 rows |

Every verdict above was taken from the log's own marker. The three background-completion notifications in this
stretch each reported "exit code 0"; two of them were attached to runs that had in fact exited 1 (`repair-1`,
`repair-2`), so no notification was used as evidence.

### 29.5 what this section does not claim

- It does not claim a browser, an `authenticated` customer or a REST client could ever have stored a chosen
  digest. The window was on the maintenance surface, and §29.1 says so.
- It does not extend the SQL numbers to PostgREST or Supabase Auth behaviour — the battery prints its own
  boundary line ("plain Postgres + role/auth shim"), and the 186 HTTP tests are a separate measurement of a
  separate surface.
- It does not make the digest mean anything culturally. `review_packet_hash` binds bytes; the review record
  beside it still says `TEST ONLY`, and no assertion here credits a reader with reading them.
- The repair lives in this stage's own **uncommitted** forward migration. No migration that has already been
  published anywhere is being edited; a re-apply to the live DB was done by `CREATE OR REPLACE FUNCTION`, and
  committing the file is §37's job, not this section's.
- The catalogue residue reported at §28.5 and in the HTTP log (`35` Stage 5 fixture rows, six
  `stage5_cli_*` runs, `tradition_packs: 31`, `tradition_pack_releases: 51`) is the design of these batteries
  accumulating in a local database, not a leak. §35 reports it; nothing here asserts it away.

## 30. §31 closure: the notification band painted over the app header on phones — one real defect, four claims the instrument had wrong (appended, not a rewrite)

### 30.1 what §31 was asked to do, and what it was run against

§31's directive line ends with the instruction that decided the shape of this section: **"If a real issue is
found: fix it and add a regression test."** The instrument is
`scripts/stage5-a11y-mobile.mjs`, run with both parts (`--only=band,host`, the default), against the
production bundle served by `npm run preview` on `http://127.0.0.1:4173` and the loopback stack. Part A drives
the notification layer on `/login` at 375×740, 640×800, 700×900 and 768×1024; part B creates a throwaway host
through the real screens at phone width, walks `/project/:id/configure`, then runs the full layout, contrast,
keyboard and overlay matrix on `/project/:id/edit` at 375×740 and 768×1024. Nothing in this pass was measured
against a dev server.

### 30.2 the real defect, as it was measured before anything was changed

The first run of this pass on the pack-driven editor (`s5-a11y-run2.log`, run tag
`s5a11y-muqs5s7v-c1xys`) exited **1** with five findings, checks 51 / measurements 39. The first of them was a
product defect, and it is worth quoting the log's own geometry:

```
FAIL [toast-band] /project/:id/configure @ 375x740 phone: the notification covers no control on the form
     — a.inline-flex.rounded-sm "VivaahVarnamVivaahVarnam" own 127x64 at 16,0 ← toast-card
     | button[button].inline-flex.h-11 "Open menu" own 44x44 at 315,10 ← toast-card
     | input#guests[number].flex.h-10 "Estimated guests" own 293x40 at 41,27 ← toast-card
```

`ToastViewport` carried `fixed top-0` (the shadcn default, `src/components/ui/toast.tsx`), and the band is
`flex-col-reverse … p-4`, so on a phone — where the `sm:` bottom-right anchor does not apply — a live card
landed at **16,16 sized 343×94**. A dedicated probe against the unmodified bundle (`s31-probe-6.log`) recorded
that rect, the lifetime of the notification (**5144 ms**, raised by the app's own save), and what
`document.elementFromPoint` answered at the centres of the controls underneath it: the brand link's centre
(79,32) answered `li.group` — the toast's own list item, which is `pointer-events: auto` while a card lives —
and the "Open menu" centre (337,32) answered `svg` inside that subtree. So this is not an overlap that only a
hit-test complains about: for the whole time the notification was on screen, a press at those coordinates was
taken by the notification, on the page a host is typing into, once per save.

Of the three controls the finding listed, two are the band's doing. The third (`Estimated guests` at y=27) was
already under the page's own sticky header because of the scroll position, and the corrected instrument now
says so on its own line rather than charging it to the notification.

### 30.3 the fix

`src/components/ui/toast.tsx`, the `ToastViewport` class string: `fixed top-0 …` → `fixed top-20 …`, everything
else in the string unchanged, `sm:top-auto sm:bottom-0 sm:right-0` still handing tablets and desktop the
bottom-right anchor. 5 rem was chosen from two measured facts, not taste: the header's box on a phone is
**65 CSS px** tall (`h-16` = 64 px plus its 1 px `border-b`), and `src/index.css` already reserves 5 rem below
the top edge for focused content (`scroll-padding-top: 5rem`). 64 px was the first attempt and it was 1 px
short — see §30.6. `npm run build` was re-run, the shipped CSS was checked to contain the rule
(`grep -o '\.top-20{[^}]*}' dist/assets/*.css` → `.top-20{top:5rem}`), and the new bundle
(`dist/assets/index-B1tAR2gz.js`) is the head every remaining Stage 5 instrument in this stretch was run
against.

### 30.4 the regression test, at both levels the defect lives at

**Unit (`src/test/notificationBandPlacement.test.tsx`, new, 4 tests).** It renders the real `<Toaster />`,
raises a real toast and reads the class tokens off the `<ol>` Radix renders inside the
`role="region" aria-label="Notifications (F8)"` wrapper (the first version queried the region itself and got an
empty `className` — the DOM dump in `s31-domdump.log` is what settled that), then asserts: the band does not
carry `top-0`; it carries a `top-*` token; that token resolves to **≥ 65 px**; the `p-4` inset that puts the
card below the band's own edge is still there; and the `sm:` variants are exactly
`["sm:top-auto","sm:bottom-0","sm:right-0"]` so a future "fix" cannot silently move the desktop anchor. The
`65` is a named constant with its provenance in a comment. jsdom performs no layout, so this test is a class
contract, not a geometry claim — the geometry claim is the browser check below.

Red before the fix, from `s31-unit-band-red.log`:

```
× does not start the band at the top edge of the viewport
  → expected [ 'fixed', 'top-0', 'z-[100]', …(5) ] to not include 'top-0'
× starts the band at or below the bottom edge of the header it used to cover
  → expected 0 to be greater than or equal to 64
Test Files 1 failed (1)   Tests 2 failed | 2 passed (4)
```

Green after, from `s31-unit-band2.log`: `Tests 4 passed (4)`.

**Browser (`bandProbe`, new check `the band starts below the page's own top bar`).** The instrument now scans
the page for its own top chrome (`position: sticky|fixed`, painted, `top ≤ 1`, within the top half of the
viewport, excluding the toast layer itself), takes the lowest bottom edge of that set, and requires
`band.y >= topChrome.bottom`. It runs at every band site — four `/login` widths and the configure form — and in
the authoritative run it prints, at the site where the defect lived:

```
ok [toast-band] /project/:id/configure @ 375x740 phone: the band starts below the page's own top bar
   — band top y=80, top chrome bottom y=65 (span, span, header.sticky.top-0)
```

### 30.5 the 1 px between the first fix and the real one

The intermediate build used `top-16` (64 px). `s5-a11y-run3.log` (checks 59 / measurements 44 / findings 2)
refused it by exactly one pixel — `band top y=64, top chrome bottom y=65` — which is the header's bottom border.
The instrument was right and the fix was 1 px short; both the product class and the unit test's constant moved
from 64 to 65 because of that line. This is why the browser check reads the chrome's *measured* box rather than
a hard-coded 64: the page, not the comment, decides how tall its own bar is.

### 30.6 four findings that were the instrument being wrong, and what each became

Each was root-caused against the live page before anything was relaxed, and in every case the corrected check
is stricter or more specific than the one it replaced — no check was deleted and none was widened to
accommodate a defect.

1. **`every keyboard stop announces itself`** failed on `li.group.pointer-events-auto` with no accessible name.
   That node is the toast card: `role="status"`, `aria-live` handled by a separate announce `<section>`, and its
   *content* ("Saved — Your draft has been updated.") is what an AT reads. A nameless live-region card is not a
   silent control. The check became `every keyboard stop says something, by name or by content`, failing only
   when the stop has neither, and the run now prints the content it would have been read.
2. **`the keyboard never lands on a control the viewport cannot show`** failed on two 98 px textareas whose
   bottoms sat 24 px and 50 px past a 740 px window. That is a phone page longer than the screen: focus
   scrolls, and `focus-scroll` was probed directly (`s31-probe-5.log`). The instrument's old model — "off the
   viewport is unreachable" — was wrong. It now measures `visiblePx` and fails only below the 24 px target
   floor, prints partly-clipped stops as a measurement, and keeps the real question (is a *focused* control
   hidden) where it belongs, in the keyboard pass.
3. **`no control is covered by an overlay while the host works`** failed on a textarea at y=−13 answered by
   `div.sticky.top-0`. A sticky bar exists to be scrolled under; what must clear it is *focus*. The cover
   classifier now returns `'top-chrome'` for that case and the overlay check ignores it while printing the count
   as a measurement (`controls the page's own top bar is scrolled under — 1 … scroll position, not the
   notification`). The claim that actually matters is new and does assert: **`no focused control is painted over
   by the page's own top chrome`**, which `elementFromPoint`-tests each keyboard stop where it is shown, at both
   editor widths.
4. **`every keyboard stop is visibly different from its unfocused state`** failed on "Add a ceremony" at tablet
   width. `FOCUS_BASELINE` read each element's computed style and *then* called `blur()`, so the baseline of an
   element that had been focused by an earlier step was its focused style and `changed` came out false. The
   `blur()` and the scroll reset moved before the reads. The run now also reports the honest residue —
   `stops whose unfocused baseline was lost (a re-render replaced the node) — 1: li.group.pointer-events-auto` —
   instead of counting a replaced node as an invisible focus ring.

### 30.7 the notification that would not go away, and why `sleep(6500)` was invalid

Run3's other finding was on `/login` at 375×740: after the band was told to retire, the after-snapshot still
showed `cards=1` and the brand link still answered to `toast-card`. The cause was the instrument's own
clicking, not a stuck timer. `@radix-ui/react-toast/dist/index.mjs` binds `focusin` (:116), `pointermove`
(:118) and `window blur` (:120) on the viewport wrapper to `handlePause`, which dispatches `VIEWPORT_PAUSE`
(:96); each toast then clears its close timer and records the elapsed time (:341-343), restarting with only the
remaining time on resume (:337, with `startTimer` at :325-329 and the default `duration = 5e3` at :27). A
synthetic click at a covered centre focuses the card and moves the pointer across it, so every press the check
made *extended the lifetime of the thing it was waiting to expire*. A fixed `sleep(6_500)` after such a press
was therefore measuring the instrument's assumptions, not the app's behaviour.

The wait is now condition-based: poll `cardCount()`, `document.activeElement.blur()` to give the pause back,
wait up to 12 s, and only if the card still refuses to retire press its own dismiss control and wait 4 s more.
The run prints which route it took — `how the notification came off the page — retired on its own 4750ms after
the overlay gave the focus back` at all four `/login` widths, `5000ms` at tablet. The dismiss-the-covered-
control check (`a control sitting under the card can be freed by dismissing it`) is a genuine check, and stays.

### 30.8 the counts, run by run

| run | log | checks | measurements | findings | exit |
|---|---|---|---|---|---|
| 1st on this pass | `s5-a11y-run2.log` | 51 | 39 | **5** | 1 |
| after `top-16` | `s5-a11y-run3.log` | 59 | 44 | **2** | 1 |
| after `top-20` (authoritative) | `s5-a11y-run4.log` | 59 | 48 | **0** | 0 |

The 51 → 58-check growth is the eight new assertion instances added while root-causing — `the band starts below
the page's own top bar` at the four `/login` widths and the configure form (5), `no focused control is painted
over by the page's own top chrome` on each keyboard pass (2), and `a control sitting under the card can be freed
by dismissing it` (1) — and two checks renamed. Run4 was read in full, not through a pipe, and its verdict is
the log's own line: `STAGE 5 §31 ACCESSIBILITY / MOBILE: PASS`, teardown `the account this pass created is gone
— left 0`.

### 30.9 other gates on the fixed head

`npm run typecheck` → 0 errors. `npx vitest run src/test/notificationBandPlacement.test.tsx` → 4/4. Full
`npm test` at default workers produced one failure in `appRoutingAuthIsolation.test.tsx` (a guest route stuck on
"Loading…"); that file alone passed, and the whole suite re-run with `--maxWorkers=2` passed **30 files / 439
tests** (`s31-unit-constrained.log`). Classified as contention on this shared host, not as a regression: no test
was changed, edited or skipped to get there. `npm run build` → 0, twice (the second after the 1 px finding).

### 30.10 what this pass left as a measurement, and one gap it found but did not repair

- **Target sizes.** The floor this pass asserts is 24×24 CSS px (the smallest offender, the toast's own dismiss
  button, measures exactly 24×24 and is allowed to). The run prints every effective target below 44 px — 18 of
  them at phone width, mostly 32–40 px pill buttons ("Add a person" 101×32, the alignment trio 111×34, the
  colour swatches 36×36, "Save Draft" 124×36). 44 px is the AAA-level ask, not this product's current rule;
  this is a real limitation of the shipped UI, recorded rather than quietly passed.
- **Landmarks.** Both editor passes report `{"main":0,"header":1,"nav":0}`. The cause is in source, and it is
  inconsistent rather than uniform: `src/pages/EditProject.tsx` renders `<main>` in its error branch (:584) and
  its loading branch (:598) but its success branch opens `<div className="min-h-screen … flex flex-col">`
  (:625), so the page a host actually works on has no main landmark. The instrument prints landmarks as a
  measurement and asserts nothing on them, so this is **not** a §31 finding. It is a one-element product change
  to a page shell that other host routes share, and it is put in front of §33 for classification and in §40 as
  a follow-up needing authorization, rather than slipped into a gate run mid-stretch.
- **Contrast** was asserted only over the copy the host editor paints: 45 text runs at 375, 45 at 768, all
  ≥ 4.5:1 (large text 3:1), the weakest measured runs being the 11 px helper copy at 4.99:1 and the 12 px
  "Saved" status at 4.99:1. 6–7 nodes per pass were declined rather than guessed at (swatches and icon-only
  buttons carry no text of their own) and are printed as a measurement.

### 30.11 what this section does not claim

- It is **not a WCAG 2.1 AA conformance claim**. It is the specific checks this instrument makes, and §30's
  scope line forbids reading a conformance verdict into any Stage 5 browser number.
- Untested by this pass, and not claimed: assistive-technology output (no screen reader was run — "says
  something, by name or by content" is a DOM-level naming check), `prefers-reduced-motion`, 200 % zoom and
  reflow, forced-colors / high-contrast mode, keyboard behaviour of the **guest** document (part B walks the
  host surfaces; the guest page's geometry is §30's sweep, which found 1 interactive element in 40 cells and
  says so), screen-reader announcement ordering, and any device other than the four viewports named in §30.1.
- The fix is to the notification layer's placement only. Nothing here says the toast is well-designed for
  phones at 44 px targets, that it should not fire on every save, or that a 5 s notification is the right
  affordance; those are product decisions this pass was not asked to make.
- The scratch probe used to root-cause §30.2 and §30.7 (`scripts/scratch-s31-probe.mjs`) was **deleted by exact
  path** once it had served, and its logs (`s31-probe-1..6.log`, `s31-domdump.log`) live in the machine's TEMP,
  not in the repository. The instrument repairs are in the tracked files
  `scripts/stage5-a11y-mobile.mjs` and `src/components/ui/toast.tsx`; the new test is
  `src/test/notificationBandPlacement.test.tsx`.

## 31. §32 closure: the traffic picture on the final head, classified and not summarised — and the six things the new instrument had to be told twice (appended, not a rewrite)

### 31.1 what was built, and why it is a separate instrument

No Stage 5 instrument covered §32 before this pass. `scripts/stage4-render-qualification.mjs` §26 classifies
the destinations of **one** surface (a guest page) and the journeys print the same classification for the pages
they happen to publish; neither says anything about the anonymous surfaces, about the authenticated surfaces
where a bearer token exists, or about what the browser keeps on disk afterwards. The new tracked file
`scripts/stage5-network-privacy.mjs` measures those, on the head that is actually delivered — the same
`dist/` the journeys and the sweep ran against (`assets/index-B1tAR2gz.js`), with no product change in this
section and therefore no rebuild and no re-run cycle.

The directive's own wording sets the shape of the report: *do not say "zero network" — classify it*. The app
is not silent, and a claim of silence would have been false: `index.html` declares a preconnect and a
stylesheet for five font families, so two Google hosts are contacted by design on every surface.

### 31.2 the picture, by surface (authoritative log: `s5-network-privacy-run4.log`)

| surface | preview `127.0.0.1:4173` | local API `127.0.0.1:54400` | `fonts.googleapis.com` | `fonts.gstatic.com` | in-page (hostless) |
| --- | --- | --- | --- | --- | --- |
| landing `/` | 13 | — | 1 | 6 | 1 |
| `/login` | 8 | — | 1 | 2 | — |
| `/signup` | 8 | — | 1 | 2 | — |
| `/i/<a credential never minted>` | 8 | — | 1 | 2 | — |
| `/i/<credential>`, cold | 8 | 2 (1 preflight + the resolver) | 1 | 2 | — |
| same address, after one reload | 16 | 3 | 2 | 4 | — |
| host `/dashboard` (session-cumulative) | 29 | 5 | 2 | 4 | — |
| host `/project/…/configure` (cumulative) | 41 | 7 | 3 | 6 | — |
| host `/project/…/edit` (cumulative) | 56 | 29 | 4 | 8 | 1 |

Every http(s) origin in every one of those rows fell in one of four buckets — local preview, local API, the two
declared font hosts — and the instrument asserts an `UNCLASSIFIED` bucket rather than leaving one unfilled:
`every http(s) destination is loopback or a declared font host` passes on all nine surfaces, as does
`no analytics, tag-manager, error-reporting or hosted-Supabase destination` against a **named** host list
(analytics/tag managers, Sentry, PostHog, Mixpanel, Segment, Amplitude, Clarity, Hotjar, `lovable.dev`,
`vercel.app`, `supabase.co`/`.in`, plus the hosted project label `.env` still carries). The hosted label was
searched for in the shipped `dist/` before the browser opened, and is absent from it; the prelude prints the
**length** of that label, never the label.

The last column is a fifth *kind*, not a fifth destination: `data:` URIs the browser answers from bytes it
already holds. On the landing page it is the hero's SVG noise filter — a literal in
`dist/assets/Index-DbSErXRT.js`, from `src/components/landing/HeroSection.tsx` — and on the editor a base64 SVG
assembled at runtime. Both are hostless, which the instrument now asserts (`every in-page request has no host
to send to`) instead of filing them as unknown destinations.

### 31.3 what the font CDN is actually told

Read off the headers, per request, after the run-2 correction in §31.6:

```
  ..   [surface] landing / · 7 request(s) toward the font CDN, by referrer class — Stylesheet: empty | Font: cdn-self (fonts.googleapis.com)
  ok   [surface] landing /: the requests this page makes to the CDN carry no referrer at all — nothing of ours was named
  ok   [surface] landing /: nothing sent to the CDN names this app's own origin — only the CDN's own origin ever appears, on files its own CSS asked for
  ..   [surface] landing / · Origin the browser puts on CDN requests … — http://127.0.0.1:4173
  ok   [surface] landing /: the Origin handed to the CDN is the bare preview origin, with no path — http://127.0.0.1:4173
```

Three facts, and they are different facts:

- the stylesheet request **the page itself** makes carries a `Referer` header with an **empty** value — the
  `<meta name="referrer" content="no-referrer" />` in `index.html` doing what it declares. This is the same
  measurement Stage 3 §9.3 took, reproduced here on the Stage 5 head, on all four anonymous surfaces and on
  the guest page whose own address contains a credential.
- the **font files** carry `Referer: https://fonts.googleapis.com/`. They are requested by Google's own
  stylesheet, so the referrer is the CDN referring to itself, origin-truncated. Stage 3 reported the empty
  referrer on "the fonts request" without separating the stylesheet from the files it pulls; this section
  separates them, because "the page's address is never used as a referrer" and "nothing is ever handed over as
  a referrer" are not the same claim, and only the first is true.
- the CDN does learn `Origin: http://127.0.0.1:4173`. A referrer policy does not suppress `Origin`, and the
  `preconnect` in `index.html` announces those hosts before any request carries anything. What the CDN is
  **not** told is the path, so the credential in `/i/<credential>` is in 0 headers and 0 URLs sent to any
  non-loopback host — asserted per surface, not inferred.

### 31.4 where each secret travels, declared as places rather than banned

```
  ..   [guest] guest /i/<credential> · where each secret was actually seen — shareToken@preview:url, shareToken@local-api:x-invitation-token
  ok   [guest] guest /i/<credential>: no secret of this pass reaches any third-party destination — nothing reached a host outside this machine
  ok   [guest] guest /i/<credential>: each secret travels only to the places this pass declares — travel matches the declared set
  ..   [host] host editor (session-cumulative) · where each secret was actually seen — bearer@local-api:authorization
```

The rule table lives in the instrument as data (`TRAVEL`), so a hit outside it is a finding rather than an
interpretation: the guest credential may appear in the preview origin's own `/i/` path and in the resolver's
`x-invitation-token` header, and nowhere else; the host bearer may appear only as `Authorization` on a
loopback API call; the service-role key, this run's password, this run's email and the hosted project label
may appear **nowhere** in any request URL or header. Run 4 reports `nowhere` for the last four on every
surface, including the login page where the password is actually typed (it travels in the POST body to the
loopback API, which this instrument does not read — see §31.7).

The Stage 3 residual is restated rather than hidden: the credential *is* in the navigation request to the
preview server, because `/i/<credential>` is the address a host pastes into a chat, and it remains in browser
history. `1 navigation request(s) to http://127.0.0.1:4173 carry it in the path /i/‹credential masked›; 1 API
request(s) do not`.

### 31.5 the authenticated half, and the boundary the login itself sits on

```
  ..   [host] host editor · API paths reached — /auth/v1/token, /rest/v1/weddings, /rest/v1/invitation_drafts, /rest/v1/invitation_versions, /rest/v1/rpc/get_invitation_publication_state, /rest/v1/rpc/preview_invitation_document, /rest/v1/tradition_packs, /rest/v1/wedding_people, /rest/v1/venues, /rest/v1/wedding_events, /rest/v1/tradition_pack_releases
  ..   [host] host editor · how the data calls were authorised — {"host bearer":14}
  ..   [host] host editor · the auth endpoint calls in this session — POST /auth/v1/token → anonymous key
  ok   [host] host editor: every data call carried the host's own bearer — 14 data call(s), all on the host bearer
  ok   [host] host dashboard: the session lives in this origin's storage and in no cookie — {"chromeCookies":[],"localKeys":["sb-127-auth-token"],"sbKeySeen":true}
```

24 data calls across the three host surfaces (2 + 3 + 14 … the remaining 5 are the preflights and the auth
exchange) all carry the host's own bearer; not one data call was made with only the publishable key. The one
call authorised with the publishable key is `POST /auth/v1/token`, the exchange that *creates* the session, and
the instrument now names that as a rule rather than tripping over it. The session lives in
`localStorage['sb-127-auth-token']` and in **no** cookie — `cookiesForOrigin()` returned `[]` on every one of
the nine surfaces, and `document.cookie` was 0 characters on the four anonymous ones and on the guest page.
No host-surface request carried this pass's guest credential. Afterwards, the driver deleted the Chrome profile
it had created (`the browser profile that held the host session was deleted by the driver — removed`), and the
SQL teardown left `0` rows and `0` accounts.

### 31.6 the six things the instrument had wrong, in the order they were found

Run 1 (`72 checks, 73 measurements, 15 findings`) looked like a product with a leaking app. It was an
instrument with a leaking set of premises, and each one was root-caused on measurement before any assertion
moved:

1. **`data://` filed as an unclassified destination.** `originOf()` gives a `data:` URL the string `data://`,
   which is not in an http-origin allowlist, so a byte string the browser already had became "an unknown
   destination". Reproduced by probe: the request is `type=Image`, `data:image/svg+xml,…feTurbulence…`. Fixed
   by splitting http(s) from in-page schemes, bucketing them separately, and asserting they carry no host.
2. **A blanket "no credential anywhere" ban that fired on the design.** The guest credential in the guest's own
   address and the host bearer on the host's own API calls are how publication and login work. Replaced by
   `TRAVEL` (§31.4) — a *stronger* rule, because it now also forbids the same secret appearing in a **header**
   of the preview origin, and it hunts the password and email too, which run 1's check *name* promised and its
   needle list did not deliver.
3. **A cumulative tally that convicted the sign-in.** `{anonymous key: 1, host bearer: 2}` on the dashboard was
   the login token exchange still in the same page's log. Probe evidence: `11 | POST /auth/v1/token | auth=Bearer ‹ANON›`
   and `21 | GET /rest/v1/weddings | auth=Bearer ‹JWT›`. Fixed by drawing the boundary at the path and asserting
   both sides (§31.5).
4. **"Nothing is handed to the font CDN as a referrer" was false as stated**, and the run-1 detail was
   uninformative — it printed request URLs where it meant to print header values. The probe that settled it had
   to be corrected first: my first probe looked up `h.referer ?? h.Referrer` and reported `referer=ABSENT` for
   every font request, which disagreed with the instrument. Chrome's key is `Referer`, the instrument's lookup
   was case-insensitive and the probe's was not — a reminder that a disagreement between two instruments is
   evidence about the instruments before it is evidence about the product.
5. **The repair of (4) then failed on its own best evidence.** `new URL('')` throws, so the *empty* `Referer` —
   the proof that `no-referrer` works — was classified `unparseable-value` and produced 5 findings in run 2
   (`115 checks, 90 measurements, 5 findings`). The empty-string test moved before the parse; run 3 was green.
6. **The instrument leaked the credential into its own report.** Run 3's section header printed
   `--- guest /i/<credential> @ /i/rHUiJoTF…` because the raw `console.log` bypassed `mask()`, which only the
   check and measure helpers passed through. Found by grepping the authoritative log for a 43-character run,
   not by reading a finding. Fixed, re-run as run 4, and re-grepped: the only 43-character strings left in the
   log are the deliberately never-minted fake used to measure an invalid address.

| run | checks | measurements | findings | what moved |
| --- | --- | --- | --- | --- |
| 1 | 72 | 73 | **15** | the four premises above |
| 2 | 115 | 90 | **5** | repairs 1–4 landed; repair 5's own bug exposed |
| 3 | 115 | 90 | 0 | empty-`Referer` ordering fixed |
| 4 | **115** | **90** | **0** | masked prints — `STAGE 5 §32 NETWORK / PRIVACY: PASS`, `EXIT=0` written into the log by the command itself |

The completion notification attached to run 1 reported "exit code 0" while the log's own last line said
`EXIT=1`; the rule from §29.4 held again — every verdict above is taken from the log, and run 1 was never used
as evidence that anything passed.

### 31.7 what this section does not claim

- It is not "zero network" and does not claim the font hosts are harmless. Two third-party origins are reached
  by design on every surface; what is claimed is that they are the **only** two, that they learn the page's
  origin and not its path, and that nothing secret of this pass reaches them.
- Request **bodies** are not scanned. The login password travels in a POST body to the loopback API, which is
  where it belongs; a body-level assertion would need a different instrument, and none is claimed here.
- The needles are literal strings, not encoded-aware. A JWT's own decoded claims (which contain this run's
  email) are not searched for, because the token was captured as the needle's source, not as a place it may
  appear; the bearer rule allows it exactly one field on exactly one origin.
- One cold load and one reload per surface, at 1280×800, `dpr 1`. Not a soak, not a multi-tab or service-worker
  test, and not a measurement of the hosted deployment (there is none: `NO PRODUCTION DEPLOYMENT`), so nothing
  here speaks to CDN logs, TLS behaviour or the headers a real hosting layer would add.
- No WCAG, EAA or privacy-regime conformance is claimed, and no claim is made that a referrer policy is a
  substitute for a short-lived credential: the credential's exposure surface is §31.4's disclosed residual.
- Before anything was removed, each §32 scratch file was scanned for 43-character credential-shaped strings and
  classified: the probe's own script and one probe log held only the never-minted fake, while `s32-probe-2.log`,
  `s32-probe-3.log` and the run 1–3 logs each held a real-shaped credential from a run whose rows were already
  torn down. All seven were then **deleted by exact path** (`$TEMP/s32-probe.mjs`, `$TEMP/s32-probe-1.log`,
  `s32-probe-2.log`, `s32-probe-3.log`, `$TEMP/s5-network-privacy-run1.log`, `run2.log`, `run3.log`) — no glob,
  no recursive removal — after the facts they carried were recorded above. The only §32 scratch file kept is
  `s5-network-privacy-run4.log`, re-checked after the deletions to contain nothing but the never-minted fake.
  All of them lived in the machine's TEMP; the only file added to the repository is
  `scripts/stage5-network-privacy.mjs`.

## 32. §33 closure: three readers who were not told what I believed, ten findings, and two of them about my own write-up (appended, not a rewrite)

### 32.1 how this pass was run, and the one thing about it that is weaker than §17 asked

§17 item 8 asked for an independent final security review of the Stage 5 migration and the maintenance CLI
"by a second reader". It was done by three, and none of the three is human, which is the first thing this
section has to say rather than the last. Each was dispatched with file paths and questions and **not** with
my conclusions: two were told to report only exploitable issues and broken invariants, and to ignore style,
coverage wishes and formatting; the third was handed the audit's own claims and told to check each one
against the files rather than against its memory of the discussion. Their reports came back before I read
any of them against my notes, and every finding below was then re-verified by me in the shipped file before
it entered this section — which is how one of them was thrown out (§32.5) and two proposed repairs were
refused (§32.4).

The limit, stated so that no later reader over-reads the word "independent": an agent reader carries none of
my session's assumptions but shares my tooling and my training. It can find a window I did not look for. It
cannot supply the judgement of a Tamil-reading cultural reviewer about whether wording is right, or a human
security engineer's institutional scepticism about a threat model, and §17's item 8 was arguably asking for
the latter kind of second reader. §33's independence is therefore about **context**, not about **kind**, and
no sentence in this stage should be read as a sign-off by a qualified reviewer. The real candidate's
`human_reviewed` column remains `false` for exactly that reason.

### 32.2 the ten findings, classified, with who can reach each

| # | surface | what was found | class | reach | this pass |
|---|---|---|---|---|---|
| 1 | guard's digest pin (§29's repair, carried in for re-examination) | the pin covers exactly the state-moving arms and the still-draft case, and the two later edges cannot be talked out of a digest | real defect, already repaired | maintenance identity only; `anon`/`authenticated` hold column-level SELECT and are refused by `private.reject_client_write` | re-confirmed by reading, not by trusting §29: the behavioural arms are B17/B17c/B18/B18c/B19, re-measured in both chains (§32.3.1) |
| 2 | `private.review_field` (migration :149-161) | a field's value is written into the hashed manifest **as stored**, so a value containing a line break makes the printed manifest stop describing one field per line; the escaping in `private.canonical_token` (:132-147) protects the *token* layer only | real defect | the maintenance identity — the only party that can write any of these fields | **not repaired** (§32.4). The comment's claim was scoped to say what it now means, and the byte length in the same line is named as the reader's tell |
| 3 | `internal_api.submit_tradition_pack_review` | read-then-write window: the digest handed in was compared against material that had been *read*, not held, so a concurrent draft edit could bind a reviewer to bytes they never saw — and the recheck at approval would agree, because both halves would then describe the new material | real defect | two maintenance sessions (`psql` or the CLI) against one catalogue; `REVOKE … FROM PUBLIC, anon, authenticated, service_role` at :2171-2173 keeps every browser out of it | **repaired** — `FOR UPDATE` at :2091, ahead of the comparison at :2108-2118. Pinned by B20 (§32.3.1) |
| 4 | the digest's dependence on the live `tradition_packs` row | pack key, display name and scope sentence are read from the pack table when a digest is computed, so editing them after approval leaves a stored digest describing material the row no longer carries | real limitation, not a defect to repair in-stage | maintenance identity | escalated as a design question. The `review_packet_hash` COLUMN comment (:56) now says the drift is **detectable** through `inspect_tradition_pack_release`'s `binding_current` and **not prevented**, and why: the pack row is shared by every release of the pack |
| 5 | `design_templates` readable at `status IN ('draft','approved')` while pack releases are gated to approved | raised as "an unreviewed thing is customer-selectable" | **false positive** (§32.5) | n/a — the asymmetry is documented, with its reason, in the shipped file at `20260927120000_stage4_tradition_pack_releases.sql:1593-1598`, and clients cannot write the table at all (`20260925120100_stage2_canonical_domain.sql:214`) | rejected, and the mistake in my own preliminary write-up recorded |
| 6 | `scripts/tradition-pack-admin.mjs:488` | `machineAssisted: args['machine-assisted'] === false ? false : true` — a ternary that cannot take its false branch, because `--machine-assisted` is declared in `BOOLEAN_FLAGS` and so is never `undefined` | real expression defect, behaviour already honest | the CLI, i.e. the maintenance identity | repaired to an explicit `true` with the reason beside it, and the usage line now reads `[--machine-assisted no-op]`. The value never moved; the pre-existing pin at `supabase/tests/api/stage5_admin_cli.test.mjs:886` keeps it from moving |
| 7 | `src/lib/safeError.ts` header | the comment claimed "no part of this project puts that prose in front of a user". Login, Signup and ResetPassword do display GoTrue's messages | real *claim* defect; the code was fine | host-visible prose | narrowed to the data path, with the auth exception named and the reason it is a different case (an authentication outcome describes no schema) |
| 8 | no Content-Security-Policy anywhere in the delivered response | true, and unremarkable for a local-only build | documented limitation | n/a while `NO PRODUCTION DEPLOYMENT` holds | recorded, not repaired. A CSP authored against a stack that is not deployed would be a guess |
| 9 | the CLI echoes raw `psql` stderr on a refusal | constraint text, including a pack uuid, reaches the terminal | documented limitation | whoever runs the CLI | recorded. `.gitignore:3` (`*.log`) keeps the transcripts of it out of the repository |
| 10 | `src/components/ui/chart.tsx:70` `dangerouslySetInnerHTML` | raised as an XSS surface | false positive as a live risk (no file imports `chart.tsx`), real as a **checker blind spot** | nothing imports it | not repaired. What it exposed is that `scripts/check-product-contract.mjs`'s 27 rules contain no rule about `innerHTML` or sanitisation, so "the checker would catch it" was never true for this class. §36's checker-widening note carries it |

The measurements §30 and §31 handed forward were classified in the same pass: the sub-44 px tap targets
(§30.10) are a real limitation of the shipped UI needing a product decision, not a Stage 5 defect; the
`<main>` gap (§30.10) was a real defect and was repaired (§32.3.2); SQLSTATE 23514 for a lifecycle refusal
(§26.4) is a documented limitation of encoding a state machine as a check constraint; §28.4's two
transition/focus observations are false positives, being what a page does when a document genuinely changes
under it; and the ten instrument errors §30.10 and §31.6 list are instrument bugs, all repaired, none of
them by loosening a check.

### 32.3 the two repairs that changed shipped text

#### 32.3.1 the row lock, and the battery run that failed on my own new control

The repair is one clause. What made it worth taking seriously was the specific failure the second reader
traced: with no lock, the reviewer's `p_expected_hash` is compared against a recomputation from a row that
can move before the write lands, and the digest that ends up stored is the one over the **new** bytes — so
the guard is satisfied, the approval recheck is satisfied, and the only thing that ever existed describing
the bytes the reviewer read is a packet nobody is holding any more. `FOR UPDATE` at :2091 makes the
comparison and the write statements about one state of the row, and the lock runs to the end of the
transaction, so the edit that loses the race is refused outright by the content-immutability arm: by then
the row has left `draft`.

Only this one edge needed it, and the reason is worth keeping rather than implying: of the six functions
that read a release row, `inspect` (:1723), `get_tradition_pack_review_packet` (:1994) and `validate`
(:2300) write nothing; `approve` (:2175) compares the caller's digest against the **stored** one on a row
whose content the immutability arms froze the moment it left `draft`; `deprecate` (:2236) compares nothing;
and `update_draft` (:1881) can lose a race, which is unimportant because a draft binds nothing — the whole
point of §9 is that a draft's bytes become a promise only at the review edge.

The regression pin is B20 in `supabase/tests/stage5/50_review_binding.sql:780`. This battery is one session
and cannot race itself, so the control is structural, in the shape B15 already uses: the shipped body has to
carry the clause. The pattern is `'FOR UPDATE;'`, semicolon included, so a comment that merely names the
clause cannot satisfy it.

The first run of this repair failed, and the failure is in the record because it was mine:
`$TEMP/s5-sql-battery-s33-1.log` (EXIT=1) aborts at `50_review_binding` with
`ERROR: function pg_temp.s5_ok(text, boolean, boolean) does not exist` — I wrote B20 with a third argument
the helper (:54) does not take. Twenty-one assertions in that group had already passed in that same run, so
the chain died on its newest control and nothing else. Corrected, the both-chains battery was re-run and read
in full (`$TEMP/s5-sql-battery-s33-2.log`, EXIT=0 read from the log's own last line, not from the completion
notice):

```
  stage 4 pack documents (at Stage 5 head): PASSED (428)  [assertion lines observed: 428]
  stage 4 §8 fixture tooling (at Stage 5 head): PASSED (57)  [assertion lines observed: 57]
  stage 5 50_review_binding: PASSED (122)  [assertion lines observed: 122]
  stage 5 60_definition_vocabulary: PASSED (50)  [assertion lines observed: 50]
  stage 5 70_document_resolution: PASSED (124)  [assertion lines observed: 124]
```

— printed twice, once per chain, with the runner's own counter/PASS-line cross-check agreeing at 122 in
both. `50_review_binding` therefore went 121 → 122 with B20 added, which is the only reason its floor moved;
the floor comment at :1455-1470 now reads BASE 4, P 15, B 38, S 36, M 17, T 12, total 122, and keeps the
history (27 → 37 at §29's ten controls → 38 for B20) instead of asserting a bare number.

#### 32.3.2 the landmark §30 measured and §33 fixed

§30.10 reported `{"main":0,"header":1,"nav":0}` on both editor passes and deliberately did not turn the
reading into a finding, because repairing it meant changing a page shell. Read against source, the gap is
one element and its reason is visible in the same file: the error branch (:584) and the loading branch
(:598) of `src/pages/EditProject.tsx` both open a `<main>`, and the success branch opened a `<div>`. The
`header:1` beside it is not page chrome either — the editor has none — it is the invitation document's own
`<header>` inside `InvitationRenderer.tsx:387`, counted by the instrument's whole-document query
(`stage5-a11y-mobile.mjs:232-236`). So the page had a content header and no page main, which is a defect in
the ordinary sense and not a matter of taste.

The directive's standing instruction is that a real issue found is fixed and tested, so §33 took it: the
content region is now `<main className="flex-1 flex flex-col lg:flex-row">` at `EditProject.tsx:654`,
closing at :875, with the sticky toolbar left outside it as page chrome. The repair was chosen against
`ConfigureProject.tsx:82`, which already does this, rather than by renaming the outer wrapper.

It is pinned by a new test in `src/test/editInvitationPage.test.tsx:937-957`: exactly one `main` on the
loaded page, the preview section and the side panel both inside it, and the Save Draft control outside. The
test was falsified before it was trusted — with the element temporarily put back to `<div>`, it fails with
`expected [ … ] to have length 1 but got 0`, which is §30's browser reading reproduced at the DOM level.
Restored: `npx vitest run src/test/editInvitationPage.test.tsx` → **34/34** (was 33), `npm run typecheck` →
0 errors, `npm run lint` → 0 errors / 9 warnings, exit 0 (`$TEMP/s33-lint-1.log`, all nine pre-existing
`react-refresh/only-export-components` warnings in `src/components/ui/`).

The repair also produced a mistake worth recording, because it is the kind a reviewer would not see in a
diff: the comment explaining the landmark first went in as three `//` lines *inside* the JSX children, where
JSX renders such text rather than ignoring it. Caught by checking the file's own convention (this repository
uses `{/* … */}` in JSX, 11 existing occurrences) and rewritten; the file now has no `//` line between
`return (` and its closing tag. `main:1` is not yet a *browser* measurement — the a11y instrument re-runs at
§34 on the rebuilt bundle, and until it does this claim rests on the jsdom test above.

### 32.4 the four things a reader asked for that this pass refused, and why

1. **FINDING 2, "escape the value at render time."** Refused. The payload **is** the hashed material: any
   change to how a field is written moves the digest of every release already in the catalogue, including
   the synthetic approved ones whose stored hash §28's journey bound a guest document to. A backslash
   doubling would additionally wreck `private.jsonb_canonical`'s use of the same value. The honest move
   was to make the comment say what it covers, and to put the repair where it belongs: a decision about
   whether reviewable material may contain a newline at all, taken before any real pack is approved. Note
   that the digest is not *wrong* here — it binds the exact bytes stored, including the newline. What
   degrades is the human-readable packet, which is the artefact a reviewer signs off. That asymmetry is why
   it is escalated rather than buried.
2. **FINDING 4, "hash the pack row's identity too, or lock it."** Refused as out of scope: the pack row is
   shared by every release of the pack, so either repair changes what a re-review means for releases that
   were never touched. The stored digest, the recomputation and `binding_current` already make the drift
   visible at the only two edges that act on it — a review submission and an approval both recompute and
   refuse on mismatch, which §B's controls measure. The residue is a pack edited *after* approval, and it is
   now described in the column comment instead of being implied by an absolute one.
3. **FINDING 6, "make it `args['machine-assisted'] === true`."** Refused: that is the same expression with
   its honesty inverted, because it would default an omitted flag to `false` and let a machine-written pack
   be recorded as human-authored — the exact lie §17's item 5 is about. The value was already right; the
   ternary was a lie about having a choice, and it is gone.
4. **FINDING 10, "delete `chart.tsx`."** Not done. It is a vendored shadcn chart helper, unused but tracked
   from an earlier stage, and deleting a third-party component because a review noticed it is a different
   decision from the one §33 is authorized to make. What was done is to record the checker's blind spot,
   which is the finding with teeth.

### 32.5 FINDING 5, which is this section's finding about itself

My preliminary classification, written before I had read the shipped file's own reasoning, recorded FINDING 5
as "host-reachable only by a hand-made REST write, since no screen sets it". Both halves of that are wrong,
and in opposite directions:

- A hand-made REST write is **not needed**. `src/pages/CreateProject.tsx:30` calls `listDesignOptions()`,
  which filters `.in('status', VISIBLE_DESIGNS)` where `VISIBLE_DESIGNS = ['draft','approved']`
  (`src/integrations/supabase/weddings.ts:83`, used at :103 and :164), and the choice the host makes at
  :48 is inserted at `weddings.ts:193`. So a new wedding is built on a draft-status template through the
  ordinary path, by clicking.
- A hand-made REST write into the template table is **not possible**: `no_client_write_design_templates`
  (`20260925120100_stage2_canonical_domain.sql:214`) refuses client writes, so `draft` rows exist because
  the Stage 2 legacy migration carried them, not because anybody can make one.

And the asymmetry itself is documented, with its reason, in the Stage 4 file's "WHAT THIS FILE LEAVES ALONE,
AND WHY" (§10, :1593-1598): a migrated legacy template has never been reviewed and a picker that hid drafts
would go blank, while the pack table starts empty and holds the sensitive half of the product. Two catalogue
tables with different visibility rules is the outcome of reading each one's reason. So FINDING 5 is a false
positive as a defect, and the residual truth in it — that a *design* can reach a customer without a review
verdict, and that Stage 5's checker says nothing about that — belongs to the same family as FINDING 10's
blind spot and is escalated, not repaired here, because "reviewed" for artwork and "reviewed" for ritual
wording are two different claims and only the second is this stage's contract.

This is recorded at length on purpose. §33 is the section that checks claims; the claim it most nearly
carried forward un-checked was one I had written down myself, twenty minutes earlier, in a summary of
findings.

### 32.6 truth corrections to earlier sections, appended rather than edited in place

The directive for this stage forbids silently rewriting audit history. Nothing in §§0-31 below is altered;
these are the readings a second pass could not confirm, each with what is now known.

| where | what it says | what is actually true |
|---|---|---|
| §30.10 (:2515-2521) | the success branch `<div>` is at `EditProject.tsx:625` | it was at **:626**; and as of this section the element **is** `<main>`, at :654, so the bullet's complaint is closed and its line cite is historical |
| §30.x (:2400-2401) | "the `sm:` variants are exactly `["sm:top-auto","sm:bottom-0","sm:right-0"]`" | `src/components/ui/toast.tsx:23` carries **four** `sm:` tokens (`sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col`), and `src/test/notificationBandPlacement.test.tsx:84` asserts with `arrayContaining`, i.e. it permits a superset. The test is right; the sentence over-read it |
| §29's table (:2318) | a direct `pg_proc` scan reported `repaired-scope INSTALLED` | no log of that scan survived, so as written it was unverifiable when §33 read it. Re-run against the live local stack and logged (`$TEMP/s33-installed-shape-1.log`): the exact two-line form of the pin **is** installed. Same log answers the new repair honestly: `FOR UPDATE` is **ABSENT** there, because that stack predates §33's edit — see §32.8 |
| §30.8's table | run 3 "exit 1" | `s5-a11y-run3.log` carries no exit marker. The exit code is derivable, not measured: `scripts/stage5-a11y-mobile.mjs:1032` sets `process.exitCode = 1` on any finding, and run 3's log has 2 findings. The claim stands as a deduction; it should have been labelled one |
| §21.1's table (:1249) | `stage5_pack_driven_http.test.mjs` is 1598 lines | true when measured; **1603** now, after later repairs to that file. A head-frozen count, not an error |
| §22.1 (:1381) | `70_document_resolution.sql` grew 1358 → 1534 lines | true when measured; **1540** now, for the same reason |
| `50_review_binding`'s floor comment (as it stood entering §33) | "total 111", "B 27" | repaired in this pass, in the file: the chain prints **122**, group B is **38**, and the garbled `total 111. Two of — 111. Two of` sentence is gone. The history 27 → 37 (§29's ten controls) → 38 (B20) is now stated where the number is |

### 32.7 the instruments this stage changed, in one place, and one cleanup that left no log

Every check this stage altered, so the count of them is auditable rather than spread across sections: four
wrong claims inside §31's instrument (§30.10's list), six in §32's instrument (§31.6), and two structural
mistakes of my own in this section — B20's helper arity, and the JSX comment. Twelve in total, all of them
making an assertion mean more than it did or run at all; **no** existing expectation was widened, and the
one place a reading genuinely changed is `50_review_binding`'s floor, which moved up.

The disclosure: while clearing accounts left by §30's browser passes, a one-off `node -e` cleanup script
matched accounts **by substring** rather than by id, and deleted the session belonging to a probe run that
was still in flight. Its stdout was swallowed by the tool, so the action was only learned about afterwards,
by re-measuring: `probe accounts found = 0`, total auth users 0, and the cascade leaving no wedding rows.
The blast radius was local generated state — a throwaway account created seconds earlier by the same
instrument, whose run then reported its own confusion, which §30 recorded as an instrument defect and
repaired. No repository file, no real user, no remote project and nothing in the DueWeave stack was
involved. It is in this section rather than nowhere because the rule for this stage is that a mutation with
no log is a mutation nobody can audit afterwards, and because it is the reason §30's confusing run is
described as it is.

### 32.8 the counts on the head this section leaves, and where the live stack sits behind them

SQL battery: 428 + 57 + **122** + 50 + 124, both chains, cross-checked (§32.3.1). HTTP tier: 38 + 56 + 28 +
36 + 28 = 186, measured at §23's head and **not** re-run since — the CLI test's `machine_assisted` pin and
the migration's comment edits both land after that measurement, so §34 re-runs the tier. Journeys: run 11,
86 checks / 11 measurements / 0 findings. Render sweep: 143 / 33 / 0. Accessibility: run 4, 59 / 48 / 0,
re-measurement pending on the landmark. Network/privacy: run 4, 115 / 90 / 0. Unit: `editInvitationPage`
33 → 34; the full suite re-runs at §34 under constrained workers.

The local stack carries the guard as §29 shipped it and does **not** carry §33's `FOR UPDATE` or the revised
column comment (§32.6's row for :2318). That is not a defect in the stack, which is a deployment of an
earlier head, but it means the `122` above is a claim about the migration **file** as applied to a
throwaway Postgres, and the `supabase db reset` that brings the live stack level is part of §34, not
evidence this section already has.

### 32.9 what this section does not claim

- It is not a sign-off by a qualified reviewer, and not a penetration test: no external attacker model was
  run, no dependency was exploited, nothing was probed over a network. §32.1 says what the three readers
  were.
- FINDING 1's re-confirmation is a reading of the shipped guard plus the battery's own arms. It is not a
  proof that no other write path can move a digest; the paths that exist were enumerated (:764-781 and the
  six readers) and the enumeration is the claim.
- Nothing here confers authority on a pack. The synthetic releases §28 and §29 used are `TEST ONLY` fixtures
  with a fabricated reviewer label, and the real Tamil/English candidate remains `draft`,
  `machine_assisted = true`, `human_reviewed = false`, `customer_selectable = false`. A §33 review is not a
  cultural review, and a security pass over the machinery that stores a verdict is not the verdict.
- The escalated items (§32.4, FINDING 5's residue, FINDING 10's blind spot, the 44 px target floor, and the
  CSP) are **not** repaired and are **not** claimed to be safe in the abstract. They are described, with the
  reach each has in a local-only deployment, so that a later stage can decide with the reason in front of it.
- The `<main>` repair is verified by a jsdom test and a falsification run. The browser reading of the same
  fact belongs to §34, and until then this section's landmark claim is a DOM-level one.

---

## 33. §34 closure: the clean-install gate run, two gates that exited 1, and the live stack brought level (appended, not a rewrite)

§34 is the only *complete* gate run for this stage: every number in §1's OLD column and §16's CURRENT column
was re-measured on one head, from a deleted-and-reinstalled dependency tree, on a local stack that had been
reset from zero. Each number below comes from a log file that was read in full, and the log names are given
so a later reader can demand the same evidence. Nothing in §§1–32's sections was rewritten to agree with
this one; where this run disagrees with an earlier statement, §33.8 says so.

### 33.1 the sequence, as §34 ordered it

1. Dev/preview servers stopped — confirmed by there being no listener on 5173 or 4173 (measured again at
   §33.9's end; the local stack's 54400/54401 and the unrelated 54321 remained up, and 54321 is not mine).
2. Installer markers and the two manifest hashes captured before anything was deleted —
   `s34-markers-1.log`.
3. Deletion scoped to exactly two paths: `node_modules` and `dist`. No other directory was removed, and no
   source, migration, test, doc or config file was touched by this step.
4. `npm ci`. The first attempt failed — `s34-npm-ci-1.log`, §33.3. The second added 507 packages and audited
   508 — `s34-npm-ci-2.log`.
5. Post-install confirmation: no `.pnpm`, no `.modules.yaml`, npm's own marker present, `vite` a real
   directory, both hashes equal to the pre-install values.
6. The eight Node gates in §34's stated order — lint, typecheck, dbtypes:check, product:check, test, build,
   audit, audit `--omit=dev --audit-level=high` — as `s34g-lint.log`, `s34g-typecheck.log`,
   `s34g-dbtypescheck.log`, `s34g-productcheck.log`, `s34g-test.log`, `s34g-build.log`, `s34g-audit.log`,
   `s34g-audit-omitdev.log`.
7. Installer markers re-checked *immediately after* the Node gates, as §34 required — `s34-markers-2.log`.
8. The four SQL batteries in order — `s34-sql-rls.log`, `s34-sql-stage2.log`, `s34-sql-stage4.log`,
   `s34-sql-stage5.log`.
9. `npx --yes supabase@2.118.0 db reset --local --no-seed` on this repository's own project —
   `s34-dbreset-1.log` — then the live-schema verification `s34-postreset-verify-1.log`.
10. The HTTP tier against the reset stack — `s34-http-final-1.log`.
11. `git diff --check` and `git diff --check origin/main...HEAD` — `s34-diffcheck-1.log`.

One deviation, stated because §34 says not to re-run without explaining: the two `npm audit` commands'
*exit statuses* were re-read after the sequence (`s34-audit-status-a.log`, `s34-audit-status-b.log`), because
the in-sequence capture stored stdout without the status, and this audit's own §1 honesty note forbids
claiming an exit code that was not read from the command. Both are read-only queries against npm's advisory
feed. No other gate was executed twice, and neither re-read changed a number in §33.2.

### 33.2 OLD → MIDPOINT → FINAL

| Gate | OLD (§1, Stage 4 merge base) | MIDPOINT (§16 CURRENT) | FINAL (§34, this run) |
| --- | --- | --- | --- |
| Stage 0 RLS battery | 24 | 24 | **24** PASS lines, `RESULT: PASS` |
| Stage 2/3 clean chain | 42 / 46 / 284 / 464 / 103 | unchanged | **42 / 46 / 284 / 464 / 103** |
| Stage 2/3 legacy chain | 76 / 49 / 284 / 464 / 103 | unchanged | **76 / 49 / 284 / 464 / 103** |
| Stage 4's own runner (Stage 4 head), both chains | 426 + 57 | 426 + 57 | **426 + 57**, assertion lines observed 426 / 57 on all four |
| Stage 4 documents at the Stage 5 head | — | 428 + 57 | **428 + 57**, both chains, observed equal |
| Stage 5 review binding | — | 111 | **122** |
| Stage 5 authoring vocabulary | — | 50 | **50** |
| Stage 5 document resolution | — | 92 | **124** |
| Local HTTP battery | 37 / 56 / 28 (= 121) | 38 / 56 / 28 (pre-existing suites only) | **38 / 56 / 28 / 36 / 28 = 186**, 0 failed, 0 skipped |
| ESLint | 0 errors, 8 warnings | 0 errors, 8 warnings | **0 errors, 9 warnings** (§33.8.1) |
| TypeScript | pass | pass | **pass** (`tsc --noEmit -p tsconfig.app.json`, no output) |
| Generated DB types | 18 tables, 19 views, 0 findings | 19 public + 10 non-client, 19 client tables, 29 groups | **19 migration files; 19 public + 10 non-client tables; 19 client type tables; 29 query column groups reconciled; 0 findings** |
| Product contract | 23 rules over 171 files | 23 rules over 172 files | **27 rules over 181 active files, 0 violations** (§33.7) |
| Unit + component | 355 tests in 24 files | 371 in 25 files | **440 tests in 30 files, 0 failed** at `--maxWorkers=2` (§33.4) |
| Production build | 2194 modules; entry 491.21 kB / 148.31 kB gzip | entry only, module count not captured | **2204 modules; 29 JS chunks; entry `dist/assets/index-BWDFhgPY.js` 509.19 kB / 154.55 kB gzip; `dist` 990K; 15.37 s** |
| Advisories | exit 0 at `--audit-level=high`, exit 0 at `critical` | exit 0 / exit 0 | **prod tree (`--omit=dev --audit-level=high`): "found 0 vulnerabilities", exit 0. Full tree: 2 moderate, exit 1** (§33.4) |
| Whitespace | clean | clean, both ranges | **both ranges EXIT=0**, plus one LF→CRLF checkout-normalisation *warning* (not a finding) |
| Migration surface | 19 files | 19 migrations, reset at midpoint | **19 applied from zero**, `Finished supabase db reset on branch stage5/pack-driven-authoring-review` |

No row was carried forward. The five rows whose FINAL differs from MIDPOINT (Stage 5 batteries, HTTP, lint,
product contract, unit/build) differ because §19–§33 added surface, which is exactly what §18.3 said would
happen; none of them differs because an expectation moved.

### 33.3 the install, and what the markers are allowed to prove

The first `npm ci` died with `EPERM: operation not permitted, unlink …\node_modules\@esbuild\win32-x64\esbuild.exe`
(`s34-npm-ci-1.log`). That is not a repository defect and not a lock-file defect: npm was unlinking the tree
it had been told to replace, and the operating system refused because a process on this shared host still had
that binary mapped. The inference is stated as an inference — esbuild runs a long-lived service process, which
is what the vite dev and preview servers this stage's browser instruments had been using, and no `esbuild`
process exists on the host now (measured: 0 matches in `tasklist`, 6 unrelated `node.exe`), which is consistent
with the holder having exited between the two attempts. The repair was to let the lock clear and re-run the
same command; nothing else was changed, and the second attempt completed normally.

What the marker checks prove, and do not:

* `node_modules/.pnpm` **ABSENT** and `node_modules/.modules.yaml` **ABSENT** at both captures, and no
  repo-root `.modules.yaml`. So pnpm did not author this tree, and nothing between the captures re-authored
  it. This is the check project memory demands before trusting a build size.
* npm's own marker `node_modules/.package-lock.json` **PRESENT**.
* `node_modules/vite` is a real directory (`drwxr-xr-x`, `readlink` gives no target), version **6.4.3**;
  `react-router-dom` as installed is **7.18.4**.
* `package.json` `d66b51fd29a7c487d188df8889bbafc9441c5c4e378c5954bc39287058ee83e5` and
  `package-lock.json` `b7e838079f5a16bc3aa4af68ae73969548c42f0051925e53709bcb916fa94889` — identical at both
  captures and equal to the values taken before the install, so the install wrote no manifest.
* What they do *not* prove: that the tree is the tree a fresh clone would build (that would need a different
  host), or that `npm ci` is reproducible at advisory level — see §33.4's second entry.

`pnpm` was never invoked in this stage, and `pnpm-lock.yaml` / `pnpm-workspace.yaml` remain untracked and
byte-untouched (§35 measures them again).

### 33.4 the two gates that exited 1, each root-caused before any re-run

**`npm test`, default workers.** `s34g-test.log`: `Test Files 1 failed | 29 passed (30)`,
`Tests 3 failed | 437 passed (440)`. All three failures were in one file,
`src/test/appRoutingAuthIsolation.test.tsx`, and all three were `waitFor` timeouts — *"Unable to find an
element with the text: Arun weds Deepa"* (twice) and *"Unable to find role="heading" and name "Welcome
back""*. Two measurements followed, in that order, before anything else was tried:

* the same file alone (`s34-isolate-appRoutingAuthIsolation.log`): 5 / 5 passed, tests taking **808 ms**;
* the same suite on the same head with `--maxWorkers=2` (`s34-unit-constrained.log`): **30 files / 440 tests
  passed, 0 failed**, duration 52.71 s.

The two runs differ in one variable, and the phase timings show what that variable did: *collect* 151.77 s
vs 15.06 s and *environment* 128.87 s vs 25.54 s — a 5–10× inflation of the phases that precede any
assertion, on a 16-core host carrying the Docker/WSL VM and other sessions' node processes. So the failure
is the tests' 1 s `waitFor` budget starving under vitest's default fan-out, not a behaviour change; this is
the rotating-set pattern §24.4 pre-announced ("§34's final gate run has to happen with host headroom or it
will fail on timing rather than behaviour"). No assertion was widened, no timeout was raised, no file was
skipped, and no configuration was committed. The FINAL row therefore states its constraint inside the
number rather than pretending the default run was green: **440 / 30 at `--maxWorkers=2`**, with the default
run's 437 + 3 recorded above.

**`npm audit` (full tree).** `s34g-audit.log`: 2 moderate findings, both `@vitest/mocker 2.1.0 - 4.1.10`
(GHSA-82fw-gwwq-j7x9), reached only through `vitest@3.2.7`, which is a **devDependency**. npm exits 1 for any
finding at or above the level it was asked about, so exit 1 here is the checker behaving as documented, not a
product regression; the re-read statuses are `EXIT(full-tree)=1` and `EXIT(omit=dev,high)=0`
(`s34-audit-status-b.log`, `s34-audit-status-a.log`). The production gate §34 names second is clean:
`found 0 vulnerabilities`. The difference from OLD's and MIDPOINT's exit 0 is that npm's feed has learned
about `@vitest/mocker` since those runs — `package-lock.json` still carries the §26 hash and has not moved
since 2026-09-30T18:31Z, and the prod tree measured 0 at §26 and measures 0 here. npm's only offered fix is
`npm audit fix --force`, which installs `vitest@5.0.3`, a breaking major of the test runner. That was
refused: running it mid-tranche would invalidate every unit number in §33.2, and the repository's standing
discipline from Stage 0 through §26 is to record a dev-only advisory with its reach rather than force a
major. The advisory's reach is local: the mock-redirect path it describes is exercised by a developer's own
config, and no shipped application code depends on vitest.

### 33.5 the batteries, and the 426/428 question closed again

All four runners passed on their first execution in this tranche, on throwaway `postgres:16-alpine`
containers, and each reports *reported* against *observed* PASS lines: Stage 4's four lines measured 426/57
and 426/57, Stage 5's chain measured 428/57/122/50/124 twice over, with no mismatch anywhere. The Stage 0
runner and the Stage 2/3 runner print their per-phase counts and both chains agree with §1's OLD column to
the digit.

Because §32.8's disclaimer named it, the apparent "428 → 426 regression" is restated once more as what the
logs show: `supabase/tests/stage4/run.sh` measures the document battery **at the Stage 4 head**, which has
always been 426, while `supabase/tests/stage5/run.sh` re-measures **the same file at the Stage 5 head**,
where two S8 closure-scan members (`private.invitation_issue_records`, `private.invitation_issue_messages`)
add two assertions. Each runner says so in its own footer. Nothing was re-tuned to make the two agree.

### 33.6 the live stack, brought level, and what that buys

`s34-dbreset-1.log`: the database was recreated, globals re-initialised, and all 19 migrations applied in
filename order, ending `Finished supabase db reset on branch stage5/pack-driven-authoring-review`.
`s34-postreset-verify-1.log` then measured the *deployed* stack rather than the files:

* migrations recorded = **19**;
* the `FOR UPDATE` row lock inside `internal_api.submit_tradition_pack_review` — **PRESENT**;
* the guard's `NEW.review_packet_hash := OLD.review_packet_hash` pin — **PRESENT**;
* `review_packet_hash`'s column comment — the revised §33 wording, first 120 chars quoted in the log;
* generated state after the reset: `public.tradition_packs` 0, `tradition_pack_releases` 0, `weddings` 0,
  `invitation_drafts` 0, `invitation_versions` 0, `publications` 0, `auth.users` 0,
  `private.access_tokens` 0, `private.audit_events` 0, `design_templates` 0, `approval_requests` 0.

That closes §32.8's first disclaimer: the `122` in §33.5 is now a claim about the migration **as deployed to
the live local stack**, not only as applied to a throwaway Postgres. The HTTP tier closes the second one: 186
assertions measured on this head, including the two cases that specifically re-measure §33's repair over the
transport — *"a review submitted against a stale digest is refused, and the database is unchanged"* and
*"approve re-compares against the binding, so the stale digest still refuses and the fresh one works"* — plus
*API36/API37* (the `internal_api` posture), *CAT-04/WRT-02* (every reviewer, authorship, machine-disclosure
and maintenance column refused by name), and *WRT-03/WRT-04* (no maintenance step callable over HTTP; the
only `internal_api` function a browser role may call is the one §23 built a surface for).

`grant` posture read directly from the reset stack (`s34-internal-api-grants.log`, counts confirmed by an
aggregate query on the same stack): `internal_api` holds **19** functions. `anon` holds EXECUTE on exactly
one of them — `resolve_public_invitation`, the guest door. `authenticated` holds it on eight: that same door
plus the seven owner verbs (`create_invitation_version`, `get_invitation_publication_state`,
`preview_invitation`, `preview_invitation_document`, `publish_invitation_version`,
`revoke_invitation_publication`, `rotate_invitation_token`). `service_role` holds it on **none**, and the
same measurement across `public` / `internal_api` / `private` gives `service_role`'s whole EXECUTE surface as
five `private` digest helpers — `canonical_token`, `jsonb_canonical`, `review_field`,
`tradition_pack_review_hash`, `tradition_pack_review_payload`. That is the nested-call posture §32 recorded,
now counted rather than asserted. Note also what the grant log says about
my own method: two probes written against a *guessed* signature
(`submit_tradition_pack_review(uuid,text,text,text,text)`) returned "function does not exist" rather than a
privilege answer, and the inventory form was the one that could be trusted. The guessed form is kept in
`s34-postreset-verify-1.log` lines 6–7 rather than deleted, so the failure to infer a signature from an error
message stays visible.

### 33.7 the checker's rule count, and where a count came from a file rather than stdout

`npm run product:check` prints only its scanned-file count — "Product contract OK — 181 active file(s)
scanned, 0 violation(s)" — so §16's instruction that FINAL must name **both** counts meant reading the rule
set itself: `export const RULES` at `scripts/check-product-contract.mjs:61`, 27 entries in the worktree. Diffed
against `git show HEAD:scripts/check-product-contract.mjs`, the head has 23 and the worktree has 27, with
**nothing removed** and exactly four additions, all §24's cultural-safety rules: `pack-selection-derived-by-name`,
`place-tested-for-a-tradition`, `tamil-candidate-status-claim`, `machine-assisted-claimed-approved`. The
other ids §24 was discussed with (`tradition-pack-identity-branch`, `tradition-selected-from-identity`,
`identity-tested-by-name-shape`, `language-gated-rite`, `ceremonial-authority-claim`,
`draft-candidate-claimed-shippable`) already existed at HEAD, which is worth recording because §24's own
write-up reads as if the whole set were new.

### 33.8 three numbers §§1/16/24 stated wrong, corrected by measurement

1. **Lint: 8 → 9 warnings, and one of them is Stage 5's own.** §§1 and 16 both carried "0 errors, 8
   warnings" through the stage. The FINAL run reports 9 (`s34g-lint.log`). At HEAD the eight were seven under
   `src/components/ui/*` plus `src/components/auth/AuthProvider.tsx:19` (`export const useAuth` beside the
   component — verified with `git show HEAD:` and a corrected `^export` pattern; a first attempt with a
   mis-quoted pattern returned an empty list and would have led to a false "pre-existing" claim). Stage 5
   added a **ninth** by exporting `useWeddingContentRows` (and the `ContentEditor` group components) from
   `src/components/invitation/ContentEditor.tsx:284`, a file that shipped two exports at HEAD. It is the same
   `react-refresh/only-export-components` advisory the repository already accepts in seven shipped files, it
   is a fast-refresh hint rather than a correctness or security finding, and splitting the hook into its own
   module was not done, because that is a refactor §34 did not ask for. What was done is naming it: the
   stage introduced a lint warning, and the count that closes the stage is 9, not "8, as before".
2. **Chunks: 29, not 30.** §24.4 wrote "30 chunks (identical set)". Both the §24.4 build log and this one
   list 29 JS chunks (`ls dist/assets/*.js` = 29 today), plus one CSS file and `index.html`. The claim that
   survives is the set being unchanged between the router heads, which the two logs do show; the count was
   wrong.
3. **The advisory rows named a level but not a tree.** §1's row, §16's row and §24.4's line each say
   "exit 0" for an audit command without stating that `--omit=dev` and the bare command measure different
   dependency graphs. On this head those two answers are 0 and 1. The FINAL row states the tree per command,
   and §33.4 gives the reason.

### 33.9 what this section does not claim

* The `npm test` diagnosis is a timing explanation supported by two runs of the same head and the phase
  inflation between them. It is not a proof that those three assertions are load-proof; it is a reason to
  report the unit number with its worker constraint visible instead of calling the default run green.
* "Dev/preview servers stopped" is measured as *no listener on 5173/4173*, not as a process census of the
  host, and the esbuild holder's identity in §33.3 is an inference from esbuild's service-process model plus
  its absence afterwards, not a PID captured at the moment of refusal.
* The 186 HTTP assertions ran against `localvivaahvarnam` on loopback. Nothing here is evidence about a
  hosted project: no remote Supabase was contacted, and the DueWeave stack on 54321 was neither targeted nor
  modified (its listener belongs to another project's containers).
* The HTTP suite leaves its own declared fixture catalogue in the local stack — 9 rows for Stage 4's suite
  (`s34-http-final-1.log` lines 218–227) and 8 for Stage 5's (lines 350–371), each labelled `TEST ONLY`, each
  reported by the suite rather than hidden, and the log's own line *"Tamil-candidate-shaped rows visible
  here: 0"*. That residue is expected behaviour of a suite that mints releases; §35 measures it as generated
  state and §39 decides what cleanup it gets.
* The post-run drift check in the same log reports `weddings` back to 0, `auth.users` back to 0 and
  `invitation_drafts` back to 0, with `RESULT: PASS`. It does **not** clear the pack catalogue, and this
  section does not describe it as doing so.
* No row in §33.2 is a statement that a Tamil release was reviewed, approved, or is customer-safe. §33.4 of
  §32's findings stand; the real candidate's four flags are re-measured at §35.

## 34. §35 closure: the shape sweeps, the credential that is in pushed history, and the all-zero sweep that came from a quoting bug (appended, not a rewrite)

### 34.1 which log holds which measurement

| §35 clause | log |
| --- | --- |
| added-line shape sweep (20 patterns) | `s35-scan-secrets-2.log`, corpus `s35-added-lines.txt` |
| tracked-file shape sweep (223 files) | `s35-scan-tracked-1.log`, list `s35-tracked-files.txt` |
| tracked / untracked state, git status | `s35-tracked-state-1.log` |
| ignore rules, `.env.example`, on-disk presence | `s35-ignore-and-example.log` |
| live generated state | `s35-generated-state-1.log`, `s35-release-posture-1.log` (two errored queries), `s35-release-posture-2.log` |
| candidate artifact flags | read through node from the tracked JSON; quoted in 34.6 |
| screenshots, artifacts, scratch inventory | `s35-artifacts-scratch-1.log`, `s35-screens-1..4.log`, `s35-history-scan-1.log` |
| scratch secret sweep (three attempts) | `s35-token-scan-1.log`, `s35-scratch-widened-2.log` (invalid), `s35-scratch-widened-3.log`, `s35-scratch-keyword-1.log` |
| reviewer / personal contact info | `s35-contact-scan-1.log`, `s35-izsme-1.log` |
| `.env` history, key class, build embedding | `s35-env-history-1..4.log`, `s35-working-env-1.log`, `s35-dist-embed-1.log`, `s35-dist-embed-2.log` |
| stack availability at write time | `s35-stack-down-1.log` |

### 34.2 the added-line corpus: 27,419 lines, and every nonzero pattern was a name, not a value

Zero hits: JWT-shaped value, `sb_secret`/real `sb_publishable` key, hosted Supabase URL, PEM private key,
GitHub token, AWS key, Slack token, password assignment, raw invitation credential in a URL path, reviewer
contact field, reviewer display name, bearer-header literal, India phone-number shape.

Nonzero, and what the lines actually are:

* **70** match `service_role` — the *role name* in this audit's prose, in `GRANT`/`REVOKE` statements in the
  Stage 5 migration, and in identifier reads (`env.SUPABASE_LOCAL_SERVICE_ROLE_KEY`). No value follows any of
  them. The pattern is the role's spelling, not a credential shape; the credential shape (`eyJ….eyJ…`) is the
  zero row above, and the migration's own leak test asserts against all three spellings at corpus line 22017.
* **17** match an anon-key assignment shape — all of them Supabase header construction (`apikey: key`,
  `Authorization: Bearer ${jwt}`), i.e. variable names.
* **6** match a postgres URL with credentials — the Stage 5 HTTP suite's *planted canaries*
  (`postgresql://postgres:canary-pw-${RUN_TAG}@…`, loopback / hosted / other-host spellings at corpus lines
  21295–21297 and a fourth bait at 22027) plus the prose describing them. A canary is a negative control, not
  a credential: the password is a per-run tag and the hosts are 127.0.0.1, `abcd1234efgh.supabase.co` and
  `10.20.30.40`, none of which this project has ever contacted.
* **16** quoted-long-token and **15** long-hex — git SHAs and sha256 document hashes in this audit file,
  `package.json`/`package-lock.json` integrity hashes, and the `'0000…'` / `'1111…'` fake digests and the
  43-zero `/i/neverminted000…` path that SQL and unit tests use as refusal probes.
* **4** email-shaped — all on `.example.test`.

### 34.3 tracked files (223): nine classes clean, and the four hits worth naming

`jwt-three-part` 0, `jwt-seed` 0, hosted URL 0, PEM 0, GitHub 0, AWS 0, Slack 0, password assignment 0,
key-literal 0. The four nonzero:

1. `sb-key` **2** — `.github/workflows/ci.yml:22` (`sb_publishable_EXAMPLE_PUBLIC_PLACEHOLDER`) and
   `docs/audits/stage-0-truth-security.md:277` which names that same placeholder. Both are placeholder text.
2. `postgres-cred` **2** — `stage-0-truth-security.md:69` (describing Stage 0's own scan) and
   `stage-2-domain-database.md:462` (`postgres://postgres:<local-password>@127.0.0.1:<port>/appdb`,
   angle-bracket placeholders, loopback).
3. `long-base64` **3** — `src/test/editInvitationPage.test.tsx:59` and `:856`, two synthetic 40-character
   alphabet-run tokens used as rotation controls, and `supabase/tests/stage2/40_catalog.sql:1139`, a 64-zero
   hex inside a dollar-quoted insert.
4. The only real-world identifier in the tree: the hosted project reference `hgvztvaoebeyjnyfarii`, one
   occurrence, at `docs/audits/stage-2-domain-database.md:535`, recorded there with the finding that it *was
   never linked against*. It is a project id — public in any Supabase client URL — not a key.

Reviewer private contact information: every address in the tracked tree is on a reserved or synthetic domain
(`example.test` ×34, `stage3.test`/`stage3pub.test` ×6, `example.com` ×3 as login/signup placeholders). Exactly
one non-reserved address exists, and it is not ours: `i@izs.me` at `package-lock.json:5367`, inside npm's own
`deprecated:` notice text for old `glob` versions, shipped verbatim by the registry, 0 occurrences in Stage 5's
added lines. Editing registry text out of a lockfile would be reverted by the next `npm ci` and would put the
lockfile out of step with the registry, so it is left and named instead.

### 34.4 `.env.example`, and the ignore/tracking matrix §37 has to respect

`.env.example` is three variables and all three are placeholder prose (`your-project-ref`,
`https://your-project-ref.supabase.co`, `public-anon-key`); a shape scan of the whole file returned none. Its
header already states the rule that no `service_role` key, database password or payment secret may go in a
`VITE_*` variable.

| path | tracked | ignored (rule) |
| --- | --- | --- |
| `.env` | no | yes (`.gitignore:16`) |
| `.env.local` | no | yes (`:17`) |
| `supabase/.temp` | no | yes (`:21`) — contains only `cli-latest` |
| `supabase/.branches` | no | yes (`:22`) — contains only `_current_branch`, 4 bytes |
| `dist`, `node_modules`, `artifacts/` | no | yes (`:11`, `:10`, `:26`) |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | **no** | **no** |
| `s5-browser-harness/` | outside the repo | n/a |

The pnpm pair is the operative finding for §37: they are untracked and *nothing in `.gitignore` stops
`git add .` from taking them*, which is precisely why the directive's explicit-path staging rule matters here,
and why "Do not touch pnpm files" is enforced by the staging list rather than by an ignore rule I could have
added and §35 was not asked to add. Local stack keys: no `supabase/.temp/config.toml` or `api-keys.json` exists
on disk, no tracked filename matches `*.key`/`*.pem`/`.temp/`, and no tracked file contains a three-part JWT
(`git grep` over HEAD: 0 files). Tracked images: 0 (`.png`/`.jpg`/`.jpeg`/`.webp` in HEAD = none).

### 34.5 live generated state, and the posture of every row in it

Measured 2026-10-02T18:55–18:59, i.e. after §34's HTTP battery finished (18:19) and after the clean reset, so
this is the state the stage ends with rather than a mid-run snapshot:

* **0 rows** in `public.weddings`, `invitation_drafts`, `invitation_versions`, `publications`,
  `approval_requests`, `auth.users`, `private.access_tokens`, `private.audit_events`, `design_templates`,
  `legacy.projects`. The token tables being empty is the load-bearing one: **no live invitation credential
  exists anywhere in the stack**, so there is no raw guest link to leak.
* **11 packs / 17 releases**, every one minted by a suite: each `pack_key` is `stage4_*` or `stage5_*`, each
  `display_name` begins `TEST ONLY`, every release row has `machine_assisted = true` and `reviewed_by IS NULL`,
  and the review columns read `TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW` (or `TEST FIXTURE REVIEWER`)
  with a basis naming the automated suite. Status histogram: draft 2, reviewed 2, approved 8, deprecated 5.
* "Approved" there is a *lifecycle state on a fixture*, not a review event: nothing in this catalogue is
  selectable by a real customer, because `customer_selectable` is a derived read of approved releases and the
  reviewer id behind all 17 rows is NULL. Tamil-candidate-shaped rows in the live catalogue: **0**.
* Two label caveats, kept visible. (a) `s35-release-posture-2.log` prints its two booleans positionally. The
  release DDL at `supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql:92-171` has no
  `human_reviewed` and no `customer_selectable` column; the only pair consistent with the observed values
  (true for approved + deprecated, false for draft + reviewed) is `machine_assisted` and
  `approved_at IS NOT NULL`. That mapping is derived from the schema, not read off a header, and the labelled
  re-measure is queued in 34.10. (b) The first two posture queries errored — `r.pack_key does not exist`
  (releases reference `pack_id`) and `invalid input syntax for type uuid: "<null>"` (`reviewed_by` is a uuid,
  so `coalesce(...,'<null>')` cannot work). Both are recorded in `s35-release-posture-1.log`, not discarded.

### 34.6 the real candidate's four flags, re-measured where they are actually stored

`content/tradition-packs/tamil-english-foundation.v1.json`, read as JSON: `status = "draft"`,
`machine_assisted = true`, `human_reviewed = false`, `customer_selectable = false`, `review = null`,
`author_label = "VivaahVarnam Stage 4 working draft, authored with a coding model"`, and its own note that each
Tamil value is a bracketed placeholder rather than wording. Unchanged from §§1 and 24 — §33's closing bullet
promised this re-measure and this is it.

### 34.7 browser artifacts and screenshots: tested for a token, not assumed to be clean

* Nothing is tracked (34.4). The five PNGs under `artifacts/stage4-render/` are ignored by rule 26, and their
  names carry no credential.
* The sweep's captures are page-surface images: `scripts/stage4-render-qualification.mjs:1055-1059` sets the
  viewport, navigates to `${PREVIEW_ORIGIN}/i/${doc.token}`, then `Page.captureScreenshot` (`:807-809`). Browser
  chrome — where a URL would be legible — is not part of the surface, so the token in the address bar is not in
  the image.
* A page could still print its own credential, so the app was measured instead: across `src/` excluding
  `src/test/`, **0** JSX interpolations of a token-named variable into text or an attribute, and
  `src/pages/PublicInvitation.tsx:74` states the opposite intent deliberately ("Plain text, no token"). The
  guest view cannot display a raw share token, so no screenshot of it can.
* Every harness screenshot goes to an OS-temp directory the script removes itself:
  `stage5-a11y-mobile.mjs:978` `mkdtempSync` … `:1022` `rmSync(..., {recursive, maxRetries: 10})`;
  `stage5-ui-journeys.mjs:82`/`:1280` likewise; and the browser driver deletes its Chrome profile at
  `stage5-browser-driver.mjs:175-187`, reporting the exact path when Windows still holds a file instead of
  pretending the delete happened.
* The one piece of browser state still on disk is `s5-browser-harness/` (234 MB, workspace root, outside the
  repo, dated Oct 1 00:30–00:31). It was tested rather than assumed: **0** files in its Chrome profile match
  `localvivaahvarnam`, `54400`, `sb_publishable`, `sb_secret` or `eyJhbGciOi`; Local Storage totals 463 bytes
  and Session Storage 603; `History` contains 0 `/i/` paths and 0 URLs on `localhost`/`127.0.0.1` — the profile
  never reached the local stack, which fits it being the abandoned profile of the first failed launch. The only
  `access_token` string in the tree is inside a bundled third-party extension's `background.js`, and the
  apparent 43-character hits in `History`/`Web Data`/`Favicons` are Chrome's own URL/hash blobs. So this path is
  **not** token-bearing: it goes to §39 as ordinary 234 MB scratch, and it is not recorded here as a secret
  deletion it has not earned.

### 34.8 the scratch sweep: the first widened run was invalid, and the fix changed the answer's meaning

1. `s35-token-scan-1.log` swept all 27 scratch paths for the minted-credential shape (43 URL-safe characters,
   which is exactly what `private.mint_public_invitation_token` writes) and for `eyJ`: **0 in every file**.
2. Widening to 16 shapes produced an all-zero table — including zero lines matching the bare word `token`, in
   logs that are full of test titles naming tokens. That is impossible, and the reason was mine: every path
   contains a space, so `cat $(sed 's/^/"/;s/$/"/' …)` word-split them and `grep -c` counted empty input. The
   invalid run is kept (`s35-scratch-widened-2.log`) as the artifact of a false zero.
3. Re-run with per-file quoting *and* an input-size proof (`s35-scratch-widened-3.log`): 27/27 files readable,
   6,272 lines and 546,962 bytes actually swept. Result — JWT-shaped 0, `sb_secret`/`sb_publishable` 0,
   `SERVICE_ROLE_KEY` 0, `postgres(ql)://user:pass@` 0, PEM/GitHub/AWS/Slack 0, `apikey` 0, `Bearer <20+>` 0,
   `/i/<20+>` 0, and the same per file rather than only in aggregate. Nonzero only for the bare words
   `password` (6), `secret` (18), `token` (18); all 42 lines are printed with long runs redacted in
   `s35-scratch-keyword-1.log` and they are assertion titles ("CLI-SECRET nothing the tool printed is a
   credential", "API15 the token never appears in a URL…"), a `NOTICE:` about a retired legacy policy, and
   hashed asset filenames.
4. Consequence, stated plainly because the directive's clause is conditional: **no scratch file met the
   token-bearing test, so §35 deleted none.** The honest closure is "measured zero, nothing deleted" — not a
   deletion this section could justify. The 27 paths remain for §39, which is where ordinary scratch cleanup
   belongs.

### 34.9 the one real finding: a hosted anon key sits in pushed history, and its class is now measured

Stage 0 recorded one whole-history hit and removed it from the tree; §35 was the first pass to measure *what
class of key* it was.

* `git log --all -- .env` names exactly two commits: `c037e92` (2026-02-22, the scaffold import) added it, and
  `68dbeed` ("chore: complete Stage 0 truth and security baseline") deleted it — 3 lines removed, status `D`.
  The only other `.env*` path ever committed is `.env.example`.
* The blob is three variables: a 20-character hosted project ref (masked `hgv***`), a 40-character hosted
  `*.supabase.co` URL (`htt***`), and a 208-character JWT-shaped `VITE_SUPABASE_PUBLISHABLE_KEY` (`eyJ***`).
  All seven trees that carried it hold the *identical* bytes (sha256 `510a51a41fb8d166…`).
* The key's `role` claim decodes to **`anon`** (`iss = supabase`, `ref = hgv***`, `iat` Feb 2026, `exp` 2036).
  0 historical blobs contain a `service_role` string, and the single blob shown by the whole-history loop is
  that same anon one. The decode is in `s35-env-history-4.log`, obtained after the first attempt failed: bash
  wrote `/tmp/s35-committed-env.tmp` while node resolved `C:\tmp\…` (ENOENT), so the retry piped `git show` to
  node's stdin instead. The value itself is printed nowhere — not in this section, not in the temp logs — and
  each temp copy of the blob was removed by exact path.
* It is **not** in HEAD's tree and **not** in `origin/main`'s tree; it is in the pushed commit graph. So the
  exposure is history-visible, not tree-visible, and it predates every rule of this project's own stages.
* The build does not carry it: §34's `dist` (33 files) contains 0 occurrences of the hosted ref, 0 decodable
  JWTs, and only the loopback origins `http://127.0.0.1:54400` and `http://localhost:9999`. `.env.local`
  outranks `.env` in Vite's load order and supplies the local-stack loopback publishable key; the
  `SUPABASE_LOCAL_*` names in it — including the service_role JWT and the DB URL — are not `VITE_*`, so Vite
  cannot inline them into client code. That is measured from the built output (`s35-dist-embed-1.log`, `-2.log`),
  not argued from Vite's docs.
* Severity, in the plain terms this section owes: an anon/publishable key is the class a Supabase SPA ships to
  every visitor by design, and it is useless without the RLS and grant posture that Stages 2–5 qualify. What
  history leaks is the project reference plus a public-class key, not a privileged one. It is still a real
  finding because the working `.env` names the same project (208-character anon key, ref prefix `hgv`) with
  *different* bytes than all seven historical blobs — so two keys for one hosted project are visible to anyone
  who clones this repository.
* Disposition. Not done here, and not negotiable at this stage: no history rewrite, no rebase, no amend, no
  force-push, and no contact with the hosted project (REMOTE SUPABASE: UNTOUCHED is a §40 field). What is done:
  the finding is recorded in this audit, in §40's KNOWN LIMITATIONS, and as an explicit out-of-band ask —
  rotate or retire the hosted anon key if that project still exists, which is a decision only the owner can
  make. The tree-level cleanup is already complete and verified: `.env` and `.env.local` are both untracked and
  both ignored, and Stage 0's baseline commit is what removed the file.
* Method note kept visible: the node script that classified the working `.env` carried a stray
  `readFileSync('/dev/null')`, so node exited nonzero after printing the useful lines and the `||` chain ran it
  twice; both runs' classification lines agree (`s35-working-env-1.log`), which is why that log shows the same
  answer twice with an error between.

### 34.10 what this section does not claim

* Not "no secret exists in this repository". It says: no secret-shaped value is in the tracked tree, in Stage
  5's added lines, in the scratch files, or in the browser state this task created — **except** the anon-class
  key in the seven historical `.env` blobs, which is named, classified and escalated above.
* Every sweep is bound to its own pattern vocabulary (JWT three-part, `sb_*`, postgres URL, PEM, GitHub/AWS/
  Slack, `apikey`/`Bearer`, the 43-character minted-credential shape, and 32–60-character base64url runs). A
  credential encoded some other way would not be caught by what I ran. The `.env` finding is itself the proof
  of that limit: it took a history walk, not a shape sweep, to surface.
* The local stack is down as this section is written — no Docker daemon pipe, nothing listening on 54400 or
  54401 (`s35-stack-down-1.log`) — so 34.5 is the last live measurement, not a fresh one, and the labelled
  posture re-run waits for the stack. Per the standing rule I did not start Docker myself; if §39 needs the
  stack stopped further, it is already stopped.
* No statement in this section says a Tamil release was reviewed, approved, or is customer-safe. 34.5 and 34.6
  exist to keep that distinction inside the numbers rather than outside them.

## 35. §36 closure: Stage 5 truth sync closure corrections (appended, not a rewrite)

§36 authorised a documentation pass and forbade two things inside it: changing behaviour, and rewriting what
earlier sections already said. So this section does not touch `## 5` or `## 6` — it re-measures them, names
every line that the measurement falsifies, and leaves the original text standing above the correction where a
reader will find both. The method was deliberately narrow: a truth sync that re-reads its own audit and
recovers the same numbers is not a sync, it is a memory test. Each value below was taken from the instrument
that produces it, at the head this branch carries.

### 35.1 The `## 5` delta table: five numbers re-measured, and one subtraction that only existed in prose

| `## 5` row, as written (515–528) | Measured at the Stage 5 head | Instrument |
| --- | --- | --- |
| "30 catalogue columns, up from 29" | **29, up from 28** | `50_pack_release.sql` **A7d** `:3716–3731`, whose two arms are literally `'29'` for `stage5` and `'28'` otherwise |
| `private` "26 functions (was 20)" | **27 (was 18)** | **I4** `:3913–3930`, arms `private: '27'` / `'18'` |
| `internal_api` "19 functions (was 8)" | 19 is right; **was 7** | I4, arms `internal_api: '19'` / `'7'` |
| `api` "8 functions (was 7)" | unchanged, correct | I4, arms `api: '8'` / `'7'` |
| "Total across the three schemas: 53 functions, up from 32" | **54**, up from 32 | I4's title string itself (`'54'` at this head); 8 + 19 + 27 |

The wrong set is internally consistent — 8 + 19 + 26 really is 53 — which is how it survived a table that a
reader would otherwise have added up. It was written at the §16 checkpoint, before the I-group grew its
Stage 5 arms, and no later section re-read it against a run.

§5.1 carries the sixth correction, and the only one no assertion could have caught: "`service_role` holds
EXECUTE on exactly those five functions in `private`, and on none of the other **21**". With 27 functions the
complement is **22**. `stage5/50_review_binding.sql` **M6** (`:1262–1271`) never disagreed with the prose
because it does not count — it aggregates the names `service_role` can actually execute and compares that
array against the five digests. The subtraction was done by a human hand, in a sentence, and it was one out.

### 35.2 The runner-scope question — answered wrong by me first, then measured

**35.2.1 What I asserted, and what the run shows.** §33's review pass left a suspicion on the record that
"`428 + 57` at the Stage 5 head" was unsupported, because the Stage 4 runner's own log printed 426. That
suspicion was wrong and it is withdrawn. `supabase/tests/stage5/run.sh` applies all four stage prefixes
(`:143`), exports `PGOPTIONS="-c app.stage_head=stage5"` (`:57`) so the head-dependent arms of Stage 4's
battery take their Stage 5 branch, and then **re-runs Stage 4's own suites at the new head** (`:150–151`),
with the runner's closing note printing the reason: "Stage 4's totals printed above were measured at the
Stage 5 head. Stage 4's own runner still measures them at the Stage 4 head; neither set is added to the
other" (`s34-sql-stage5.log:82–83`). The log carries `STAGE4 DOCUMENT TESTS PASSED (428)` and `PASSED (57)`
four times — lines 24, 26, 60, 62 — once per suite per chain, with the summary block at 72–81 cross-checking
each against its own PASS-line count. §33.2's row therefore stands as written, and Stage 4's 426 at its own
head (`s34-sql-stage4.log`) is not a contradiction of it but the other half of the same sentence.

**35.2.2 The gap that survived the correction.** `40_catalog.sql` — the battery that pins the privileged
population *by name* — is run only by `supabase/tests/stage2/run.sh`, and that runner's migration loop is
`for stage in stage2 stage3 stage4` (`:149`), with the catalogue suite invoked at `:164`. The Stage 5
migration is never applied to the database it asserts against. Consequences, read from the file rather than
inferred:

* **C26** (`:550–563`) enumerates **nine** `SECURITY DEFINER` functions outside `pg_catalog`: seven
  `internal_api` bodies plus `private.attach_draft_on_wedding_create` and `private.handle_new_user`. At this
  head there are **ten**, and the tenth is `internal_api.preview_invitation_document`. C26 does not fail,
  because it never runs against this schema.
* **C26e** (`:608`) pins "`internal_api` holds exactly the seven implementations" and **C28b** (`:669`) "a
  signed-in caller reaches exactly the seven wrappers and their seven implementations". Both are Stage 4-head
  truths; I4 measures 8/19 at this head.
* What *does* run at this head pins the same population by **count and posture, not identity**: **I3**
  (`:3888–3910`) expects `api_invoker 8 / api_pinned 8 / internal_definer 8 / internal_pinned 19` at
  `stage5` and `7/7/7/7` otherwise, so the definers are exactly the eight bodies with a public twin and the
  eleven maintenance verbs add a workflow and no privilege; **I4** counts the three schemas; **M7**
  (`50_review_binding.sql:1287–1297`) fails if any pack-table trigger became a definer; **M7b** (`:1299–1302`)
  fails if any of the eleven maintenance names is a definer; **M6c** measures the refusal a browser role
  actually receives. A rename of `preview_invitation_document` is caught by I3's name-list arm in Stage 4's
  battery (which *does* enumerate it at `:3878–3885`) and by the HTTP tier; a twelfth definer appearing in
  `internal_api` is caught by I3's count. So the population is guarded. What is not guarded at the head it
  exists at is C26's *named list* — the one instrument whose whole point is that an audit surface can be read
  in one line.
* **Forward repair:** make the catalogue battery head-aware the way I3 and I4 already are (a second expected
  arm keyed on `app.stage_head`, listing ten definers and eight/seven/eighteen/nineteen for the schemas) and
  run `stage2/run.sh` and `stage5/run.sh` on the same head. This is deliberately **not** done in a
  documentation pass: an expected-arm list written without executing it is exactly the artefact that produced
  §35.1's five wrong numbers, and the local stack is down (`s35-stack-down-1.log`), so the repair needs
  Docker, which needs the owner to start it.

### 35.3 Current-state claims §36 found false, and the file each was repaired in

1. **`docs/architecture/domain-model.md`** — three sentences were Stage 4-head facts written as this head's,
   and one was a contradiction inside a single document. (a) §2's closing paragraph claimed that authoring or
   approving a release "is not something this build offers anyone — no `api` wrapper exists, and what the
   local qualification runs use is hand-written SQL". Both halves are now false: eleven `internal_api`
   maintenance verbs and `scripts/tradition-pack-admin.mjs` exist, the qualification fixtures were created
   *through that CLI* (`stage5-ui-journeys.mjs:163`), and the paragraph was rewritten to say what is still
   true — no customer-facing surface, no delete verb, a refusal (exit 2) for any flag that would point the
   tool at a hosted project, and `service_role` unable to reach `internal_api` at all. (b) §5 restated
   Stage 4's `api`/definer counts as current; they are now labelled by head, with this head's measured values
   beside them and §35.2.2 linked as the reason the identity pins lag. (c) §8's deferred-capability table
   listed "Event / venue / family editors | schema only | Stage 5" in a document whose own §12 says those
   editors write `wedding_people`, `venues` and `wedding_events` rows from the workbench. The row now reads
   *built*, because a table that contradicts its own document is the kind of stale claim §36 exists to find.
   (d) §3's CHECK-constraints bullet was quietly counting **88** as though the number described this schema;
   the count comes from `40_catalog.sql` and therefore describes the Stage 4 head, and the file now says so
   in those words and names Stage 5's one added constraint.
2. **`docs/architecture/render-contract.md`** §6 — the pass found a *security* claim that was false in its own
   enumeration. The text said every `dangerouslySetInnerHTML` use in `src/` sits behind the SVG sanitisation
   boundary and cited three sites. Measured: `src/lib/sanitizeSvg.ts:6` (the doc comment, not a use),
   `src/pages/CreateProject.tsx:117` and `src/pages/EditProject.tsx:845` (both genuinely sanitised — `:612`
   computes `artwork` through `sanitizeSvg`, and the earlier citation of `:532` was simply the wrong line), and
   `src/components/ui/chart.tsx:70`, a vendored `shadcn/ui` helper that injects a `<style>` block built from
   its own `ChartConfig`. **It is not the SVG boundary, nothing sanitises it, and no module in `src/` imports
   it** (`grep` for `ui/chart` over `src/`: 0 files), so it is dead scaffolding rather than a live hole. The
   second half of the finding is about the gate, not the file: none of `product:check`'s 27 rules says anything
   about `innerHTML` or sanitisation, so deleting the component would be unchecked and re-adding it would be
   quiet. §36 wrote the fact and the blind spot into §6 and §9.4 and did **not** delete the file or invent a
   rule mid-pass; §32.4 already recorded the same refusal for the same object.
3. **`README.md:193`** — HEAD says the app is "routed with React Router 6". That falsifies §24.5's forward
   claim, which asserted that "no current-state doc (README, `docs/product/**`, `docs/**` outside
   `docs/audits/`) names the router or its version, so there is no stale version claim to correct". There was
   one, in the README's own Architecture paragraph, and §24.5 had simply never grep'd the sentence it was
   reasoning about. The line now reads React Router 7 with the `react-router-dom` compatibility package at
   7.18.4, names the five-stage deferral it closed, and points at §24 for the measurement; the README's
   Product docs index gained the same pointer at `:294`, naming §24 as "the React Router decision" beside the
   Stage 5 audit entry. No ADR records the upgrade — the decision lives in §24 and the README, which is where
   a reader looking for the router finds it. §24.5's text is left as written — the trail it describes is real,
   and the error is this section's to carry.
4. **`supabase/tests/stage4/50_pack_release.sql:3290–3300`** — a test comment asserted that Stage 4's audit
   "states as a disclosed gap" the pre-Stage-4 guest-link behaviour. `grep` for that phrase across
   `stage-4-tradition-pack-foundation.md` returns nothing, so the comment pointed at prose that did not exist.
   It was corrected rather than deleted, because the behaviour it describes is real, and it now points at
   §20.4 of this audit, which carries the consequence a reader needs (a guest link pinned to a pre-Stage-4
   version reaches the *unavailable* state, and whether any such row exists in a deployment is a question this
   repository has never been able to answer).
5. **`docs/product/feature-readiness.md:197`** — the row describing Stage 5's four new rules claimed that
   "both shapes are pinned in the checker's near-miss list (`scripts/check-product-contract.mjs:373`)" of
   `tamil-candidate-status-claim`'s precision: the honest denial *and* a synthetic fixture's own status
   sentence. Measured against the file: the denial is a `MUST_NOT_MATCH` entry at `:373` and is re-asserted as
   a benign line inside `selfTest()`'s cultural near-miss block (now `:605`); the fixture sentence is **not**
   in either list. It stays writable only because the pattern demands the candidate noun — a property the rule
   documents in a code comment (`:319`), which is exactly the kind of claim §35.1 exists to catch. The row's
   first draft of this sentence was written from the rule's own comment rather than from the near-miss list, so
   the doc overstated the gate; the same paragraph then fired `tamil-candidate-status-claim` twice against
   itself, because quoting a forbidden sentence inside the row that describes the rule puts the noun and the
   copula on one line with a 50-character window between them. That failure was repaired in the **prose**, not
   in the rule: the rule was not narrowed, not scoped away and not given an exclusion, per §0's standing
   instruction not to weaken a gate to make a stage pass.

   The gap the false sentence pointed at was then closed in the instrument rather than in prose: the fixture's
   own status line is now a `MUST_NOT_MATCH` entry (`scripts/check-product-contract.mjs:378`,
   `'copy = "release 2 is approved",'`) with the reason written above it, so the noun requirement Stage 5's
   documentation depends on is something a future widening has to break before it can land. This is the only
   **gate input** §36 touched; the rule set, its scopes and its patterns are unchanged, and the entry is
   asserted-only (a phrase that must never match), so it can make the checker stricter and cannot make it
   quieter.

### 35.4 Findings §36 re-confirmed rather than repaired, so that §40 inherits them accurately

* **The duplicated `API35` id.** `supabase/tests/api/stage3_publication.test.mjs:943` (Stage 3's revocation
  case) and `:1152` (Stage 5's maintenance-surface case) both carry the id `API35`. It is disclosed rather
  than renamed in `docs/product/feature-readiness.md:47` and `:151`. The repair, spelled out so it is not a
  note-to-self: give the Stage 5 case the next free id in its own file (`API38`), change the id in the title
  string, in the two prose cross-refs in this audit (`:640`, `:849`) and in `docs/architecture/public-invitation-security.md:191`,
  then re-run the HTTP tier — the tier's count line is derived from the titles, so renaming without re-running
  would leave a doc pointing at an id that no longer exists. That needs the stack, so it is not a documentation
  edit.
* **The `<main>` landmark.** §32.3.2 repaired it in source (`EditProject.tsx:654`, `{/* … */}` comment above
  it, sticky toolbar left outside as page chrome) and §32.9 stated the limit: "the browser reading of the same
  fact belongs to §34". §34's closure (`## 33`) did not deliver that reading — it lists no a11y re-run, the
  Temp artifacts hold `s34-*` logs for SQL/HTTP/build/lint/typecheck/dbtypes/product-check but no a11y run, and
  the three instrument runs that do exist (`s5-a11y-run2/3/4.log`, Oct 2 15:20/16:12/16:19) all predate the
  repair and all print `[editor] … landmarks — {"main":0,"header":1,"nav":0}`. So the claim about this page
  today is exactly what §32.9 said it was: **verified at the DOM level by `editInvitationPage.test.tsx:937–957`
  and not yet re-measured in a browser**, and the `header:1` beside it is still the invitation document's own
  `<header>` (`InvitationRenderer.tsx:387`), not page chrome.
* **Tap targets.** The 18 effective targets under 44 px that §30's run printed stay unrepaired, and the
  escalation in §32.9 stands: 44 px is the AAA-level ask, not this product's adopted rule.
* **Sign-up copy.** Stage 5's new conditional sentence has no browser assertion, and
  `docs/product/feature-readiness.md:102` and `README.md:162` both say so in those words. It stays a §40
  follow-up.
* **This audit's own §0 table** records "Expected `origin/main`" as `b4b2022c5cdb31c5b0256cc28345759761a62937`
  while the same table's HEAD row records `328f0e3fef5a39aa5f91182fb54bf0a97d717e69`. Measured now:
  `git rev-parse origin/main` and `HEAD` are both `328f0e3f…`, and `b4b2022c` ("docs(stage3): synchronize
  feature readiness with closure evidence") is an ancestor of it. The §0 row was carried forward from Stage 4's
  expectation instead of being re-measured under its own "re-measured this session" heading. For §40's field
  *origin/main SHA unchanged*, the true value is `328f0e3fef5a39aa5f91182fb54bf0a97d717e69` — unchanged, and
  identical to the branch's starting SHA.
* **§6's envelope** (`:589–590`) describes `internal_api.preview_invitation_document` as returning
  `{invitation, issues, selected_release}`. The function returns four keys; `authoring` sits between `issues`
  and `selected_release` in the migration's `jsonb_build_object` (`:1502–1506`), and it is the key the editor
  lays its controls out from, so a client read that omitted it would be blind to the rules it is enforcing.
  `## 19` (`:1066`) and `## 21`'s re-read of the HTTP tier (`:1328–1329`) both name that key, which is why this
  is treated as one stale checkpoint line rather than a design disagreement; §6's server-side-parity framing
  above it is otherwise still correct.

### 35.5 What this pass changed that no gate has yet re-verified

The two `docs/product/**` and README edits in §35.3 are inside rule scopes — the two document-facing rules
carry `scope: ["src/", "index.html", "README.md", "docs/product/", "docs/content-review/", "content/"]`
(`scripts/check-product-contract.mjs:326`, `:339`), so a wording slip in the readiness matrix or the README is
a failing gate rather than a review finding. The two `docs/architecture/**` edits are **not**: no rule lists
that prefix, and the checker's own self-test uses `docs/architecture/example.md` as a benign path (`:568`), so
the file that carries §35.3's largest corrections is the one the culture-free scan cannot read. That asymmetry
is a property of the gate, not of these edits, and it is recorded rather than fixed — inventing a rule to
police prose in this pass would be the same unmeasured move §35.1's numbers came from.

The last product-check result on record is §33.2's row — **27 rules over 181 active files, 0 violations**,
whose output line is `s34-productcheck-1.log` ("Product contract OK — 181 active file(s) scanned, 0
violation(s)"; the rule count is `scripts/check-product-contract.mjs`'s own `RULES.length`, and `## 22` at
`:1442` records it moving 23 → 27). That measurement predates these edits, and the re-run §35.5 had queued was
not a formality: the first run after the `docs/product/**` wording changed **failed**, with 2 violations at
`docs/product/feature-readiness.md:197` — §35.3's fifth item, a row that quoted the very sentence its own rule
forbids, on a line long enough for the noun and the copula to fall inside the rule's 50-character window.

Measured after the repairs, in this order, each read in full rather than through a filter:

* `node scripts/check-product-contract.mjs` → `Product contract OK — 181 active file(s) scanned, 0 violation(s)`.
  Same file count, so the scan's population did not move; same rule count, because §36 added no rule.
* `node scripts/check-product-contract.mjs --self-test` → `Product contract self-test OK — 27 rule(s) verified.`,
  exit 0. This is the invocation that reads `MUST_NOT_MATCH`, so it is the evidence for §35.3's new entry. Note
  the split: `npm run product:check`, and the CI step that runs it (`.github/workflows/ci.yml:44`), exercise the
  **scan only** — `--self-test` is a separate argv branch (`:666`) — so a near-miss regression cannot fail
  there. It is caught by the unit tier, which imports and asserts the same function
  (`scripts/product-contract.test.mjs:15`, `expect(selfTest()).toEqual([])`, with the per-phrase scan beside it
  at `:214`), and was verified that way: `npx vitest run scripts/product-contract.test.mjs` → **14 passed
  (14)** in 1 file, 14.40 s.

The SQL and HTTP tiers are not affected by documentation edits or by an assert-only `MUST_NOT_MATCH` entry, and
were not re-run here; nor were the browser tiers. All three remain blocked on the local stack, which this stage
does not start unasked. One non-documentation file did take an edit after its tier's last recorded run:
§35.3 item 4's correction inside `supabase/tests/stage4/50_pack_release.sql`. That hunk sits at `:3290–3300`
(the `git diff -U0` arm `-3245,3 +3290,11`), it is comment-only — filtering that arm for any added or removed
line that is not a `--` line leaves nothing — and it is the only edit that file took after §34's SQL run: the
battery logs are timestamped 2026-10-02 18:12:50 and 18:13:50 (`s34-sql-stage4.log`, `s34-sql-stage5.log`) and
the file's own mtime is 2026-10-03 19:13:34. The file carries 27 hunks against `origin/main` in total; the
other 26 are Stage 5's own work — the `pg_temp.s4_head()` instrument, the head-aware arms it feeds and the new
assertion groups beside them — and were already in the tree §34 qualified at **426 + 57 on each chain at the
Stage 4 head and 428 + 57 at the Stage 5 head**, all passing. The claim §36 makes is therefore the narrow one
that the evidence supports: no assertion, expected value or message string moved after that run, so the SQL
tier's numbers still describe this tree. What would not be supported is a re-run, and this stage does not have
the stack to run one; §40 records the SQL tier as measured-then-comment-corrected, not as freshly green.

The count in that paragraph — "one non-documentation file" — held when §36 wrote it and did not hold by the time
§37 staged. §35.8 lists what else moved, why each of those edits is comment- or prose-only, and which tiers were
re-run afterwards. The SQL file's own status is unchanged by it.

The whole Node tier was re-run at the final tree anyway, because §40's numbers have to describe the tree that
gets staged rather than the tree §33 measured (`s36-gates-1.log`, npm marker `node_modules/.package-lock.json`
present and no `.pnpm` marker, so the tree is still npm's): lint **0 errors / 9 warnings**, typecheck clean,
`dbtypes:check` 19 migration files / 19 + 10 tables / 19 client tables / 29 column groups / **0 findings**,
build **2204 modules, 29 chunks, entry 509.19 kB (154.55 kB gzip), dist 990K**, and the unit tier at its
default worker count **439 of 440**. That one red line is §35.7, and it is the only gate result in this stage
that did not come back green.

### 35.6 What this section does not claim

It does not claim the count corrections were caught by a test. No assertion failed over them, because no
assertion reads another document — which is precisely why §35.1's numbers could be self-consistent and wrong,
and why §35.2.2's repair is an instrument change rather than a sentence.

It also does not claim the whole pass was documentation-only. §35.6 as first written said "not one line of SQL,
TSX or TS changed in this pass, and the only non-prose file it touched is a test *comment*"; that sentence
outlived its own section, because §35.3 item 5 landed afterwards. The accurate statement is: no SQL, no TSX and
no TS changed, and the non-prose files this pass touched are `supabase/tests/stage4/50_pack_release.sql`'s one
corrected **comment** (no assertion, no expected value) and `scripts/check-product-contract.mjs`'s one added
`MUST_NOT_MATCH` **entry**. The second is a gate input, so the claim §36 makes about it is narrow and checkable:
it adds no rule, changes no `scope`, `exclude`, `pattern` or `message`, and can only ever make the checker
refuse more text, never less — which is why it needed the `--self-test` and vitest runs in §35.5 rather than a
sentence of reassurance.

Nothing here says a Tamil release was reviewed, approved or made customer-safe by the truth sync; the
qualification fixtures it names in §35.3 are synthetic `TEST ONLY` rows and remain **qualification data, not
cultural authority**. No merge, no push, no deployment, no hosted Supabase contact, no Stage 6.

### 35.7 The one red line in §35.5's final Node tier, measured four ways

`npm test` at its default worker count reported **439 of 440**, twice, with the same single failure:
`src/test/appRoutingAuthIsolation.test.tsx:98`, Stage 3 §4's assertion that a guest arriving on a shared link
reads the invitation *without asking the device for a session*. `await waitFor(...)` gave up inside its 1000 ms
default — 1290 ms in the first run, 1678 ms in the second — and the DOM it printed was the page's own
`Loading…` branch, not the unavailable or error branch.

That last detail is the whole classification. The test guards a *shape* (no `getSession`, no
`onAuthStateChange`, exactly one `api.resolve_public_invitation` call); a behaviour regression would show as a
wrong branch or a wrong call list, and the four other tests in the file — including a second `waitFor` on the
same route, which passed at 809 ms in the run where the first failed — exercised exactly those. An unfinished
render is a clock that ran out.

Four measurements, then the causal account:

| Run | Workers | That test | Tier result |
| --- | --- | --- | --- |
| the file alone (`s36-unit-isolated-1.log`) | default, 1 file | 413 ms | 5 passed (5) |
| this file plus three of the React-mounting files Stage 5 added (`authoringOutline`, `culturalSafetyDecisionLogic`, `notificationDismissal`; `s36-unit-load-control.log`) | default, 4 files | 847 ms | 36 passed (36) |
| the whole tier, one worker (`s36-unit-sequential-1.log`) | `--maxWorkers=1` | 430 ms (file) | **440 passed (440)**, 30 files |
| the whole tier, twice (`s36-gates-1.log`, `s36-unit-default-2.log`) | default, on a 16-CPU host shared with other sessions | 1290 ms, 1678 ms | 439 of 440, **1 failed** |

The cost scales with how many jsdom suites are resident at once, and the assertion's budget does not scale with
it: 413 ms alone, 847 ms with four files, over 1000 ms with thirty. So the first question — did something in
this tranche change the guest route? — has a clean answer in the negative. `git diff --stat` over
`src/App.tsx`, `src/pages/PublicInvitation.tsx`, the public-invitation transport, and
`src/test/appRoutingAuthIsolation.test.tsx` itself is **empty**: the code and the test are byte-identical to
HEAD. What Stage 5 did change is the tier's footprint — six test files this branch adds
(`authoringOutline`, `culturalSafetyDecisionLogic`, `notificationDismissal`, `notificationBandPlacement`,
`signupNotificationTruth`, `traditionPackAuthoringRules`), five of them mounting React trees, on a host this
audit has already recorded as shared with other sessions' processes. Stage 5 made the suite bigger; the bigger
suite made an existing thin margin run out.

What was **not** done, deliberately: the test was not edited. Raising that `waitFor` timeout, adding
`retry`, or turning a wall-clock budget into a polling one would make the number green by changing the
instrument, which is the move §0 forbids ("do not weaken old tests merely to make Stage 5 pass") and which
would also erase the only signal that this tier is timing-sensitive on this machine. No vitest configuration
was committed either — `--maxWorkers=1` was a one-off CLI flag for the diagnosis, and `vite.config.ts` and the
test setup are untouched, so the CI tier keeps its own worker policy.

For §40 the honest form is both numbers, not the convenient one: **440 assertions, 30 files, all passing when
the tier is not oversubscribed — and on this host, at the default worker count, 439 with this one assertion
timing out on first render.** The forward repair is a decision rather than a discovery: give that assertion an
explicit budget that survives the tier's own size, or move the guest route's first render off the lazy-chunk
cost the test is currently paying for. Both need a re-run of the tier to be worth writing down, which is the
same shape as §35.2.2's catalogue repair — instrument work, deferred with its reason attached, not fixed inside
a truth-sync pass.

### 35.8 §37 pre-commit sweep: six pointers that did not resolve, and what resolved means

Between §36's last gate run and §37's first `git add`, every file path this branch mentions was checked against
the paths that actually exist. The trigger was a reading, not a sweep: item 3 below surfaced while the
`stage3_publication.test.mjs` comment was being read to write its commit message, and a pointer that wrong
deserved a mechanical check rather than more luck. Two passes were then run over the whole vocabulary of paths
this branch uses, each matched against `git ls-files` unioned with a working-tree `find` over `supabase/`,
`scripts/`, `src/` and `docs/`:

- each `+` line of `git diff --unified=0` over the tracked modifications to `supabase/`, `scripts/`, `src/`,
  `docs/` and `README.md` — **109 distinct path-shaped tokens**;
- the same extraction over the **24 files this branch adds**, which no diff of a modification would ever show —
  **141 tokens**. That pass named its own inputs with a glob, and the glob was imperfect: `Authoring*.tsx`
  covered `AuthoringOutline.tsx` and missed `AuthoritativeIssues.tsx`. The re-run after the fixes took its file
  list from `git ls-files --others` instead, and is reported in the last paragraph — a sweep that has a hole in
  it is only as good as the second sweep.

Two passes because a diff never shows a file the index has never seen, and most of Stage 5's batteries are
exactly that.

Six pointers did not resolve, and all six were in prose that asserts nothing — which is the point of looking.
A pointer a reader cannot follow is the same failure as a number nobody re-measured (§35.1), just quieter,
because it never goes red. Two of them (items 3 and 6) were found by reading a file on its way into a commit;
the sweeps below exist because item 3 proved that reading catches what luckier reading catches later. Item 6 is
recorded separately because it marks the sweep's own reach: the extraction's vocabulary was file paths, so a
wrong locator *inside* a correct file path is outside it:

1. `supabase/tests/stage5/run.sh:28-29` described the Stage 5 battery as `70_issue_engine.sql`,
   `80_review_hash.sql` and `90_maintenance_surface.sql`. No such files exist, at this head or anywhere. The
   runner's own `for f in $(ls supabase/tests/stage5/*.sql …)` two lines below was always right — it executes
   what is there — and it is the comment that was wrong. Now names `50_review_binding.sql`,
   `60_definition_vocabulary.sql` and `70_document_resolution.sql`.
2. The same comment, `:25`, told a reader to "see `pg_temp.s5_head()` in `50_pack_release.sql`". Neither half
   lines up: the instrument Stage 4's battery reads is `pg_temp.s4_head()`, defined in
   `supabase/tests/stage4/50_pack_release.sql`, while `pg_temp.s5_head()` is a different function in
   `supabase/tests/stage5/50_review_binding.sql:130`. Corrected to `s4_head()`, with the file's directory
   spelled out and the `PGOPTIONS` line at `run.sh:57` named as what feeds it.
3. `supabase/tests/api/stage3_publication.test.mjs:1034` pointed the preview/freeze parity claim at
   `stage5_review_surface.test.mjs`, a file that was never written under that name. Parity is qualified in
   `stage5_pack_driven_http.test.mjs` (`:1189`, the preview keeps moving while a published guest document does
   not) and at the SQL head in `supabase/tests/stage5/70_document_resolution.sql` (group C, from `:1342`). Both
   are cited now.
4. `scripts/check-product-contract.mjs:234` cited `src/test/culturalSafetyDecisionLogic.test.ts`. The file is
   `.test.tsx`, so the name as written matched nothing.
5. This audit's §22.2 at `:1472` said six rules fire "against their real derivation shape at
   `src/pages/Editor.tsx`", which reads as a file in this repository. There is no such file. `src/pages/Editor.tsx`
   is the *scan-location argument* at `scripts/product-contract.test.mjs:142` — a stand-in path, needed because
   these rules are scoped by path and a `docs/` label would let a widened rule pass. The lines themselves are
   real derivation shapes; the path is not a place. Reworded to say exactly that.
6. `supabase/tests/api/stage4_tradition_packs.test.mjs:627` cited the narrow release-block assertion as
   "`supabase/tests/stage5/70_document_resolution.sql` group D". The file resolved, and group D exists — at
   `:1217`, where it is "the recursive walk over what the browser is handed", a different claim about a
   different surface. The release block is asserted by group P ("preview and freeze, one document", from
   `:1013`): P2 at `:1037` fixes the envelope to exactly four things, P3 at `:1085` is the narrow
   `selected_release` object the comment describes. Corrected to "group P, at `:1037` and `:1085`". The two
   locators that were already right are left alone: §3.5 of this audit, which the same comment cites, and the
   eight-name callable list it annotates.

The rest of the unresolvable names were checked and are deliberate, and are recorded here so the next sweep does
not "fix" them: `src/components/Thing.tsx`, `src/pages/Clean.tsx`, `src/fixture.tsx`,
`docs/architecture/example.md`, `0001.sql`, `0001_guard.sql`, `0002_def.sql` are in-memory fixtures fed to
`scanContent` / `extractGuardVocabulary` inside the two checkers' own self-tests, where the path is the thing
being tested and no file is implied; `SECURITY.md` is upstream React Router's, read out of its repository at
§24.1 and never vendored; `../tools/installer-markers.sh` lives one directory above the repository and exists
there (verified by listing, not by memory); `-r1.md` is the tail of a generated name, `` `${PACK_KEY}-r1.md` ``
at `supabase/tests/api/stage5_admin_cli.test.mjs:610`, which the extraction splits at the `$`; and
`scripts/scratch-s31-probe.mjs` and `$TEMP/s32-probe.mjs` are named as **deleted** by exact path at §30.11 and
§31.7, and both were re-confirmed absent rather than trusted.

What was re-run after these six edits, because two of them touch gate inputs: `bash -n` on the Stage 5 runner
(syntax OK); `node scripts/check-product-contract.mjs --self-test` → **27 rule(s) verified**; `npm run
product:check` → **181 active file(s) scanned, 0 violation(s)**; `npx vitest run scripts/product-contract.test.mjs`
→ **14 passed (14)**; `npm run lint` → **0 errors, 9 warnings**; `npm run typecheck` → clean. The SQL and HTTP
tiers were not re-run — the stack is down and this stage does not start it unasked — and none of the six edits
reaches one: five are comments in files the batteries never parse for behaviour (two runners' prose, two tests'
prose, one checker's prose) and the sixth is in this audit. `git diff` at the commit boundary is the check that
says so; §35.6's claim about the shape of this pass is superseded by this section's list. The scan, lint and
typecheck were run again after item 6, since it moved after them; the counts are the same, and the re-run —
including the tree substitution it ran into and the versions it was measured on — is §35.9.

The re-sweep after the five path repairs (item 6 was not in its reach, being a locator inside a path it
resolved) covered every file this branch adds except the audit — the audit now quotes the wrong names on
purpose, being where the correction is written down — and resolved **45 tokens**, of which everything except
the fixtures and generated names above was found to exist; the one dependency path it could not resolve against
`git ls-files` was `node_modules/@radix-ui/react-toast/dist/index.mjs:116-120`, cited by
`scripts/stage5-a11y-mobile.mjs:590` for the pause/behaviour the probe depends on. Node modules are not
tracked, so that citation was read instead of assumed: lines 117-120 of that file are the four
`wrapper.addEventListener` calls (`focusin`→pause, `focusout`→resume, `pointermove`→pause,
`pointerleave`→resume) that make a fixed sleep report a correctly-held card as still covered. It is pinned by
`package-lock.json`, and it is the one pointer in this tranche that a dependency bump can silently stale.

### 35.9 The dependency tree was substituted again, partway through §37

At 21:48:42 IST, while the first §37 commits were being written, `node_modules/.pnpm` and
`node_modules/.modules.yaml` appeared in this project's `node_modules` with fresh mtimes, having not existed on
the tree §34 installed. The npm marker `node_modules/.package-lock.json` kept its §34 mtime of 2026-10-02
17:53:20 throughout, so this was an installer writing on top of an existing tree rather than a clean install.
This is the third recurrence of the event §32.7 of the Stage 4 audit named, and it was observed four times in
nine minutes — mtimes at 21:48:42, 21:50:27, 21:52:13 and 21:56:53 — so it is not one install finishing.

What it changed was measured, not assumed, at 21:57. The top level holds **355 entries, 34 of them symlinks**
(the pnpm layout), and `node_modules/.pnpm` holds 467 directory entries. Three installed versions disagree with
`package-lock.json`:

| package | `package-lock.json` | installed after the substitution |
| --- | --- | --- |
| `typescript` | 5.8.3 | **5.9.3** |
| `eslint` | 9.32.0 | **9.39.5** |
| `@types/react` | 18.3.23 | **18.3.31** |
| `vitest`, `react`, `react-router-dom` | 3.2.7 / 18.3.1 / 7.18.4 | unchanged |

Two consequences are recorded rather than glossed. First, the counts in §35.8's re-run paragraph were taken in
the window 21:44–21:48, whose installer state can no longer be established, so they were re-measured in
isolation after the substitution was visible, each with its output captured to a file and read in full:
`npm run lint` → **exit 0, 0 errors, 9 warnings**, in the same nine files §34 listed (`s37-lint-1.log`);
`npm run typecheck` → **exit 0, clean**, on typescript 5.9.3 (`s37-typecheck-1.log`);
`node scripts/check-product-contract.mjs` → **181 active file(s) scanned, 0 violation(s)**, and the same with
`--self-test` → **27 rule(s) verified**, which need no dependency at all because the checker reads only source
and Node builtins (Node v24.21.0). So the two toolchain-sensitive gates hold under both the locked and the
substituted versions — which is a stronger statement than §35.8 could make, and it is the reason both numbers
are printed instead of one.

Second, a single combined invocation of the two gates returned exit code **1073807364** from `npm run lint`
while still printing the report line — a code no Node tool produces. It did not reproduce when each gate was
run alone with its output captured to a file and read in full, so it is classified as an artifact of the
contended host (the same class as the `0xC0000142` process launches this branch has recorded before), not as a
product finding, and it is not counted as a failed gate. The rule it is an instance of is the one §34 already
states: an exit code from a piped or compound command is not evidence; the log and the adjacent `$?` are.

Nothing in these commits depends on `node_modules`, so §37's staging was not paused for the substitution. The
bundle-size and build numbers stay where §34 measured them, on the npm tree, and are not re-claimed here. The
root's untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` were left exactly as found: §39's cleanup is scoped
to paths this task created, and the standing instruction is "Do not touch pnpm files." Restoring the locked
tree means `npm ci`, which deletes `node_modules` while another process is writing into it, so it is not
attempted unasked; it is listed for the user's decision before any further browser, HTTP or SQL tier is
measured on this host.

---

## 36. §37–§40 closure: the push, the cleanup inventory, and the truth defect the report assembly found (appended, not a rewrite)

### 36.1 What §37 committed, and what it never staged

Twelve commits sit between `origin/main` and this branch's head: `git rev-list --count origin/main..HEAD` →
**12**, with `git merge-base origin/main HEAD` → `328f0e3fef5a39aa5f91182fb54bf0a97d717e69`, i.e. the branch
starts where §0 measured it starting. Ten are Stage 5's implementation, dated 2026-10-03:

| SHA | Subject |
| --- | --- |
| `801e693` | feat(supabase): make a review bind to the bytes it reviewed |
| `5c137ec` | feat(pack-admin): give release maintenance an operator path that cannot invent a review |
| `e6924d6` | fix(deps): close the five-stage router deferral by moving to React Router 7 |
| `3a23b12` | docs(supabase): point the Stage 5 runner at instruments that exist |
| `c134e29` | test(api): qualify the pack-driven document and maintenance surface over PostgREST |
| `228e1a1` | fix(ui): put the notification where the header is not, and say what signup did |
| `4135c26` | feat(editor): build the authoring surface from the server's resolved document |
| `cb15e25` | test(unit): cover the resolved document, the outline it drives, and the rules that bind it |
| `ca1e253` | test(contracts): add the cultural-safety rules, and stop the DB checker certifying the past |
| `0cffc2e` | test(browser): drive the four journeys, the sweep, the a11y pass and the network classification against a production build |

Two are the truth sync, dated 2026-10-05: `93c8329` "docs: state what Stage 5 built without claiming what it did
not" and `37df916` "docs(audit): record Stage 5 as measured, including the measurements that moved". Every one
was staged by explicit path with `git diff --cached --stat` read before the commit; `git add .` and `git add -A`
were never invoked. The evidence that the rule held is this window's own `git status --short`: the two pnpm
files are the only untracked entries besides the ignored logs, and they are still untracked.

### 36.2 §38's push, and the two ways it was verified

The push named a full refspec — this branch on the left, this branch's `refs/heads/…` path on the right — and
created the branch on the remote; `-u` was not used, because §0 recorded the branch's upstream as
`origin/main` and setting a new upstream would have made a later bare `git push` able to reach main. Two
independent reads:

* `git reflog show refs/remotes/origin/stage5/pack-driven-authoring-review` → one entry,
  `37df916 … @{2026-10-05 08:49:16 +0530}: update by push`.
* `git ls-remote origin`, read in full this window:
  `refs/heads/stage5/pack-driven-authoring-review` = **`37df916b0f8262d370d0ee11085b098cea415b4a`** (equal to local HEAD),
  and `refs/heads/main` = **`328f0e3fef5a39aa5f91182fb54bf0a97d717e69`** — the same SHA as `origin/HEAD` and as
  `refs/heads/stage4/tradition-pack-foundation`, so main has not moved since Stage 4's closure and this stage
  never touched it. The three earlier stage branches (`stage1` `e93912d`, `stage2` `a51856f`, `stage3` `b4b2022`)
  are also unchanged.

### 36.3 §39's inventory: what was measured, what was kept, and why nothing was deleted

§39's mandate is to delete token-bearing scratch files **by exact path**, which requires a scan rather than an
assumption. Root-level logs now number **26** (22 `s37-*`/`s39-*`/`s40-*`/`s41-*` gate captures and 4
`stage5-*.scratch.log` battery captures), all listed by `git status --short --ignored=matching` as `!!` and all
ignored by `.gitignore:3`'s `*.log`. Every one was scanned for nine classes: `service_role`, a JWT-shaped
`eyJ…` run of ≥ 10 characters, `sb_secret|sb_pat|github_pat_|ghp_…`, any
`SUPABASE_(PUBLISHABLE|ANON|SERVICE|URL|PROJECT)…` assignment carrying a value, `eyJhbGciOi`, a
`BEGIN … PRIVATE KEY` block, and the words `password` and `secret`. The result is **four hits, all in two files,
all inside a test's own name**: `stage5-official-run1.scratch.log` and `run2` at `:56`
("API30 republishing mints a different secret instead of waking the revoked one") and `:141`
("no answer the API gives a customer contains key material or the run password") — the second being the leak
assertion succeeding, printed as its passing name. No log matches any credential-shaped pattern. **Nothing was
deleted**, because on the measured evidence there is no token-bearing scratch file to delete; the logs stay as
the citations §34–§36 point at.

Two env files were inventoried rather than assumed. `.env` holds 3 keys
(`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`) and mtime
2026-09-24 21:30:19; `.env.local` holds 7, including `SUPABASE_LOCAL_SERVICE_ROLE_KEY` and
`SUPABASE_LOCAL_DB_URL`, and mtime 2026-09-26 09:52:47. Both predate Stage 5, both are git-ignored and neither
is in any tree, and both are read by instruments this stage wrote (`supabase/tests/api/run.sh`, the
`stage5_*.test.mjs` battery, `scripts/stage5-ui-journeys.mjs`, and README's setup section). They are local-stack
configuration, not this task's scratch, so §39 leaves them and names their class here — the privileged values in
`.env.local` are the local stack's own, issued by `supabase start` on this machine.

`pnpm-lock.yaml` and `pnpm-workspace.yaml`: untouched, untracked, unstaged, exactly as §35.9 left them.
`artifacts/stage4-render` (5 entries, directory mtime 2026-09-28 21:18) is Stage 4's evidence and was not this
task's to remove. `dist/`, `node_modules/`, `supabase/.branches/` and `supabase/.temp/` are tool-owned and left.

Servers: `netstat -ano -p TCP` lists **39** listeners, and **none** of them is on 3000, 4173, 5173 or 8000 — so
no dev server, no `vite preview` and no ad-hoc static server was left behind by the browser tiers. The only
listeners in this project's port range are 54400, 54401 and 54403, which `supabase/config.toml:24`, `:37` and
`:61` assign to kong, db and inbucket; `docker port supabase_kong_localvivaahvarnam` confirms
`8000/tcp -> 0.0.0.0:54400`. The stack itself was found running (containers created 2026-10-02 by §34, started
2026-10-05T03:05:55Z by a process this task did not run), the user chose **"Leave it running"**, and its state was
then read only. A row count over every table `pg_tables` lists under `public` — **19** tables, one query per
table, no write — returns **0** for all of them except two: `tradition_packs` **11** and
`tradition_pack_releases` **17**. That includes `weddings`, `invitation_drafts`, `invitation_versions`,
`publications`, `guest_households`, `rsvp_responses`, `venues`, `wedding_people`, `wedding_events`,
`wedding_assets`, `profiles`, `user_roles`, `entitlements`, `approval_requests`, `approval_feedback`,
`household_event_scopes` and `design_templates`. The 11 pack keys are all qualification names —
`stage4_http_*`, `stage5_http_*`, `stage5_cli_*`, `stage5_retire_*` — and no cultural pack name is among them, so
the real Tamil candidate is not a row in this database at all. Across the 17 releases: `status` counts
7 approved / 6 deprecated / 2 draft / 2 reviewed, `machine_assisted` is true on **all 17**, `reviewed_by` is NULL
on **all 17** (no row is attributed to a user account — and note that Stage 4's
`review_metadata_is_mandatory` CHECK at `20260927120000_stage4_tradition_pack_releases.sql:158` does not require
that column, which is why a NULL there is a measurement rather than a proof), and `approved_at` is non-null on
exactly the 13 rows whose status makes it mandatory per `:166`. These are the synthetic approvals the HTTP and CLI
tiers minted through the maintenance verbs; they are qualification data, and §34.6's four flags on the real
candidate are unchanged because no step after it wrote to that row. `docker ps` this window printed exactly five
containers, every one named `*_localvivaahvarnam`; no DueWeave container appears in that output at all, which is a
stronger statement than "untouched by this stage".

### 36.4 The finding §40's assembly produced, its repair, and the gate that caught the repair being incomplete

The directive asks the final report field by field, and filling in the ACCESSIBILITY RESULT field meant reading
the readiness row against the source rather than trusting the row. It did not match. `docs/product/feature-readiness.md:171`
still stated, as a live limitation, that "**the page a host actually works on has no `main` landmark**",
citing `EditProject.tsx`'s success branch opening a `<div>` at `:625`. The branch has rendered `<main>` since
Stage 5's own one-element repair at `src/pages/EditProject.tsx:654`, committed in `4135c26`. §36's truth sync
passed over that row because the sentence is true-looking, internally consistent, and names real line numbers —
for its other two branches, which are still `<main>` at `:584` and `:598`.

What is actually missing is not the element but a measurement. The three instrument runs that printed
`{"main":0,"header":1,"nav":0}` all predate the repair; `scripts/stage5-a11y-mobile.mjs:232-233` and `:697`
report the landmark count as a *measurement* and assert nothing on it; the only current-state evidence is
`src/test/editInvitationPage.test.tsx:938`, a jsdom assertion that the loaded workbench names its content region
as the page's main landmark (it passed in §36.5's run). The `header:1` beside it is the invitation document's own
`<header>` (`src/components/invitation/InvitationRenderer.tsx:387`), not page chrome. So the row was rewritten to
say exactly that — measured from source and pinned by a unit test, **not re-read in a browser since the repair** —
and the honest sentence replaces the false one rather than the claim being deleted.

A second instrument change follows the directive's rule that a real issue gets a fix *and* a regression test at
the level the defect lives at. The level here is documentation truth, so the checker gained rule
**`main-landmark-absence-claim`** (`scripts/check-product-contract.mjs`, the 28th), pattern
`/\b(?:has no|does not have|lacks|had no)\s+(?:`main`|main)\s+landmark\b/gi`, scoped to the document prefixes the
other doc-facing rules use. It is deliberately narrow — an absence verb directly on the landmark — because the
replacement sentence is about the same element and must not fire; that near-miss is pinned as a `MUST_NOT_MATCH`
entry, and the old false sentence is pinned as the rule's positive-control fixture. The derived counts moved
with it: README's rule list 27 → **28** ("Three of the five" Stage 5 rules, since this one guards documentation
rather than culture) and `docs/product/content-governance.md`'s history row and blind-spot sentence to match.
Writing that README sentence produced the first near-miss by hand: the draft said the rule refuses text claiming
a page "lacks a `main` landmark", which the new pattern matches, so the wording was changed before the checker
ran. Note the asymmetry this section is exposed to as well: `docs/audits/**` is outside `isScannedPath`, so this
file can quote the forbidden sentence freely, which is why the quote above is safe to leave in an audit and was
not safe to leave in a product document.

Then the unit tier failed, and it failed **for a different reason than the one §35.7 recorded**. The checker's
own inventory test (`scripts/product-contract.test.mjs:18-51`) scans a fixture corpus and asserts that the set of
rule ids it detects equals `RULES`' full id list — so adding a rule without adding a line that fires it is a gate
failure by design. `s40-unit-1.log` printed exactly that: **439 of 440 in 30 files**, one failure,
`expected [ 'ad-hoc-supabase-client', …(26) ] to deeply equal [ 'ad-hoc-supabase-client', …(27) ]` at
`scripts/product-contract.test.mjs:51:62`, with the diff naming `main-landmark-absence-claim`. That is a real,
reproducible, deterministic failure caused by this tranche's incomplete instrument change — not host contention,
and the contrast is measured rather than asserted: `appRoutingAuthIsolation.test.tsx`, §35.7's timing-sensitive
assertion, passed in the same run.

The repair went the only honest way: a fixture line was **added** to the corpus so rule 28 must fire, the
equality was left exactly as strict as it was, and no `scope`, `exclude`, `pattern` or `message` was relaxed
anywhere. The rule can refuse more text than §35.9's checker could, and never less. Re-run in isolation first —
`npx vitest run scripts/product-contract.test.mjs` → **14 passed (14)** (`s40-unit-pc-1.log`) — then as a tier.

### 36.5 The Node tier at the repaired tree

Each command captured to its own file, read in full, with the exit code taken from an adjacent `$?` written into
the same log rather than from a pipeline. These runs are on the **content** of §36.4's five files as they will be
committed, taken before the two closure commits existed; §40 carries the confirmation run at the final SHA, so no
number below is claimed to be post-commit.

| Gate | Command | Result | Log |
| --- | --- | --- | --- |
| product contract scan | `node scripts/check-product-contract.mjs` | `181 active file(s) scanned, 0 violation(s)`, exit 0 | `s41-productcheck-1.log` |
| product contract self-test | `… --self-test` | `28 rule(s) verified`, exit 0 | `s41-selftest-1.log` |
| lint | `npm run lint` | exit 0, **0 errors / 9 warnings**, same nine files as §34 | `s41-lint-1.log` |
| typecheck | `npm run typecheck` | exit 0, no diagnostics | `s41-typecheck-1.log` |
| unit | `npx vitest run --maxWorkers=1` | **440 passed (440)** in **30 files**, 84.50 s, `unit_exit=0` | `s41-unit-1.log` |
| db contract | `npm run dbtypes:check` | `Database contract OK — 19 migration file(s)`, schema 19 public + 10 non-client tables, client types 19 tables, 29 query column groups reconciled, **0 findings** (the report line is the success marker; no exit code was appended to this log) | `s40-dbtypes-1.log` |
| build | `npm run build` | `✓ 2212 modules transformed`, **29** `assets/*.js` chunks, entry `index-D4iQch0t.js` 577.43 kB (172.27 kB gzip), `✓ built in 40.80s`, plus vite's own >500 kB chunk warning | `s40-build-1.log` |

Same 181 files scanned as §35.9, so the repair added a rule without changing the scan's population. In §36.5's
unit run `editInvitationPage.test.tsx` took 4110 ms for its 34 tests and `appRoutingAuthIsolation.test.tsx`
824 ms for 5 — the second is a data point for §35.7: the assertion that timed out twice at the default worker
count passed comfortably here, and the tier's worker policy is still uncommitted, so the margin remains a live
product-instrument limitation rather than a fixed one.

### 36.6 The one number this section cannot attribute, and what attributing it costs

Two build measurements now stand on record for the same source tree: §34's on a locked npm tree — **2204 modules,
29 chunks, entry `index-BWDFhgPY.js` 509.19 kB / 154.55 kB gzip, `dist` 990K** — and §36.5's on the substituted
tree — **2212 modules, entry `index-D4iQch0t.js` 577.43 kB / 172.27 kB gzip**. The delta is +68.24 kB raw /
+17.72 kB gzipped, and it is not yet attributed to anything in this branch's source: markers read again this
window show `node_modules/.package-lock.json` at its §34 mtime 2026-10-02 17:53:20 sitting alongside
`node_modules/.pnpm` (467 directories) and `node_modules/.modules.yaml` at 2026-10-05 08:49:13, with
`node_modules/vite` a symlink — a pnpm-shaped tree written on top of the npm one, which is §35.9's recurrence,
still present. Every browser tier in this stage qualified the **locked-tree** bundle. Deciding which number the
report should carry requires `npm ci`, and `npm ci` deletes `node_modules` while another process is writing into
it on this host; it is therefore listed for the reviewer's decision and §40 prints both numbers without choosing.

### 36.7 What this section does not claim

It does not claim the last two commits re-qualified any tier that their inputs could affect. Their inputs are
`README.md`, two files under `docs/product/**`, the checker, the checker's unit test, and this file — so the
tiers that read them (product contract scan, self-test, unit) re-ran in §36.5, and the tiers that do not (SQL
battery, HTTP battery, browser journeys, render sweep, a11y and network runs) were not re-run. No `src/` path and
no `supabase/migrations/**` path is in the diff, which is why their numbers still describe this tree; what those
tiers carry forward, unaltered, is §35.5's "measured-then-comment-corrected" status for the SQL battery and §35.4's
two open browser items — the post-repair `<main>` re-read and the sign-up-copy assertion — plus §35.4's duplicated
`API35` test id, which needs a stack run to rename safely.

It does not claim the substituted-tree build is the bundle the stage qualified; §36.6 says explicitly that it is
not, and that the qualified bundle is §34's. It does not claim the running stack's 11 packs or 17 releases are
anything other than synthetic qualification data: the Tamil candidate's four flags were last measured in §34.6
and no step after it wrote to that row. And nothing here merges, deploys, contacts hosted Supabase, approves a
Tamil release, or starts Stage 6. `git ls-remote` in §36.2 is the evidence that main did not move.

## 37. Closure pass: the 44 px floor becomes an assertion, three instruments stop requiring a hosted
### credential, and every browser tier is re-qualified on a tree whose installer is proved before it runs

§36's own commit is `c6cf0c7`. Everything written after it is recorded in this section — ten commits, their
measurements, the two instrument defects they exposed, and the third, fourth and fifth times the host's
`node_modules` was replaced under this branch while a gate was reading it. Nothing above this line is edited.

### 37.0 Starting state, re-measured rather than carried forward

| Fact | Measured value at this window | How to re-measure |
| --- | --- | --- |
| Branch HEAD at the window's first commit | `1594bcc` (parent `c6cf0c7`, §36's commit) | `git log --format='%h %s' c6cf0c7..HEAD` |
| Branch HEAD at the window's last code commit | `be1ae37`, pushed | `git ls-remote origin refs/heads/stage5/pack-driven-authoring-review` |
| `origin/main` | `328f0e3fef5a39aa5f91182fb54bf0a97d717e69` — and it **is an ancestor** of the branch | `git fetch origin refs/heads/main:refs/remotes/origin/main && git merge-base --is-ancestor origin/main HEAD && echo yes` |
| Commits the branch holds over `origin/main` | 24 | `git rev-list --count origin/main..HEAD` |
| Local stack | `localvivaahvarnam`, kong `:54400` (REST answers 200), db `:54401`, inbucket `:54403` — **not** 54321 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54400/rest/v1/` |
| Preview | `vite preview --host 127.0.0.1 --port 4173 --strictPort`, serving `dist/assets/index-CNMnmIrw.js` | `netstat -ano \| grep 4173` |
| Shipped entry chunk | `index-CNMnmIrw.js`, **509226 bytes**, `509.23 kB │ gzip: 154.57 kB`, `✓ 2204 modules transformed` | `ls -l dist/assets/index-*.js` and `npm run build` |

Two things in §0 are now superseded by measurement, and §0's text is left exactly as written. First, §0 expected
`origin/main` at `b4b2022c…`; main has since moved to `328f0e3f` (Stage 4's closure) and this branch contains it,
so "main untouched" now means *this pass wrote nothing to it*, which §37.10's read-back evidences. Second, §0A
described `pnpm-lock.yaml` and `pnpm-workspace.yaml` as "deliberately left in place and never staged"; that
practice has been replaced by **quarantine** — the files are moved out of the repository into
`../q5-logs/pnpm-contamination-<n>-<timestamp>/` with their SHA-256 recorded in a `PROVENANCE.txt`, never
deleted and never staged, because §37.7 shows the same two files reappearing three times in one window and a
silent `git status` check cannot tell a stale pair from one written mid-run.

### 37.1 The ten commits this section exists to describe

| SHA | Subject | What it changed |
| --- | --- | --- |
| `1594bcc` | test(api): give Stage 5 maintenance boundary a unique API id | one line of `supabase/tests/api/stage3_publication.test.mjs` — §37.8 evidences that the 38 ids are now distinct |
| `4fb6990` | test(browser): assert truthful signup notification | +8 in `scripts/stage5-ui-journeys.mjs`: the prelude reads the rendered sentence per host (§37.9) |
| `f62b190` | test(a11y): assert editor main landmark in browser | +3 in `scripts/stage5-a11y-mobile.mjs`, now at `:979-981`: `snap.landmarks.main === 1` (§37.9) |
| `5889218` | test(config): make the qualified worker limit the default | +4 in `vitest.config.ts`: `maxWorkers: 1` moves from a CLI flag into the committed config |
| `60cb331` | fix(deps): keep the Tailwind build plugin out of the production graph | `tailwindcss-animate` leaves `dependencies` (`package.json` +1/−1, `package-lock.json` +117) |
| `6a67157` | fix(contract): make a new HTML injection sink fail the build | rule `markup-injection-sink` in `scripts/check-product-contract.mjs` (+151), its self-test fixture (`scripts/product-contract.test.mjs`, +2), and the **three** docs it made honest (`README.md`, `docs/product/content-governance.md`, `docs/product/feature-readiness.md`) — 5 files, 185 insertions, 23 deletions |
| `344c3b1` | fix(editor): raise every host control to the product's own 44px target | 5 files, +40/−35: `EditProject.tsx`, `ContentEditor.tsx`, `PublicationPanel.tsx`, `TraditionPackPanel.tsx`, `ui/toast.tsx` (§37.2) |
| `f494f76` | test(a11y): assert the 44px target floor… | `scripts/stage5-a11y-mobile.mjs` +42/−4: the assertion at `:700` and the at-rest overlay read (§37.2, §37.4) |
| `0216cae` | fix(browser): stop three instruments dying on a missing .env… | the three browser instruments, +52/−5 (§37.5) |
| `be1ae37` | fix(browser): make the hosted-bundle refusal pattern-shaped… | `scripts/stage5-network-privacy.mjs` +18/−2 (§37.6) |

Every one reached the remote through a push that named an explicit refspec and never `-u`. The read-back taken
after the last of them, at 14:03 local:

```
$ git push origin refs/heads/stage5/pack-driven-authoring-review:refs/heads/stage5/pack-driven-authoring-review
   0216cae..be1ae37  stage5/pack-driven-authoring-review -> stage5/pack-driven-authoring-review
$ git ls-remote origin refs/heads/stage5/pack-driven-authoring-review refs/heads/main
328f0e3fef5a39aa5f91182fb54bf0a97d717e69        refs/heads/main
be1ae3751872f9addcb85d1c9a0a05ee21316ae2        refs/heads/stage5/pack-driven-authoring-review
$ git rev-parse HEAD
be1ae3751872f9addcb85d1c9a0a05ee21316ae2
```

Remote branch equals local HEAD, `refs/heads/main` equals the value §37.0 measured and was not written by this
pass, and the refspec line shows a fast-forward (`0216cae..be1ae37`) rather than a forced update.

### 37.2 The 19 sub-44 px targets were closed in the product, and the instrument got stricter first

`docs/product/design-principles.md:97` has carried `| Touch target | ≥44×44px, ≥8px apart |` as this product's own
acceptance target since Stage 1, yet the workbench shipped controls at 32–40 px and §30.10 recorded the shortfall
as a measurement with the words "44 px is the AAA ask, not this product's rule" — a claim that contradicted the
repo's own stated rule. The correction went in this order, deliberately:

1. **`g8-a11y-baseline.log`** — `==> checks 61, measurements 49, findings 0`, `PASS`. Still passing, because the
   shortfall was only printed. It lists **19** enabled controls under 44 CSS px at 375×740 (18 at 768×1024): the
   band's `Dismiss this notificat… 24x24`, `Back to invitation dra… 40x40`, `Save Draft 124x36`, `Add a person
   101x32`, `Add a venue 96x32`, `Add a ceremony 119x32`, the `Font` disclosure `342x36`, `Font size (px)`
   `342x36`, six `h-9 w-9` swatches at `36x36`/`40x40`, `Custom colour 342x36`, the three alignment buttons
   `111x34`, and `Freeze this draft as a… 215x36`. §30.10 recorded **18** at phone width from the earlier,
   59-check capture; `g8`'s list has one more member than that count, and it is the band's own dismiss control —
   which is why this section says 19 and why the readiness row's "18" is corrected rather than contradicted.
2. **`f494f76` made it a check** (`scripts/stage5-a11y-mobile.mjs:700`), scoped to the host workbench: the
   sweep-wide `MIN_TARGET_PX = 24` at `:89` stays, because the auth screens and the guest document are not the
   workbench and this pass measured no under-44 control there.
3. **`g10`–`g13`** then show the check biting before it passes: `60/48/1 exit 1` (a band-coverage false positive,
   §37.4), `63/52/1 exit 1` (the real defect, §37.3), then `g13-a11y-shrink.log` — **`checks 63, measurements 52,
   findings 0`, `STAGE 5 §31 ACCESSIBILITY / MOBILE: PASS`** — printing at both viewports
   `ok … no enabled control in the host workbench is smaller than 44x44 CSS px — 32 enabled control(s) tested, all
   at least 44x44` (phone) and `31 enabled control(s) tested, all at least 44x44` (tablet), and independently
   `no enabled control is smaller than 24x24 CSS px — smallest effective target is 44x44`.
   **The instrument measured the effective press rect, so the fix had to grow the element**; adding padding to a
   label would have shown up as a pass without anything changing under the finger.
4. `344c3b1` grew them: `h-8`/`h-9` → `h-11` on the add/cancel/save buttons, row inputs, native selects, the
   share-link anchor and the pack retry; `size="icon"` anchors to `h-11 w-11`; the colour swatch became a 44×44
   button with the painted `h-8 w-8` chip inside it (`scale-110` keeps the visual size); the alignment trio to
   `flex h-11 flex-1`; and the band's `ToastClose` to `flex h-11 w-11` with the card's right gutter widened
   `pr-8` → `pr-14` so the larger box lands in reserved space rather than over the message. Shared
   `src/components/ui/*` defaults (`button.tsx` `default h-10`, `sm h-9`, `icon h-10 w-10`; `input.tsx` `h-10`)
   are **unchanged** — public and marketing screens still inherit 40 px until something reviews them.
5. What the pass cost in the other direction is recorded too: the card's text column is now 24 CSS px narrower on
   a phone, and no screenshot of the raised band is carried by this branch.

`g14-node-post-shrink.log` re-ran the Node tiers on that tree: typecheck `code=0`; lint `code=0` with
**0 errors / 9 warnings** (the same nine files as §34); `product:check` → `179 active file(s) scanned, 0
violation(s)`; unit → **`Test Files 30 passed (30)`, `Tests 440 passed (440)`**, `code=0`.

### 37.3 A real product defect, found by the assertion this section added

Between the sizing commit and the green run, `g12-a11y-settled.log` printed
`FAIL [editor] editor @ 375x740 phone: no enabled control in the host workbench is smaller than 44x44 CSS px —
a.inline-flex.items-center "Back to invitation dra" **43x44**`. The anchor declared `h-11 w-11` and got 43 px wide,
because it sits in a `flex items-center gap-3 min-w-0` row and flex-shrink squeezed it at phone width — the tablet
reading was 44×44, which is why the same control passed at 768 px and failed at 375 px. Root cause was confirmed by
reading `src/pages/EditProject.tsx:631`, not guessed: the fix is `shrink-0` on that element, and `g13` is the green
capture. **The old measurement-only line would never have caught this**, since it printed shortfalls and passed
anyway; this is the argument for assertions over readouts, recorded in the audit because it is the reason the
assertion exists.

### 37.4 The notification band's coverage read was sampling mid-animation, and the repair was to the read

`g10`'s single finding was `[toast-band] /login @ 375x740 phone: the notification band covers no control —
a.inline-flex.rounded-sm "VivaahVarnam…" own 225x48 at 75,145`. On the live page the brand link genuinely sits at
y≈145 and the settled card genuinely lands below the header (`band top y=80` against `top chrome bottom y=65`, §31),
so the two facts only coexist if the card was read **while it was still translating in**:
`getBoundingClientRect()` follows the painted, transformed box while the viewport parent's box follows layout, and
the band's entrance animation is running for the first frames after mount. The repair is a settle primitive, not a
relaxation: `waitForOverlayToSettle()` enumerates `getAnimations({ subtree: true })` and returns when no animation
under the overlay has `playState === 'running'`, and every band snapshot now prints
`the overlay was sampled at rest — 0ms waiting for animations inside the overlay to stop` (0 ms in `g13`'s six band
sites, which is the honest statement that the check did not have to wait there, not that waiting is unnecessary).
The covered-control check itself is unchanged and still requires `band.y >= topChrome.bottom`.

### 37.5 Three browser instruments required a file that only a hosted credential could supply

`g18-journeys.log` is two lines: `Error: ENOENT: no such file or directory, open
'C:\Users\…\s5qual\.env'` from `readFileSync` at `scripts/stage5-ui-journeys.mjs:1307`. No product code was
involved. The prelude reads `.env` to obtain a hosted `VITE_SUPABASE_URL` as a *needle* to search the shipped
bundle for, so a clone that has never held a hosted credential could not run the tier at all — which is precisely
the clone this qualification is performed in (§35's cleanup inventory removed `.env` from the repository, and this
branch has never contacted a hosted project). Repaired in `0216cae` in all three instruments
(`stage5-ui-journeys.mjs`, `stage4-render-qualification.mjs`, `stage5-network-privacy.mjs`) by a tolerant read that
yields `{}` and a measurement stating which case the run is in, **and by making the refusal wider than the needle**:
each prelude now searches `dist` for any `*.supabase.co` / `*.supabase.in` origin and fails on a hit, so the
assertion no longer depends on possessing a hosted value. The current captures print
`ok [prelude] no hosted Supabase origin of any shape is baked into the shipped bundle — scanned 901 KB of shipped
JS/CSS/HTML` (journeys), `… in the built bundle — scanned 901 KB …` (render), and in §32
`searched 901 KB of shipped JS/CSS/HTML for *.supabase.co and *.supabase.in`. The needle branch is still there for a
clone that does declare a hosted URL.

### 37.6 §32's finding was the instrument asserting a property of the environment

`g22-network.log`: `==> checks 115, measurements 89, findings 1`, `exit_code=1`, and the one failure is
`FAIL [prelude] a hosted project reference exists for the bundle to be searched for — .env declares no non-loopback
VITE_SUPABASE_URL, so this pass has nothing to compare against`. That branch was written to refuse a vacuous pass,
and it did — permanently, on every clone shaped like this one, which is an assertion about the *environment*, not
the product. `be1ae37` replaced it with the pattern-shaped refusal described in §37.5 plus a measurement stating
that no needle exists here; the check is now true of the bundle and false if a hosted host is ever baked into it.
`g23-network2.log`: **`==> checks 115, measurements 90, findings 0`, `STAGE 5 §32 NETWORK / PRIVACY: PASS`,
`exit_code=0`**, with the npm installer probes clean before and after, and the same host/editor/guest request
classification §32 recorded previously (every host data call on the host's own bearer, the anonymous key used only
for `/auth/v1/token`, no cookie session, no request carrying the guest credential, the browser profile deleted, and
`the rows and the account this pass created are gone — left 0`).

### 37.7 The third, fourth and fifth substitution, and the four byte-identical builds that answer §36.6

§35.9 and §36.6 recorded `node_modules` being rewritten by pnpm underneath this branch. It happened three more
times in this window, always with the same fingerprint — `node_modules/.pnpm`, `node_modules/.modules.yaml`,
`node_modules/vite` as a symlink, and in the repo root a `pnpm-workspace.yaml` whose body is the interactive
`allowBuilds:` prompt text (`'@swc/core': set this to true or false`), which nothing in this repository writes:

| Event | Root files' mtime | Quarantined to | Consequence |
| --- | --- | --- | --- |
| 3rd | 2026-10-05 ≈13:30 | `../q5-logs/pnpm-contamination-3-2026-10-05T1330/` | `g15-npm-restore-3.log` (`npm ci`), `g16-rebuild-npm3.log` → `index-CNMnmIrw.js` 509226 B at 13:34:47 |
| 4th | ≈13:44 | `../q5-logs/pnpm-contamination-4-2026-10-05T1344/` | `g20-npm-restore-4.log` → same chunk, same 509226 B at 13:49:11; **`g19-render.log` (143/33/0) is labelled as captured on a pnpm-shaped tree and is superseded by `g24`** |
| 5th | 14:04:22 / 14:04:23 | `../q5-logs/pnpm-contamination-5-2026-10-05T1404/` + `PROVENANCE.txt` with both SHA-256 (`0afc0af…`, `31ce3e0…`) | `g25-npm-restore-5.log` records the failed attempt: `EPERM: operation not permitted, unlink node_modules\@esbuild\win32-x64\esbuild.exe`, because a live esbuild child held the file. Releasing **this session's own** preview (`vite preview`, PID 34876, and its `npm run preview` parent 30352 — identified by command line, not by image name; a third `node serve.js` PID 36064 belonging to another session was left running) freed it, and `g25b`/`g25c` gave `npm ci` code 0 and `npm run build` code 0 → `index-CNMnmIrw.js`, **509226 bytes**, `509.23 kB │ gzip: 154.57 kB`, `✓ 2204 modules transformed` at 14:18:24 |

The consequence worth stating plainly: **the locked npm tree reproduced the identical chunk name and byte size four
times** (13:23:59, 13:34:47, 13:49:11, 14:18:24) across two interruptions, while §36.5's substituted tree gave
`index-D4iQch0t.js` at 577.43 kB. §36.6's unattributed +68.24 kB is therefore attributed: it belongs to the
substituted dependency tree, not to anything in this branch's source. Relative to §34's locked-tree number
(`index-BWDFhgPY.js`, printed 509.19 kB), the current 509.23 kB differs by tens of bytes and one hash, which is the
`h-11`/`w-11` class strings `344c3b1` added to the workbench — the same tree, the same installer, a different HEAD.
Re-measure: `node ../q5-logs/markers.cjs` before and after any gate, and `ls -l dist/assets/index-*.js`.

That is also why the two browser captures after the 4th event are the authoritative ones for §37: `g23` (network,
ended 14:01:35) and `g24-render-npm.log` (render, tag `stage4render-muuzqwes-61zmzr`, `==> checks: 143,
measurements: 33, findings: 0`, `STAGE 4 RENDER QUALIFICATION: PASS`, ended 14:03:14) each printed the npm probe
**after** they finished, showing `.pnpm present: false`; the substitution landed 70 seconds later. `g18b`
(journeys, §37.9) brackets itself the same way, with clean markers on both sides.

### 37.8 The loopback HTTP battery, measured twice, and one truncation of my own making

The first run of this window (`g17-http-battery.log`) was piped through `tail -40`, which destroyed four of the five
per-file summaries; the numbers from it are **not** used anywhere. `g21-http-battery-full.log` re-ran
`bash supabase/tests/api/run.sh` with the whole stream captured: `ℹ tests 38 / pass 38 / fail 0`,
`56 / 56 / 0`, `28 / 28 / 0`, `36 / 36 / 0`, `28 / 28 / 0` across the five files — **186 cases, 186 passed, 0
failed**, `exit_code=0` — and its footer re-asserts the stack's own boundary:
`weddings back to 0 rows`, `auth.users back to 0 rows`, `invitation_drafts back to 0 rows`. The runner started,
stopped and reset nothing; the reset was a separate step (`g5-dbreset.log`), and the base URL is refused unless it
is loopback. `g6-api.log`, run earlier in the window at a different HEAD, printed the **same five tallies**, so the
total is stable across the two runs rather than a one-off count.

§35.4's duplicated `API35` id is closed by the same run: the ids printed across the five files are
`API01 … API38` with **38 distinct values** for 38 cases in the publication file, so no id is carrying two tests.
Re-measure: `grep -aoE "API[0-9]{2}" ../q5-logs/g21-http-battery-full.log | sort -u | wc -l`.

### 37.9 §35.4's three open items, each closed with the line that closes it

| Open item | Closing measurement | Where |
| --- | --- | --- |
| The post-repair `<main>` had never been re-read in a browser | `ok [editor] editor @ 375x740 phone: the host workbench has exactly one main landmark — landmarks={"main":1,"header":1,"nav":0}`, and the same at `768x1024`, against the production bundle; asserted at `scripts/stage5-a11y-mobile.mjs:979-981` (`f62b190`) | `g10`, `g12`, `g13` |
| The sign-up copy had no browser assertion | `ok [prelude] s5a-host: sign-up copy matches the local stack's no-confirmation behaviour — truthful no-email notification rendered`, and the same for `s5b-host` (`4fb6990`) | `g18b-journeys.log` |
| `API35` named two tests | 38 distinct ids over 38 cases, `API01`–`API38` | §37.8 / `g21` |

`g18b-journeys.log` (run tag `stage5ui-muuyzpt2-6ugfk`) is the journeys tier's authoritative capture:
**`==> checks 89, measurements 12, findings 0`, `STAGE 5 BROWSER JOURNEYS: PASS`**, superseding §30's 86/11/0. All
three journeys (no-pack, synthetic approved pack, retirement + R2) ran on it, and the browser tier's own cleanup
printed that the accounts and rows it made were deleted. The SQL batteries in the same window were re-measured on a
freshly reset stack at this head: Stage 0 RLS `STAGE0 RLS TESTS PASSED (24)`; Stage 2's chain
`draft invariant (49)`, `publication boundary (284)`, `privilege + RLS attacks (464)`, `catalog conformance (103)`,
`migration outcome (historical rows) (76)`; Stage 4's runner `PASSED (426)` + `§8 fixture tooling PASSED (57)`;
Stage 5's `50_review_binding (122)`, `60_definition_vocabulary (50)`, `70_document_resolution (124)` and, at the
Stage 5 head, `stage 4 pack documents PASSED (428)` + `(57)` — each runner printing its own head and none adding
itself to another's totals, as §34 required. All `exit_code=0`.

### 37.10 Conditions a reviewer needs before reading any "PASS" here as "CI is green"

- **GitHub Actions has not been used as evidence for this stage and cannot be, at the account's current quota
  state.** `.github/workflows/ci.yml` triggers only on `push`/`pull_request` to `main` (`on: push: branches:
  [main]`), so the pushes this branch has had — including the ten commits §37.1 lists, each pushed immediately with
  an explicit refspec — started no workflow. That is a fact about the trigger, not a passing run. No hosted-CI PASS
  is claimed anywhere in this file, and no PR was opened to manufacture one.
- **The dependency-audit condition is split, and both halves are printed here.** At this head,
  `npm audit --omit=dev --audit-level=high` → `found 0 vulnerabilities`, `exit_code=0`; `npm audit
  --audit-level=high` over the dev graph → `13 vulnerabilities (2 moderate, 11 high)`, `exit_code=1`, the chains
  being `@vitest/mocker` (`Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock —
  GHSA-82fw-gwwq-j7x9`) and the `@typescript-eslint/*` family. The shipped product graph is clean; the local test
  tooling is not, and the second command's non-zero exit is part of the gate record, not a suppressed detail.
  Measured after `60cb331` moved `tailwindcss-animate` out of `dependencies`; no causal claim is made for the
  0-vulnerability result.
- **Node tiers were re-run on the clean clone and each exit is in the log.** `gates3.summary.log` (working tree at
  `60cb331`, timestamps 12:27–12:45 +05:30) records exactly twelve entries and **exactly one non-zero exit**:
  `g3-markers-before 0`, `g3-lint 0`, `g3-typecheck 0`, `g3-dbtypes 0`, `g3-selftest 0`, `g3-productcheck 0`,
  `g3-unit 0`, `g3-build 0`, `g3-audit 0`, **`g3-auditdev 1`** (the dev-graph audit, the split condition above),
  `g3-diffcheck 0`, `g3-markers-after 0`. The individual outputs give the numbers those exits cover —
  `product:check` → `179 active file(s) scanned, 0 violation(s)`, the checker's `--self-test` → `29 rule(s)
  verified` (28 in §36.5; the extra pair belongs to the `markup-injection-sink` rule `6a67157` added), unit →
  `30 files / 440 tests`. `g9-node.log` (13:09, at `6a67157`) re-ran markers + typecheck + lint + build on the
  injected-sink guard, and `g14-node-post-shrink.log` (≈13:27, working tree carrying `344c3b1`) re-ran markers +
  typecheck + lint + `product:check` (`179 … 0 violation(s)`) + unit (`30 / 440`) after the tap-target shrink, all
  `code=0`. **`npm run build:dev` was not run in this window and no result for it is claimed here.**
- **The `product:check` file count is a filesystem measurement, and the 181 → 179 move is now explained rather
  than left as a discrepancy.** §33.7, §35.9 and §36.5 each recorded `181 active file(s) scanned`; every run in
  this window prints `179`. `walk()` in `scripts/check-product-contract.mjs:524-532` reads the directory tree, not
  the git index, and `.yaml` is in `SCANNED_EXTENSIONS` (`:474-485`), so any untracked root file with a scanned
  extension joins the population. Measured at this head: both clones track the **same 246 files**, and each
  clone's tracked-and-scanned subset is **179** (`node ../q5-logs/scannedcount.mjs <clone>`, run against both).
  The legacy worktree (`../wedding-invites-pro`) currently scans **181** while this clone scans **179**, and the
  set difference between the two on-disk populations is exactly two named files — the comparison printed
  `in legacy only: pnpm-lock.yaml, pnpm-workspace.yaml` and `in s5qual only:` (empty). **So an 181 reading is
  itself evidence that the two pnpm files were sitting in the scanned root when it was taken**, which is what
  §35.9/§36.6 describe, and 179 is what a clean npm-only clone measures with nothing of the kind in its root. The
  two numbers therefore agree about the repository: the gap is the contamination's footprint, not a source change,
  and no tracked file was added or removed to produce it.

### 37.11 What this section does not claim

It does not claim the raised targets were reviewed by a designer, or that 44 px is now met anywhere except the host
workbench and the notification band — `src/components/ui/*` still ships 40 px defaults, and no public, marketing,
configure-screen or guest-page control was raised by this pass. It claims no WCAG conformance: `g13`'s contrast
assertion covers the 35 (phone) / 34 (tablet) text runs the editor paints, its 24 px floor covers every enabled
control, and neither is an audit. It does not claim the overlay-settle primitive makes animation timing
deterministic — it makes the read wait for the browser's own animation state, which is a different claim, and
`g13` printed 0 ms of waiting. It does not claim the fifth substitution's cause is inside this repository: the
`allowBuilds` prompt text is written by an interactive `pnpm install`, this branch declares no `packageManager` and
no `engines`, and the process that performed it was not this session's. It does not claim a root cause for §30's
`Runtime.evaluate` hang, which did not recur in this window. Nothing here approves the Tamil candidate, contacts a
hosted Supabase project, deploys, merges, rewrites history, or starts Stage 6; the `git ls-remote` read-back after
each push (`be1ae37` for the branch, `328f0e3f…` for main, unchanged by this pass) is the evidence for that.

## 38. Closure: the truth-sync commit, contamination events 6 and 7, the final coherent gate set, and what is left running

Everything below is a record of what was measured after §37 was written. Nothing in §37's numbers was rewritten.

### 38.1 the truth-sync commit, and the four claims in my own draft that it refused

`4ab2e9fdbd04d643e8e271953ec7c5e4a6e434f2` — `docs(truth): append audit §37 and sync the matrix to what it now
measures` — is **4 files, 290 insertions, 6 deletions**: `docs/audits/stage-5-pack-driven-authoring-review.md`
(+273), `docs/product/feature-readiness.md` (10 lines touched), `docs/product/design-principles.md` (+8),
`README.md` (5 lines touched). It was pushed with an explicit refspec (`be1ae37..4ab2e9f`) and read back; §38.6
prints the latest read-back.

Four statements in the uncommitted draft were wrong and each was corrected against a primary source before the
commit was made, because the alternative — a section that reads well and does not match its own logs — is the
failure mode this whole pass is guarding against:

- **`build:dev` was in the gate list.** It is not. `gates3.summary.log` has twelve entries and none of them is a
  dev-graph build; §37.10 now says plainly that `npm run build:dev` was not run in this window and claims no result
  for it.
- **"nine pushes"** was not supportable. `ci.yml` fires only on `push`/`pull_request` to `main`, so the pushes this
  branch has had — including the ten commits §37.1 lists, each pushed immediately with an explicit refspec — started
  no workflow. §37.10 states it that way instead.
- **Two commits were described by the wrong files.** `git show --stat` says `60cb331` is `package.json` +1/−1 with
  `package-lock.json` +117, and `6a67157` is the `markup-injection-sink` rule (+151), its self-test fixture (+2) and
  **three** docs it made honest — not two. The draft's cells were replaced with those numbers.
- **Two causal stories were invented.** "19 = 18 workbench targets + the band" is a coincidence, not a derivation
  (§30.10's 18 came from the earlier 59-check capture; `g8`'s extra member is the band's dismiss control), and the
  draft's explanation for the 181 → 179 `product:check` drift was replaced by the measured one: `walk()`
  (`scripts/check-product-contract.mjs:524-532`) reads the filesystem, `.yaml` is a scanned extension
  (`:474-485`), both clones track the same **246** files and each clone's tracked-and-scanned subset is **179**
  (`node ../q5-logs/scannedcount.mjs <clone>`), and the on-disk difference is exactly
  `pnpm-lock.yaml, pnpm-workspace.yaml` in the legacy worktree with nothing in `s5qual`. So an **181 reading is
  itself evidence of the contamination's footprint**, which retroactively corroborates §35.9 and §36.6.

The matrix rows it synced were rewritten to the authoritative runs rather than padded: the a11y row now carries
**63/52/0** from `g13-a11y-shrink.log`, the 19-target closure list, the `43x44` flex-shrink defect and its
`shrink-0` fix at `src/pages/EditProject.tsx:631`, and the browser `<main>` re-read printing
`{"main":1,"header":1,"nav":0}`; journey A now carries tag `stage5ui-muuyzpt2-6ugfk` at **89/12/0**, explicitly
superseding 86/11/0 rather than deleting it; the renderer row carries the §37.7 npm re-run at **143/33/0**, marked
"superseded, not deleted". `README.md:162` pointed at `src/pages/signupNotificationTruth.test.tsx`, a file that has
never existed; it now names `src/test/signupNotificationTruth.test.tsx` and the per-host browser assertion that
actually exists (`scripts/stage5-ui-journeys.mjs:411-437`, which waits on the no-confirmation copy and checks it).
`docs/product/design-principles.md` gained the scoping paragraph for the Stage 1 40 px deviation, and the shared
defaults in it are now quoted from source rather than from memory: `src/components/ui/button.tsx:20-23` ships
`default: "h-10 px-4 py-2"`, `sm: "h-9 rounded-md px-3"`, `icon: "h-10 w-10"`, and `input.tsx:11` ships `h-10` —
all unchanged by this pass.

### 38.2 events 6 and 7: the same two files came back 58 seconds after being removed

- **14:40:26/27 +05:30** — `s5qual/node_modules` was rewritten by an external `pnpm install` and
  `pnpm-lock.yaml` + `pnpm-workspace.yaml` appeared in the repo root, **26 s after** the `g26` `markersafter` gate
  printed npm-clean and **86 s after** `4ab2e9f`. Recorded as event 6, moved to
  `../q5-logs/pnpm-contamination-6-2026-10-05T1440/` with their SHA-256 taken first: `0afc0afae24e8252…fd8813a1`
  (lock) and `31ce3e03cd4f1ede…32f444ed` (workspace) — byte-identical to event 5's pair, so no npm lock was lost
  from the repository, and the workspace file is three lines — an `allowBuilds:` block whose two values are the
  literal placeholder text `set this to true or false`, for `@swc/core` and `esbuild`, which only an interactive
  `pnpm install` writes.
- **Restoring the tree required one kill, and it was this session's.** `npm ci` refused to run while esbuild was
  held: this session's `vite preview` (PID 28932; its recorded parent 36912 was already gone) was stopped, and
  another session's `node serve.js` (PID 36064) was left running untouched. `npm ci` then exited 0
  (`g27-npm-restore-6.log`).
- **14:43:24 +05:30** — the identical pair re-materialised in the repo root, **58 s after** event 6 was quarantined
  and while `node_modules` had just been restored to the locked npm tree. Moved to
  `../q5-logs/pnpm-contamination-7-2026-10-05T1443/` (7th drop, 6th distinct timestamp, same two SHA-256 values).
- **What that sequence establishes.** A write that returns byte-identically after its target has been deleted, in a
  tree that had just been rebuilt by npm, cannot be caused by that tree. It also cannot be caused by this session's
  preview server, which was stopped before the reappearance. The actor is outside this repository and outside this
  pass; its identity is still not known, and no root-cause claim is made here.
- **Quarantine, never deletion.** Both pairs are kept with `PROVENANCE.txt`, neither was staged, neither was
  committed, and `git status --porcelain` is empty at every measurement point in this section.

### 38.3 the final coherent gate set, run entirely on an npm-provenanced tree

`g28-final-gates.log`, HEAD `4ab2e9fdbd04d643e8e271953ec7c5e4a6e434f2`, 14:49:00 → 14:51:33 +05:30. **Sixteen
entries, one non-zero exit**, and the installer markers are npm-clean on both sides of the set —
`npm .package-lock.json: true`, `.pnpm present: false`, `.modules.yaml present: false`, `vite is symlink: false`,
`pnpm-lock.yaml in repo root: false`, `pnpm-workspace.yaml in repo root: false`, before and after:

| tier | exit | what the output says |
| --- | --- | --- |
| `markers-before` | 0 | all six npm-clean booleans above |
| `typecheck` | 0 | clean |
| `lint` | 0 | `✖ 9 problems (0 errors, 9 warnings)`, all nine `react-refresh/only-export-components` in `src/components/ui/*` |
| `dbtypes` | 0 | `Database contract OK — 19 migration file(s)`; 19 public + 10 non-client tables; 29 query column groups reconciled, 0 findings |
| `productcheck` | 0 | `Product contract OK — 179 active file(s) scanned, 0 violation(s).` |
| `selftest` | 0 | `Product contract self-test OK — 29 rule(s) verified.` |
| `unit` | 0 | `Test Files 30 passed (30)`, `Tests 440 passed (440)` |
| `build` | 0 | `✓ 2204 modules transformed`; `dist/assets/index-CNMnmIrw.js 509.23 kB │ gzip: 154.57 kB` |
| `chunk` | 0 | `-rw-r--r-- … 509226 Oct 5 14:51 dist/assets/index-CNMnmIrw.js` |
| `audit-production` | 0 | `found 0 vulnerabilities` |
| **`audit-dev`** | **1** | `13 vulnerabilities (2 moderate, 11 high)` — the dev graph; the split §37.10 records |
| `diffcheck` | 0 | `git diff --check` clean |
| `status` | 0 | `git status --porcelain` empty |
| `secret-scan` | 0 | 487 added lines, ten rules — see §38.4 before trusting this row |
| `markers-after` | 0 | all six npm-clean booleans again |
| `head-final` | 0 | `git rev-parse HEAD` → `4ab2e9f…` |

One number in that log is a measurement without an explanation and is recorded as such: `node_modules` top-level
directories read **357** at `markers-before` and **359** at `markers-after`, while `g26`'s identical probe at 14:39
read 358. The
restore that produced 357 is itself in evidence — `g27-npm-restore-6.log`, npm ci at 14:45:10, exit 0, 357 top-level
directories after, pnpm markers all false — and no install ran inside the gate set, so nothing accounts for the last
two. The **six booleans** are the provenance signal and the directory count is not; do not treat it as one.

### 38.4 two credential sweeps, and the rule that silently did not run

The `secret-scan` tier above printed a blank where a count should have been, and the reason is in the same lines of
the log: `grep: unknown option -- -----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----`. The pattern begins with a
`-`, so grep parsed it as an option, and the `|| true` in my own script converted that failure into an empty value —
which, in a table, looks exactly like a clean rule. **A rule that did not run is not a rule that passed.** Two
fixes followed, and both are visible rather than tidied away: the pattern is now passed after `-e`, and the sweep was
re-run wider at 14:54:07 (`g29-secretscan-widened.log`, same HEAD) over **every** line this window added, **760
lines including `docs/audits`**, which the narrower pass had excluded. Ten rules — `jwt-like`, `sb-secret-shape`,
`service-role-jwt-text`, `aws-key`, `github-token`, `pem-private-key`, `url-userinfo`, `long-base64`,
`hosted-supabase`, and the deliberately broad `any-eyJ-prefix` — **0 each**. The scanner counts and never prints a
matched value, and no `.env` or `.env.local` content was read into any log in this window.

### 38.5 what was not re-run at the final HEAD, and the limit of the reason given

The SQL batteries, HTTP battery, the four browser journeys, the 10×4 render sweep, the a11y/mobile instrument and the
network/privacy observation were **not** re-executed after `4ab2e9f`. The reason is testable rather than assumed:
the last commits to touch shipped source are `344c3b1` (editor CSS) and `be1ae37`/earlier (`scripts/` instruments,
which are not in the bundle), `4ab2e9f` changes only four documentation files, and the build produced for this gate
set is the same artefact the browser tiers were run against — `g16-rebuild-npm3.log` (13:34:47),
`g20-npm-restore-4.log` (13:49:11) and `g28-final-gates.log` (14:51) each `ls -l` `dist/assets/index-CNMnmIrw.js` at
**509226 bytes**, same name same length, and every full build logged in this window reports `✓ 2204 modules
transformed` (`build.log` 12:23, `build2.log`, `g3-build.log`, `g28-final-gates.log`). **The limit:** name and byte
length are not byte identity — and the older logs in this very set prove chunk names do move when sources move
(`g3-build.log` printed `index-BWDFhgPY.js` at 509.19 kB) — while no digest was taken for the earlier builds because
every `npm run build` cleans `dist/`. So the first digest at this HEAD is now recorded, in `g30-chunk-hash.log`:
`index-CNMnmIrw.js` = `54324db6d00e5fb52ca4f9d4bff69726e3a03813cf5bfd2e237d00ec72d0d7d2`,
`EditProject-BXWprzJ9.js` = `2baf774b5e2f97c913f73a505f37458fac67d343a22dda32c8176597c65a5cc0`. A later pass can
compare against those instead of against a name. The claim this supports is "the browser tiers ran against a bundle
whose chunk name and byte length match the one measured at this HEAD", and no stronger claim is made.

### 38.6 what is left running, and the final remote read-back

`../q5-logs/g31-final-readback.log`, 15:04:24 +05:30:

```
328f0e3fef5a39aa5f91182fb54bf0a97d717e69	refs/heads/main
4ab2e9fdbd04d643e8e271953ec7c5e4a6e434f2	refs/heads/stage5/pack-driven-authoring-review
```

Local `HEAD` equals the branch tip, `refs/heads/main` is the same SHA §37 recorded, and the only local branch is
`stage5/pack-driven-authoring-review`. `git status --porcelain` is empty. **main was not pushed to, touched or
rewritten; nothing was merged; no PR was opened** — `ci.yml` triggers only on `main`, so opening one or pushing
there would spend the exhausted Actions quota, and no hosted-CI PASS is claimed anywhere in this audit.

The local stack is left running, as instructed: `supabase_kong_localvivaahvarnam` (0.0.0.0:54400→8000, healthy),
`supabase_db_localvivaahvarnam` (54401→5432, healthy), `supabase_inbucket_localvivaahvarnam` (54403→8025, healthy),
`supabase_auth_localvivaahvarnam` and `supabase_rest_localvivaahvarnam`. `DueWeave` was not reset, stopped or
read. This session's `vite preview` was stopped as a precondition for `npm ci` and was not restarted — `netstat`
shows **0** listeners on 4173 — while the other session's `node serve.js` (PID 36064) was left alone. The
quarantine directories, the `.mjs`/`.sh` instruments and every gate log live in `../q5-logs`, outside the repository
and outside the commit.

### 38.7 what this pass leaves open

- **Cultural approval of the Tamil candidate is withheld.** It needs a human reviewer and this pass did not
  substitute for one.
- **The `enable_confirmations = true` arm is untested.** The local stack confirms accounts without email, which is
  exactly what the sign-up copy and `stage5-ui-journeys.mjs:411-437` assert; the opposite configuration's behaviour
  is unevidenced.
- **44 px is not a product-wide rule.** §37 raised the host workbench and the notification band and the instrument
  asserts a 24 px floor (`MIN_TARGET_PX`, `scripts/stage5-a11y-mobile.mjs:89`, assertion at `:700`); 32–40 px pill
  buttons remain on other surfaces and `src/components/ui/*` still ships 40 px defaults. The `pr-8 → pr-14`
  change also narrows the band's text column by 24 px, and no screenshot of the band was captured.
- **Landmarks are printed, not asserted.** The `<main>` that §30.10 found missing from the success branch now
  exists (`src/pages/EditProject.tsx:654`, landed in `344c3b1`), but the instrument still asserts nothing on
  landmark counts.
- **Two causes remain unknown:** the §30 `Runtime.evaluate` hang, which did not recur in this window, and the
  external process behind seven contamination drops whose output is byte-identical every time.
- **No Stage 6 work was started**, and no deployment, hosted-Supabase contact, history rewrite, secret printing or
  word-ban was performed. The sanitised SVG boundary was not weakened: `sanitizeSvg-CfK6a1-E.js` is still in the
  build graph at 29.89 kB.

Stage 5 is qualified on the evidence above and pushed to its branch. It is **not** merged.
