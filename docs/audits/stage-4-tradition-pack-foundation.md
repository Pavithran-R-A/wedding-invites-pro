# Stage 4 audit — Tamil + English tradition-pack foundation, content governance and cultural-safety vertical slice

Executed by the coding agent as a single stage. Reviewer: ChatGPT (auditor / technical auditor /
product controller / stage reviewer). Every number below was printed by a command that ran on this
machine; each section names the command or the assertion that produced it, so a claim can be
re-measured rather than re-believed. Where something was **inferred rather than executed, it says so
in those words.** Sections are added as the stage's phases complete; a section that is not yet here
means the phase has not been run, not that it passed.

This document does not calculate a project completion percentage. That is the reviewer's job.

**The one sentence this stage must not blur:** there is no human-reviewed Tamil ceremonial content
in this product. Stage 4 builds the *system* that could carry such content — a versioned release, a
lifecycle that refuses to promote without review metadata, a selection path a customer cannot steer
with an identity signal, and a renderer that takes its order from data. The pack that exists at the
end of this stage is a draft candidate, and the only approved pack anywhere in the qualification
evidence is a synthetic test fixture labelled as one.

## 1. Starting point

| Fact | Measured value | Re-measure |
| --- | --- | --- |
| Expected `main` at stage start | `b4b2022c5cdb31c5b0256cc28345759761a62937` | `git rev-parse origin/main` |
| Working branch | `stage4/tradition-pack-foundation`, created from that SHA | `git rev-parse --abbrev-ref HEAD` |
| Node / npm / git / Supabase CLI | v24.21.0 / 11.19.0 / 2.55.0 / 2.118.0 | `node -v; npm -v; git --version; supabase --version` |
| Migrations on disk | 17 | `ls supabase/migrations/*.sql \| wc -l` |
| Tracked files | 198 | `git ls-files \| wc -l` |
| Unit tests at baseline | 189 in 18 files; **191 in 18 files** after §2B added two checker tests | `npm test` |
| Database batteries at baseline | Stage 0 RLS 24; Stage 2/3 clean chain 41 / 46 / 269 / 325 / 94; legacy chain 75 / 49 / 269 / 325 / 94 | `bash supabase/tests/rls/run.sh`, `bash supabase/tests/stage2/run.sh both` |
| `npm audit` before the Vite repair | 6 findings — 5 moderate, 1 high | `npm audit` |
| `npm audit` after | 4 findings — 4 moderate, 0 high | `npm audit` |
| Production build, Vite 5.4.19 | `index` 489.05 kB / 147.24 kB gzip | git history of §2C's measurements |
| Production build, Vite 6.4.3 | `index` 491.21 kB / 148.30 kB gzip — **+2.16 kB / +1.06 kB gzip** | `npm run build` |

The database was installed clean before anything was measured: `rm -rf node_modules` and `npm ci`,
because the previous session's `node_modules` had been re-created in a pnpm-shaped layout by tooling
outside this task. `npm` remains the only package manager used; `pnpm-lock.yaml` and
`pnpm-workspace.yaml` are neither read, edited, staged nor committed.

Baseline content state, measured on the local stack: **`public.tradition_packs` held 0 rows.** Every
wedding the running build can create has `tradition_pack_id IS NULL`. That number is the honest
starting point for §26's product truth and the number §29 must return to.

## 2. Prelude — three carry-forwards closed, and a fourth defect found on the way

### 2A. The editor page's non-deterministic assertion — fixed at the sync point

`src/test/editInvitationPage.test.tsx` queried controls that only the loaded state has, after waiting
for a heading that **both** the loading and the loaded state print. `ContentEditor` renders
`<h2>People, venues and ceremonies</h2>` in its loading branch (its own `loading` starts `true` while
`Promise.all([listPeople, listVenues, listCeremonies])` is in flight), so the wait satisfied on an
empty shell and the query below it raced the response.

Reproduced deterministically before fixing it, by introducing a 30 ms delayed row response through the
existing fake: `Unable to find an accessible element with the role "button" and name "Add a person"`.
Fixed by awaiting a control only the loaded state owns — the three lists land in one commit, so the
first of the three buttons to appear brings the other two with it. The delay was then re-applied and
the file run repeatedly to prove the fix is the sync point and not the timing; the timeout was not
raised, file parallelism was not disabled, no sleep was added, and the failing test's assertions are
byte-identical to the ones that were red.

### 2B. Generated-types whitespace drift — the source is the generator

The drift came from `supabase gen types typescript`, which prints a blank line after `} as const`; our
write step preserved it and `git diff --check` called it trailing whitespace. So the check pipeline was
taught the generator's actual output instead of the idealised one:
`checkGeneratedTypesEof` in `scripts/check-db-contract.mjs` now refuses anything other than exactly one
trailing newline, with a message that says what to drop. Two checker tests cover it (positive: one
newline, LF and CRLF both; negative: blank line in either flavour, and no newline at all). The file was
normalised once (32973 → 32971 bytes). `git diff --check origin/main...HEAD` exits 0.

### 2C. The Vite dev-server advisory — patched, not mitigated

The smallest patched line was 6.4.3, so Vite went `^5.4.19` → `^6.4.3`. The jump was investigated
before it was made: the advisory is in the dev server's own dependency chain and 6.4.x carries the
patch, so no forced major and no `npm audit fix --force`. `@vitejs/plugin-react-swc` and `vitest` needed
no change — the peer range already admitted Vite 6, which is why this is recorded as a patch and not as
an upgrade project. esbuild moved 0.21.5 → 0.25.12 as Vite's own dependency. After `npm ci`: lint,
typecheck, `dbtypes:check`, `product:check`, 191 unit tests and the build all pass; `npm audit` is 4
moderate / 0 high; `npm audit --omit=dev --audit-level=high` exits 0 both before and after, so the
production surface was never exposed. `npm run dev` and `npm run preview` were both exercised: the
guest route, the lazy chunks, and the local API calls all behave as they did, the dev-server high
advisory is gone, and no new console errors were observed. The one measured consequence is the bundle
delta in the table above: +2.16 kB raw / +1.06 kB gzipped on the index chunk.

Two things this does **not** claim. `vite.config.ts` still binds to `host: "::"` — that is the pre-existing
local posture and it was left alone, because patching the advisory removed the reason to change it.
And the four remaining moderate findings are untouched: they belong to dev/test dependencies and to
`react-router`, and §27 forbids fixing a moderate finding with a forced major jump.

### 2D. A fourth defect, found while running the §1 baseline: the SQL battery was line-ending dependent

The very first gate of this stage — `bash supabase/tests/stage2/run.sh both`, on a schema this stage had
not yet touched — failed:

```
ERROR:  FAIL G1 the whole callable surface of api, function by function — invoker wrappers only
!! publication boundary FAILED (psql exit 3)
```

while the same run's other suites passed. Nothing in the repository's SQL had been edited, so the
failure was either a real regression in `api` or a broken instrument. It was the instrument.

`30_publication.sql`'s G1 asserts a **whole multi-line literal** and compares it with
`IS NOT DISTINCT FROM` — an exact comparison. The expected text is joined by `E'\n'` inside the
database, so it can never contain a carriage return; the literal in the file carries whatever the
checkout wrote. The repository's committed SQL is LF, but this working tree has `core.autocrlf=true`
and no `.gitattributes`, so git re-materialises a checked-out file with CRLF. The proof is that the
working tree is *mixed*, which is what gave the failure its run-to-run mystery:

```
$ git ls-files --eol supabase/tests
i/lf  w/crlf   supabase/tests/stage3/30_publication.sql     blob CR = 1951 in the working copy, 0 in the blob
i/lf  w/lf     supabase/tests/rls/01_rls_attacks.sql
```

Files git rewrote during this stage's branch creation and the Stage 2/3 merge closure became CRLF;
files it never touched kept the LF bytes they were written with. The suites that passed simply have no
whole-literal text assertion to corrupt.

Single-variable confirmation, same container, same database, same `psql` invocation, file unmodified —
the only difference is whether CR bytes reach stdin:

```
file as checked out .................... ERROR: FAIL G1 ...   psql exit 3
identical bytes, CR removed in the pipe . ALL STAGE 3 PUBLICATION TESTS PASSED (269)   exit 0
```

Because a schema regression would have to survive the second run, it does not exist: the `api` surface
is correct, and 269 assertions about it pass. The repair is therefore at the transport boundary, not in
the assertion. Every SQL file now reaches psql through `sql_bytes()` — `tr -d '\r' < "$1" | psql …` — in
`supabase/tests/stage2/run.sh` (both the Docker and `STAGE2_LOCAL=1` paths) and in
`supabase/tests/rls/run.sh`. That normalises **input only**: the database receives the committed bytes
on every platform, and no expectation, assertion or count was changed. A real regression still fails
exactly as loudly.

`supabase/tests/rls/run-baseline.sh` and `run-repro.sh` were deliberately left alone. They are the Stage
0 diagnostic probes for a defect that is already closed, they gate nothing, and they apply migrations
rather than asserting literals; widening the repair to files with no failing assertion to justify it is
the kind of bundled cleanup this stage has been told not to do.

The underlying environment cause — autocrlf with no `.gitattributes` — is recorded as a follow-up
rather than fixed here. Adding `.gitattributes` would change what every future checkout of every file
in this repository writes to disk, which is a much larger blast radius than a test transport, and it
would not help the working tree this stage is measured against.

**Counts, before and after, so the totals are carried rather than replaced.** Before the repair the
battery could not be totalled at all (one suite exited 3). After it, both chains run green:

| Suite | Clean chain | Legacy chain |
| --- | --- | --- |
| migration outcome | 41 | 75 |
| draft invariant | 46 | 49 |
| publication boundary | **269** | **269** |
| privilege + RLS attacks | 325 | 325 |
| catalog conformance | 94 | 94 |
| Stage 0 RLS battery | 24 | — |

## 3. Gap analysis of the existing `tradition_packs` shape

Written before any migration code, as instructed. Inputs read: `public.tradition_packs` as created in
`20260925120100_stage2_canonical_domain.sql:15-37`, its trigger at `:212` and its `set_updated_at` at
`:192`, `weddings.tradition_pack_id` at `:89`, `invitation_versions.tradition_pack_id` at
`20260925120200_stage2_versions_and_publication.sql:30`, the grants and policies at
`20260925120500_stage2_rls_and_grants.sql:43,98,348`, the client-write guard `private.reject_client_write()`
at `20260925120000_stage2_privilege_baseline.sql:137-153`, the snapshot builder and DTO projections at
`20260926130000_stage3_publication_resolution_boundary.sql:302,345,433-438,604-607`, the generated types
in `src/integrations/supabase/types.ts`, `src/lib/publicInvitation.ts`, `src/components/invitation/InvitationRenderer.tsx`,
`docs/architecture/render-contract.md`, `docs/architecture/stage-2-domain-blueprint.md` §5,
`docs/product/content-governance.md`, `docs/product/invitation-semantics.md`,
`docs/product/feature-readiness.md`, and ADR 0003.

**How the behavioural claims were obtained.** Not by reading the DDL and guessing. A throwaway
`postgres:16-alpine` container was started, given `supabase/tests/rls/00_bootstrap.sql` plus all 17
migrations in timestamp order — the same chain the documented battery builds — and probed inside a
transaction that was rolled back, so nothing persisted and the local stack was never written to. Each
client statement ran under `SET ROLE authenticated` with the role echoed back from `current_user`
(`session role for the client half: authenticated`), and each row built was complete, so no refusal
below is an artefact of a missing required column. One probe run is disclosed as a measurement error
rather than hidden: an earlier version of it issued `RESET ROLE` before the mutation statements, so its
first two verdicts were taken as the owner role while labelled as the customer's; the numbers in this
section come from the re-run, and the re-run prints the role next to every verdict.

### 3.1 The ten questions

**Is the current table sufficient to represent releases? No.** One row is simultaneously the pack and
the revision — `UNIQUE (pack_key, revision)` with `id` as the thing everything points at. A pack family
has no identity of its own that survives a re-wording: changing a display name means inserting a new
row, and nothing but a text key ties the two together. Status, review metadata and content all live on
the same mutable row, so there is no object that can be "the immutable thing a wedding chose". §5's
two-table shape is what the current one is missing, not a nicety.

**Where does version identity live?** In `pack_key` + `revision` on the row, and — because that is what
a consumer can actually see — in the three keys the snapshot freezes: `jsonb_build_object('display_name',
…, 'pack_key', …, 'revision', …)` at `20260926130000_stage3_publication_resolution_boundary.sql:302`.
Identity is therefore a *label copied from a mutable row*, not a reference to a fixed content object. The
`revision` integer has a `CHECK (revision > 0)` and a uniqueness constraint, but no rule that says a
revision must exist before it can be chosen, and none that says a higher number supersedes a lower one.

**Where does reviewer metadata live?** Three columns on the content row: `reviewed_by` (FK to
`auth.users(id)` `ON DELETE SET NULL`), `reviewed_at`, `review_notes`, plus the biconditional
`CHECK ((status = 'approved') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))`. The biconditional
is genuinely load-bearing and it bites — measured: demoting an approved row to `draft` while its reviewer
metadata was still attached failed with `new row for relation "tradition_packs" violates check constraint
"tradition_packs_check"`. What is missing is everything §18 asks for and `content-governance.md` promises:
the reviewer's stated basis for qualifying, which languages and which sections the review actually
covered, the source or reference the wording came from, what changed from the previous release, and
whether a machine was involved at all. `review_notes` is free text standing in for all five.

**Can an approved pack be mutated today? Yes — against a customer it cannot, and against the product it
does not hold.** Measured as `authenticated`: `UPDATE` on a pack row → `REFUSED 42501`, `DELETE` →
`REFUSED 42501`, `INSERT` → `REFUSED 42501`, for draft and approved rows alike; that half is real and
`20_attacks.sql` groups 7–9 already pin it. Measured as the owning role, which is what a migration, a
maintenance script or a future admin RPC runs as: an in-place `UPDATE … SET structure = '{"edited":
true}', supported_languages = ARRAY['en','ta']` on a row whose status was `approved` returned `ALLOWED`
and read back the new value. There is no immutability predicate anywhere on this table. So the invariant
the blueprint states — "Immutable once referenced. A pack row must never be edited in place while
invitations depend on it" — is enforced against exactly the one actor that was never going to do it.

**Can a deprecated pack still be newly selected? Yes.** Measured: as `authenticated`,
`UPDATE public.weddings SET tradition_pack_id = <deprecated row>` → `ALLOWED`, and the wedding then
carried that id. The same is true of a draft row (→ `ALLOWED`). The reason is structural:
`weddings.tradition_pack_id` is a bare `REFERENCES public.tradition_packs(id)` with no status predicate,
no check, and no trigger behind it. Note the detail that makes this easy to miss: the read policy
`users_read_platform_packs … USING (status IN ('draft','approved'))` *hides* deprecated rows, so the
catalogue looks clean from the picker's point of view — a read-back of the deprecated row's status as
that role returned no row at all — while the write path still accepts a reference to it. An RLS filter on
reads is not a constraint on writes, and this is the concrete case for §17's instruction to make the
database enforce the property rather than only grepping for it.

**Can published invitations identify exactly which approved content release they froze? They identify a
label, and the reviewed content they freeze is content nobody resolved.** The snapshot does copy the
whole pack document — `'structure', tp.structure, 'supported_languages', tp.supported_languages` at
`:306-307` — but that copy is inert: no consumer reads `structure`, and `private.public_invitation_dto`
deliberately projects only three keys out of it (`:433-438`), so nothing a guest reads is affected by it.
Identity reaches the guest as `pack_key` + `revision` + a display name; content reaches nobody, because
today none of the document's words come from a pack. And because status plays no part in selection
(question 5), the identity a published invitation carries cannot tell you whether it was ever built from
approved content. §11's byte-for-byte test is untestable against this shape for the half that matters —
which wording the guest read — and only accidentally safe for the half it can express: the frozen strings
stay stable because three copied strings are stable, not because anything stops the row changing under a
later freeze.

**Is reviewed content mixed with host-authored free text?** Not mixed — **absent**. The document is four
prose slots (`welcome`, `family_introduction`, `event_notes`, `closing`) plus `wedding_people`,
`venues` and `wedding_events` rows, every one of them host-written, and the only non-host words on the
page are the renderer's own literals — `"The ceremonies"`, which `render-contract.md` §3 records as
"our word, not a fact about the wedding". There is no provenance field in `PublicInvitation` or in the
DTO, so the moment pack wording arrives there is nowhere to say which sentence was reviewed and which a
relative typed. That absence is why §13 asks for provenance in the snapshot rather than in a UI hint.

**Can the renderer stay pack-agnostic?** It is agnostic today only because it is pack-blind:
`InvitationRenderer` never reads `traditionPack` (the DTO carries it, the component draws nothing with
it), and its section order is hard-coded JSX — header, family groups, ceremonies, note, footer
(`InvitationRenderer.tsx:247-305`). So it cannot be *driven* by a pack without being given an ordered
input. That is the requirement §12 states, and it does not require the renderer to learn what a pack is:
the honest version of "pack-agnostic" is a component that renders the sections it is handed, in the order
it is handed, knowing nothing about where the order came from.

**Can a pack define section order without application branching? No.** `structure jsonb NOT NULL DEFAULT
'{}'` carries one constraint: `CHECK (jsonb_typeof(structure) = 'object')`. It is any object or no
object. Nothing in `src/` reads it — the only hits for `structure` in the application are the generated
type declarations at `types.ts:606,620,634` — and nothing in the migrations validates a key inside it.
Order therefore *is* application code today, and adding a genuinely different tradition would mean
editing `InvitationRenderer.tsx`, which is the exact thing ADR 0003's rule 1 forbids and
`invitation-semantics.md` forbids in the same words ("Packs are data and reviewed content, not code
branches").

**Can a pack declare required/optional fields declaratively? No.** There is no field vocabulary, no
schema for `structure`, no CHECK beyond "is an object", and no consumer that could honour one. Today
required/optional is expressed only as a rendering rule — `hostText(value) === null` draws nothing —
which is the renderer deciding for itself, not a pack declaring anything.

### 3.2 What this means for the design

1. `public.tradition_packs` cannot be extended into the target shape by adding columns; the pack/release
   conflation is the defect. It becomes the identity table and `public.tradition_pack_releases` becomes
   the content object a wedding chooses. Nothing about a release is editable once it is approved, because
   an approved release's *content* is guarded and a change means a new row.
2. Selection must stop pointing at "a row in a table with a status column" and start pointing at a
   release, with the **approval enforced at the moment of selection** — a trigger on `weddings`, not a
   read filter in the picker. That is the fix for the measured draft/deprecated hole, and it is testable
   as an attack rather than as a UI rule.
3. Freezing must copy the pack-provided content into the snapshot, because §11's guarantee is a
   content-preservation guarantee. A label cannot provide it.
4. The `weddings.tradition_pack_id` and `invitation_versions.tradition_pack_id` columns are replaced, not
   kept alongside their replacements. Two columns meaning "the pack this wedding uses" — one enforced,
   one not — is compatibility theatre, and the unenforced one is the one today's code writes. The tables
   hold 0 rows today, so this is a forward migration over an empty catalogue, not a data move; historical
   migrations are not rewritten.
5. `users_read_platform_packs`'s `status IN ('draft','approved')` was a Stage 2 decision with a stated
   reason (a migrated legacy template has never been reviewed and a picker that hides drafts would go
   blank). For **tradition packs** that reason does not hold: the table is empty, and §9 asks for the
   opposite. Tightening is safe for the existing battery because its pack assertion is `count <> 0` on a
   seeded **approved** pack, which stays true; the design_templates half of that policy is deliberately
   not touched, because its reason still holds there.
6. `draft` must become unselectable and unreadable through a browser role, `reviewed` must be a real
   state (it does not exist today at all — the CHECK only allows `draft`, `approved`, `deprecated`), and
   machine assistance must be a declared column rather than a phrase in `review_notes`.

## 4. Target decisions taken from the gap

Two tables, not ten. `public.tradition_packs` keeps identity only — `pack_key`, display name, the scope
statement, timestamps. `public.tradition_pack_releases` is the object a wedding chooses: a
`release_number` unique within its pack, one of four lifecycle statuses, the languages it covers, its
definition as JSON under a versioned schema with database CHECKs, and its provenance (author, machine
assistance, reviewer label and stated basis, per-language review scope, source reference, changelog) as
columns rather than prose. Provenance is columns because §18 asks questions of it, and a `text` column
cannot answer "which languages did this review actually cover".

**No reviewer accounts.** `reviewed_by` stays available as an optional FK, but the required metadata is a
reviewer *label* and a *qualification statement*, because a reviewer who is not a customer of this
product must still be creditable, and because a login-shaped reviewer is the beginning of an approval
workflow this stage was told not to build.

**Immutability is a trigger, not a convention.** Once a release is `approved`, its definition, languages,
machine-assistance declaration, scope and provenance cannot change; the only legal writes are a
lifecycle transition along `draft → reviewed → approved → deprecated`, and a transition can never move a
release backwards out of `approved` into an editable state — the biconditional that today makes
demotion awkward becomes the thing that makes it impossible. A release that has ever been approved cannot
be deleted, and any release referenced by a wedding or a version cannot be deleted. A changed pack is a
new `release_number`, and the release number that was frozen is the only answer to "what did this guest
read".

**Selection is pinned to a release and gated at write time.** `weddings.tradition_pack_id` and
`invitation_versions.tradition_pack_id` are replaced by `tradition_pack_release_id`, and a `BEFORE INSERT
OR UPDATE` trigger on `weddings` requires the referenced release to be `approved` at the moment the
reference is written. This is the repair for the measured hole in §3.1, and it is deliberately *not* a
UI rule: the picker will also hide everything unapproved, but the trigger is what makes the property
true when someone bypasses the picker, which is what the attack suite will do.

**Freezing copies content, not labels.** `private.build_invitation_snapshot` resolves the chosen release
for the wedding's language and writes the resulting ordered section list — pack-provided wording,
host-provided data, and the provenance of each — into the snapshot. A guest then renders what was frozen,
and §11's byte-for-byte test becomes a statement about content rather than about three copied strings.

**Language fallback is explicit and total.** A release declares the languages it covers; resolving a
section for `ta` returns the Tamil text or, if the pack declared that section's Tamil as absent-but-
allowed, the English text *marked as a fallback*, or otherwise nothing plus a validation issue in the
host's preview. An English string never becomes a Tamil string by silence.

**Content is authored through a server-only path, never through a migration seed and never through a
browser role.** `internal_api` gains the maintenance functions (create a draft, propose review, approve
with metadata, deprecate); they are `SECURITY DEFINER`, owner-only `EXECUTE`, in the schema PostgREST
does not serve, with no `api` wrapper on top — unlike Stage 3's seven publication functions, there is
nothing a customer is allowed to call here. The Tamil + English candidate's wording lives in a source-
controlled file and reaches the database only through that path, so no deployment of these migrations
receives unaudited ceremonial text. The synthetic approved fixture for tests lives only in the test
harness and is created inside a transaction that goes away.

**The renderer is handed sections.** `InvitationRenderer` receives an ordered, already-resolved list from
a pure function over the snapshot, and draws each one with no knowledge of why it is in that position.
The section vocabulary is a fixed, versioned enum: an unknown key is skipped *and* surfaced as a
validation issue rather than crashing a guest's page, because the alternative — a published invitation
that fails to render because content was corrected afterwards — is the worse failure. A required section
that is absent is a host-preview problem, and an optional one draws nothing.

## 5. Migration strategy

One forward file:
[`20260927120000_stage4_tradition_pack_releases.sql`](../../supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql),
1598 lines, timestamped after Stage 3's two closure repairs so it applies last on both chains.
`ls supabase/migrations/*.sql | wc -l` → **18**. No historical migration was edited; `git status`
shows the four Stage 4 test-suite files and the new adapter modules, and no file under
`supabase/migrations/` other than this one.

The three decisions that shaped it, each with the reason rather than the result:

* **Replace, do not keep alongside.** `weddings.tradition_pack_id` and
  `invitation_versions.tradition_pack_id` are *renamed* to `tradition_pack_release_id` and re-pointed at
  the new table (`:677-688`), not left beside a new column. Two columns meaning "the pack this wedding
  uses" — one gated, one not — would leave the ungated one as the one code writes, which is the defect
  §3.1 measured. Dropping them is safe here only because both tables held 0 rows: the file says so at
  `:18-21` and `30_migration_legacy.sql`'s outcome suite proves the migration path invents no pack row.
  **This is a fail-loud design, not a supported data move.** A database whose `tradition_packs` already
  held rows would stop on `ADD COLUMN scope_statement text NOT NULL` (`:66`) rather than have this file
  invent a scope statement for content nobody wrote. No such database exists — the hosted project was
  never touched (§29) and every local chain in this stage's evidence starts from zero rows — and §31
  records that consequence as a limitation instead of pretending the migration is general.
* **What each layer is for, and only for.** The file's own header (`:28-38`) assigns the work: table
  CHECKs for row shape, a guard trigger for the shape of a *change* (a CHECK cannot see `OLD`), a
  selection trigger for the difference between "visible" and "choosable", grants and RLS for what a
  browser role may read. The split is why the same rule appears in exactly one place: approval is
  enforced at selection *and* at freeze, because those are two different moments and §18's ruling A1
  asks for a different claim at each (see §7 and §8).
* **Two chains, both to head.** `bash supabase/tests/stage2/run.sh both` and
  `bash supabase/tests/stage4/run.sh` each build a clean chain and a legacy-fixture chain, ending at
  this migration, because a lifecycle rule that only holds on an empty catalogue is not a rule.
  The Stage 4 battery then runs *last* in its own runner, and `run.sh` says why at its `:6-14`: an
  approved release cannot be deleted, so any suite that counted catalogue rows after the battery would
  be counting the battery's rows.

Applied for real to this repository's own local Supabase database with
`npx supabase db reset --local --no-seed` before the HTTP battery ran — that command is the only way
this stage's schema reaches a running PostgREST, and `supabase link`, `db push`, `db pull` and
`db reset --linked` were never executed (§29).

## 6. The pack and release DDL

`public.tradition_packs` becomes the concept and holds six columns (`:56-73`): `id`, `pack_key`,
`display_name`, `created_at`, `updated_at`, and the new `scope_statement text NOT NULL` bounded by
`tradition_packs_scope_statement_length CHECK (length(btrim(scope_statement)) BETWEEN 20 AND 2000)` —
a *minimum* length, because the column exists to stop a pack being read as an endorsement and "n/a"
would satisfy a non-blank check while saying nothing. `revision`, `status`, `supported_languages`,
`structure`, `reviewed_by`, `reviewed_at` and `review_notes` are dropped from it; `UNIQUE (pack_key)`
replaces `UNIQUE (pack_key, revision)`, and `tradition_packs_pack_key_slug`
(`pack_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]*)*$'`) is what §17's fixture naming collision is measured
against.

`public.tradition_pack_releases` (`:92-171`) is the review unit — **22 columns**, of which a customer
can read 7 (§9):

| Group | Columns |
| --- | --- |
| identity | `id` PK, `pack_id → tradition_packs(id) ON DELETE RESTRICT`, `release_number` with `CHECK (release_number > 0)`, `UNIQUE (pack_id, release_number)` |
| lifecycle | `status IN ('draft','reviewed','approved','deprecated')`, `approved_at`, `deprecated_at`, `reviewed_at`, `reviewed_by → auth.users(id) ON DELETE SET NULL` |
| content | `definition_schema_version` (`> 0`; the guard accepts only `1`), `definition jsonb` (`CHECK (jsonb_typeof(definition) = 'object')`), `languages text[]` (`cardinality > 0` and `<@ {en,ta,te,ml,kn}`) |
| authorship | `author_label` (3–300 chars), `machine_assisted boolean`, `machine_assistance_notes` (20–2000 when present) |
| review record | `review_label`, `review_basis`, `review_scope` (each length-bounded), `reviewed_languages` with the named `reviewed_languages_are_supported_ones CHECK (… <@ languages)` |
| provenance | `source_reference`, `changelog` |
| timestamps | `created_at`, `updated_at` |

Four named invariants carry the governance weight, and they are named precisely so a battery can
assert on them without the name retargeting itself when a column is added above
(`:155-157` records that reason):

* `machine_assistance_disclosure_required` — `machine_assisted = false` **or** a ≥ 20-character
  disclosure. The biconditional is asymmetric on purpose: `false` beside a note is harmless, `true`
  with nothing to say about it is the hollow tick box §7 forbids.
* `draft_carries_no_review_metadata` — enforces the *absence* of review metadata in `draft`, which is
  what stops "approved" being reachable by an edit that quietly fills in a reviewer.
* `review_metadata_is_mandatory` — `reviewed`, `approved` and `deprecated` all require label, basis,
  scope, covered languages and a review timestamp. A release cannot be approved on the strength of a
  status change alone.
* `approved_at_matches_status` and `deprecated_at_matches_status` — biconditionals, so a row that has
  ever been approved carries the evidence of it forever, which is what turns §7's forward-only rule
  from a trigger convention into something a `CHECK` would catch even if the trigger were dropped.

`CREATE INDEX tradition_pack_releases_pack_status_idx (pack_id, status)` (`:173`) exists for the one
query the picker actually issues; it was not measured against data, because the only databases that
have rows are the batteries' own, and §31 says so rather than quoting a plan.

## 7. The lifecycle

`draft → reviewed → approved → deprecated`, one edge at a time, enforced by
`private.guard_tradition_pack_release()` (`:200-650`) — `SECURITY INVOKER`, deliberately self-contained
so it calls no other `private` function (`:195-199` explains that a nested call would be
privilege-checked against `service_role`, which holds nothing in `private`).

Measured refusals, each produced by a statement in `supabase/tests/stage4/50_pack_release.sql`'s `L`
group rather than asserted by reading the code:

* a row cannot be **born** `reviewed`, `approved` or `deprecated` (`:238-245`) — content and review
  metadata arrive together through a legal step, not in one `INSERT`;
* the four backwards steps are refused by name, including `approved → draft` and `approved → reviewed`
  (`:565-580`), which is reviewer ruling A2's "un-reviewing would either leave a review claim on
  wording nobody read or silently destroy the record of what was read";
* `draft → reviewed` must say **when** (`:583-590`);
* `reviewed → approved` may not restate the review record (`:592-604`) — the row approved is the row
  that was reviewed;
* `approved → deprecated` is the only legal exit from `approved`, and it too may not touch the review
  record (`:606-615`);
* a `DELETE` of a release that has left `draft` is refused (`:220-237`), and §17's fixture tooling
  proves the only eraser left is `ROLLBACK` (see §17 below).

A mistake is corrected by a new `release_number`. That is the whole design: the only correction that
can never retroactively change what a guest already read.

## 8. Immutability

The guard's content freeze is at `:536-562`, and the detail that makes it work is what the compared
tuple **excludes**: `status`, the review metadata, the three lifecycle timestamps and `updated_at` are
absent, because those are exactly what a legal lifecycle step must write, and `set_updated_at` fires on
every `UPDATE` — including it would make every legal step look like a content edit. So the compared
tuple is the content-and-provenance half, and once `OLD.status <> 'draft'` any change to it is refused
naming `pack_key`, `release_number` and `status`.

`LC` group measures the guard on a row the battery owns and reads every refusal back through both
hashes of the definition, so a refusal that also wrote half of itself cannot pass — the failure mode a
`RAISE`-only test has. The same group shows a legal `draft → reviewed` step moving `updated_at` without
tripping the content rule, which is the case the exclusion above exists to handle.

Three more edges, all triggered rather than conventional:

* `no_client_write_tradition_pack_releases` / `no_client_delete_tradition_pack_releases` reuse
  Stage 2's `private.reject_client_write()` / `reject_client_delete()` (`:658-666`) instead of
  restating them, so the role name in the refusal stays the measured one.
* `tradition_pack_release_guard` fires **last** of the three alphabetically (`:669-672`): a
  browser-role write is answered by "the role may not write this table", not by a content complaint
  that describes a row it should never have been able to attempt.
* Nothing was built that could bypass these. There is no admin RPC (§10), so the only path that can
  write a release is a trusted maintenance session — and the guard runs for it too, because it is
  `SECURITY INVOKER` and takes its privileges from whoever issued the statement, not from itself.

## 9. Grants and row security

The privilege decision is the sharpest thing in this stage, and it is a **column** grant
(`:1551-1555`):

```sql
REVOKE ALL ON public.tradition_pack_releases FROM PUBLIC, anon;
REVOKE ALL ON public.tradition_pack_releases FROM authenticated;
GRANT SELECT (id, pack_id, release_number, status, languages, definition,
              definition_schema_version)
  ON public.tradition_pack_releases TO authenticated;
```

Seven of twenty-two columns. The reviewer label, the review basis and scope, the covered languages,
`reviewed_by`, `reviewed_at`, `author_label`, `machine_assisted`, `machine_assistance_notes`,
`source_reference`, `changelog`, `approved_at` and `deprecated_at` are **not grantable** to a browser
role — a future mistake that widens RLS cannot make them readable, because there is no privilege to
which a policy could apply. That is the difference between hiding a column and not having a right to
it, and it is asserted, not described: `40_catalog.sql` **C12** compares the set of tables holding
table-level `SELECT` for `authenticated` against the 19 `public` tables minus
`tradition_pack_releases`, and **C12b** asserts the exact seven-column projection.

Two policies, one on each table (`:1573-1587`):

* `users_read_approved_and_own_retired_pack_releases` — `status = 'approved'`, **or** a
  `deprecated` release that one of the caller's own weddings still points at. The second half is
  ruling A1's historical-visibility requirement, and it is what lets the editor say "the pack you
  chose has been retired" instead of showing a blank where a choice used to be. `FRZ-06b` qualifies
  it over HTTP: the retired release stays readable to its owner and to nobody else.
* `users_read_packs_with_approved_releases` — a concept row is visible only once it has something to
  choose, so a name and a scope statement cannot be read as a promise.

The widening cannot leak an unpublished release, and that is structural (`:1566-1572`): the selection
gate refuses anything not approved at the moment of selection, so the only releases a wedding can ever
point at are ones that were approved once. `CAT-05` and `CAT-06` measure it from the browser's side:
a pack whose only release is a draft is invisible, and so is the release; a retired release is not
offered, and a pack left with nothing to choose goes with it.

`anon` holds no table privileges anywhere, and `CAT-01` proves the anonymous refusal is the grant
layer rather than the transport, with a control that would fail if it were not. `design_templates`
keeps its old `status IN ('draft','approved')` read policy — deliberately, for the reason Stage 2
gave and §3.2 restated (`:1593-1598`).

## 10. The maintenance surface, and what was refused

**There is no maintenance RPC.** §4 above sketched one ("`internal_api` gains the maintenance
functions"), and the design that shipped does not have it. The file records the refusal at
`:42-47`: directive §9 says not to expose maintenance functions to make tests convenient, an
`internal_api` maintenance function would be unreachable over HTTP anyway, and every guarantee such an
RPC would add is already in the guard trigger. So content authoring stays a privileged table write
governed by those triggers, and **the exposed `api` surface is still exactly Stage 3's seven
publication wrappers** — which `CAT-08` pins by name against the live PostgREST catalogue, with the
assertion's own message saying why the list exists: "adding one without a ruling is exactly what this
list is for".

The honest consequence, stated as plainly as it should be: **creating, reviewing, approving or
deprecating a release is not something this build offers anyone.** It is a `psql`-level write by a
trusted role. `60_reviewed_fixture.sql` performs it (step by step, `service_role` for content and
`authenticated` for the host's own selection and freeze, never as superuser), and `docs/content-review/`
documents what a human would have to do. That is a deliberate Stage 4 boundary — the alternative was
the admin console the directive forbids — and §31 lists it as a limitation rather than a feature.

No definer function was created. `40_catalog.sql`'s definer inventory still measures **9** `SECURITY
DEFINER` functions outside `pg_catalog`: Stage 3's seven `internal_api` publication bodies plus
`private.handle_new_user` and `private.attach_draft_on_wedding_create`. Stage 4's eleven new or
rewritten functions — `guard_tradition_pack_release`, `require_approved_pack_release`,
`require_frozen_pack_release`, `default_invitation_definition`, `pack_text_for`,
`resolve_invitation_sections`, `invitation_freeze_issues` (seven created) and
`build_invitation_snapshot`, `public_invitation_dto`, `internal_api.create_invitation_version`,
`internal_api.preview_invitation` (four rewritten) — are all `SECURITY INVOKER`, and the posture was
read from `pg_proc.prosecdef`/`proconfig`/`proacl`, not from the DDL text.

## 11. The definition schema

`definition jsonb` is not free-form. The guard walks it key by key (`:260-535`) and the `D` group of
`50_pack_release.sql` refuses each rule on its own, beside an accepted control that proves the guard
is not simply refusing everything — the failure mode a "rejects bad JSON" test has.

* Top-level keys are a closed set: any key outside `sections`, `event_vocabulary`, `design_guidance`
  is refused by name (`:272-276`), so a definition cannot carry a field this build would silently
  ignore. `definition_schema_version` must be exactly `1` (`:261-266`): a build that does not know a
  contract refuses to resolve it instead of guessing at half of it.
* `sections` must be a non-empty array of objects with a closed key set (`:287-308`).
* `section_key` must be one of **eleven** slots — `opening, welcome, family_introduction, family,
  couple, invitation, ceremonies, venue, event_notes, blessing, closing` (`:324-326`) — and unique
  within the release. The same list lives in `src/lib/traditionPackContract.ts:37` as
  `PACK_SECTION_KEYS`, and `scripts/check-db-contract.mjs:599` compares the two by reading the SQL
  literal itself, so the client vocabulary and the database vocabulary cannot drift apart quietly.
* `position` must be a number, and the positions must be **dense from 1** (`:338-347`): a release with
  a hole in its ordering is a release whose author meant something by it, and the build refuses to
  guess. The comment states the pigeonhole argument rather than restating a loop.
* `kind` ∈ `text | people_list | event_list` (`:348-355`), at most one of each list kind, and the
  counters are per-kind — `:391-396` records the bug that exclusion created first: a shared counter
  let a release declare two `people_list` sections as long as they used the accepted `family` and
  `couple` keys. Only `text` may carry `pack_text`, and only `text` may read a `host_field`.
* `host_field` ∈ the four draft slots (`welcome`, `family_introduction`, `event_notes`, `closing`) and
  no two sections may read the same one (`:398-406`), because two sections drawing one sentence is a
  bug dressed as content.
* `heading` and `pack_text` are objects of language keys, every language declared by the release,
  each value a non-empty string under 4000 characters (`:424-470`). A `text` section with no heading,
  no reviewed wording and no host field is refused — a section that says nothing is not a section.
* `allow_english_fallback` must be a boolean, and may only be set `true` for a language the release
  actually claims (`:408-422`): a pack covering Tamil alone cannot fall back to English it never
  declared.
* `event_vocabulary` is an array of at most 50 entries, each a slug `event_key` plus label strings,
  with no unknown keys (`:472-505`). It is validated as a **shape** and is never rendered — §7 of
  `docs/architecture/domain-model.md` records that consequence, and §31 records it as an unfinished
  edge rather than a finished one.
* `design_guidance` is an object of a closed key set with ranges (`lead_size` 8–72,
  `motif_reference` a short string) (`:507-530`).

**The NULL trap, because it is the most transferable finding in this stage.** Four of these rules were
written as `jsonb_typeof(key) <> 'array'` and were therefore *silently true of an absent key*:
`jsonb_typeof(NULL)` is NULL, `NULL <> 'array'` is NULL, and `IF` treats NULL as false. A section that
omitted `position` entirely passed the rule named "section % has no numeric position", and a definition
with no `sections` key passed the rule that requires one. Every such test is now
`key IS NULL OR jsonb_typeof(key) <> 'X'`, and `50_pack_release.sql` re-probes each of the four absence
cases so a later edit cannot quietly restore the bare form. The migration says this at `:278-286`; it
is recorded here as well because it is a class of defect, not a Stage 4 detail.

## 12. Language resolution

`private.pack_text_for(node, requested, allow_english_fallback)` (`:842-878`) returns
`{text, language, fallback_used}` or NULL, and there are exactly three answers it can give:

1. the requested language's own string — `language = requested`, `fallback_used = false`;
2. English, **only** if the section declared `allow_english_fallback` and the requested language is
   not `en` — `language = 'en'`, `fallback_used = true`;
3. NULL. Never a silent substitution.

`private.resolve_invitation_sections(definition, requested, draft)` (`:888-962`) walks the sections in
`position` order, calls that helper for the heading and the body, reads the host's own slot when the
section names one, and emits the resolved array. The host's text wins over pack text (`:923-926`) and
records `overrode_pack_text` so the fact survives; a section whose heading exists but whose body
resolves to nothing is emitted with `body_text: null` rather than dropped, because dropping it would
hide the very gap the preview has to name.

Measured by `B` group in SQL (Tamil served when present; English only when declared; neither when not),
by `FRZ-05` over HTTP (cases 25, 26, 27, 28 — "the two ways a missing translation answers"), and by
24 tests in `src/test/invitationSections.test.ts` plus 25 in `traditionPackResolver.test.ts` on the
client's mirror of the same rules. **No assertion in any of them measures how a Tamil string is
spelled.** What is qualified is the resolution mechanism; the content that would flow through it is
placeholder (§16), and §31 states that no native speaker has reviewed anything.

## 13. Provenance and overrides

Every resolved section carries its own provenance rather than the document carrying a banner:
`body_source ∈ {host, reviewed_pack}`, `body_language`, `body_fallback_used`, `overrode_pack_text`,
plus the heading's matching triple (`:936-960`). Three properties follow, each with a test that names
it:

* **A host's sentence is not presented as a reviewed one.** `FRZ-03` (case 24): replace a reviewed
  section's wording and the snapshot says `host`, "not a blend". There is no merge, so there is no
  mixed attribution to defend.
* **A pack sentence is not presented as the host's.** `FRZ-02` (cases 18, 23): an untouched section
  resolves `reviewed_pack`, and the release it came from is named by `pack_key` + `release_number`.
* **A guest is not shown the review record.** `GST-01` (case 25) asserts the guest document carries no
  reviewer, authorship, machine-disclosure or maintenance field. The DTO's pack credit is exactly three
  fields — `pack_key`, `display_name`, `release_number` — which §21's render evidence re-measures in
  the shipped page. What the guest sees that *is* provenance-adjacent is the pack's `scope_statement`
  beside the credit, so the boundary travels with the name rather than sitting under it.

The snapshot keeps the fuller record (`author_label`, `review_label`, `reviewed_languages`,
`machine_assisted`, `source_reference`, `scope_statement`, §14), so "who said this was reviewed, and
about what?" is answerable from a frozen document years later — and `public_invitation_dto` chooses
not to send it to a stranger.

## 14. The snapshot contract

`private.build_invitation_snapshot` (`:1072-1158`) now writes `snapshot_schema_version = 2` and, beside
the Stage 3 blocks (`wedding`, `design_template`, `draft`, `people`, `venues`, `events`), two new ones:

* `tradition_pack_release` — `pack_key`, `display_name`, `scope_statement`, `release_number`,
  `definition_schema_version`, `languages`, `machine_assisted`, `author_label`, `review_label`,
  `reviewed_languages`, `source_reference`; written as one `CASE WHEN r.id IS NULL THEN NULL`, so a
  wedding with no pack freezes **no release block at all** rather than an object of nulls. `FRZ-01`
  (case 17) measures that, and it matters because a null-valued block reads as "there was a pack and
  it said nothing".
* `sections` — `{requested, items}`, where `items` is the resolved array from §12. `requested` is the
  wedding's `primary_language` *as frozen*, which is what makes the fallback flags interpretable
  afterwards.

The release the version names is recorded, never chosen: `private.require_frozen_pack_release()`
(`:752-796`, trigger `versions_pack_release_gate` at `:796`) first requires equality with the wedding's
current selection — "a version may only record the release its wedding currently selects"
(`check_violation`) — and only then requires `status = 'approved'` (`insufficient_privilege`, `42501`).
The order is deliberate and explained at `:771-774`: a mismatch is a wrong *row*, a wrong status is a
right row in the wrong moment, and a caller who gets the first message has one thing to fix. Read as
the calling role, an unapproved release is *not readable*, so a customer's refusal says
`this one is not readable by this role` while the trusted path that can read it is refused by its real
status — measured both ways by `FRZ-04`, `FRZ-06` and §22's case B.

Freeze also refuses an unresolved document: `private.invitation_freeze_issues` (`:986-1051`) runs over
the *resolved* snapshot — where a missing translation, a host override and a fallback rule have become
one answer — and `internal_api.create_invitation_version` raises
`this invitation cannot be frozen yet: <issues>` when the list is non-empty (`:1446-1450`). The two
issue sentences it can produce are "section X is required and has no wording in <language>, and the
release does not allow it to fall back" and "the invitation language <l> is not one of the languages
this release covers (…)". `F` group proves the refusal is the function's, not the UI's.

`private.public_invitation_dto` (`:1172-1393`) projects from that snapshot and refuses an unknown
`kind` rather than drawing half a document (`FRZ-07`, cases 22 and 30) — the deliberate exception to
"skip and warn", because at the guest boundary a wrong shape is a security-relevant surprise, not a
content nicety.

## 15. The renderer contract

`InvitationRenderer` takes the frozen document and nothing else. The section list passes through
`normalizeInvitationSections` in `src/lib/invitationSections.ts`, which:

* switches only on `kind` (`text`, `people_list`, `event_list`) and draws the heading, then the body,
  in the order it was handed — there is no `if (pack_key === …)` and no per-slot branch anywhere in
  the path, which is what §12's rule ("a pack's order is data") requires of a component;
* skips an unrecognised `section_key` or `kind` **and** records it in `issues` (`:30`, `:215-290`) —
  seven distinct issue kinds, each naming the section and the problem, so a guest's page degrades
  visibly to its host rather than crashing at a wedding;
* renders host text through the Stage 3 sanitising text path, so `GST-02` (cases 38, 39) can assert
  that hostile pack or host strings stay text and an unsafe link scheme does not survive the contract.

The preview canvas is the guest's renderer, not a picture of one (`src/pages/EditProject.tsx:6` states
that and the import graph supports it: the renderer has exactly the two callers it had in Stage 3).
`src/test/invitationRenderer.test.tsx` and `invitationSections.test.ts` pin the ordering, the skip-and
-warn behaviour and the issue list; §23 measures the same component in a browser at ten document
shapes.

## 16. The source-controlled candidate

[`content/tradition-packs/tamil-english-foundation.v1.json`](../../content/tradition-packs/tamil-english-foundation.v1.json)
(6127 bytes) — 11 sections, `languages: ["en","ta"]`, `release_number: 1`, and these fields verbatim:

```
"status": "draft", "human_reviewed": false, "customer_selectable": false,
"machine_assisted": true, "review": null
```

**Every Tamil value in it is a bracketed placeholder, not wording** —
`"[placeholder] opening body pending human review"`. That is the design, not laziness: the file's own
`machine_assistance_notes` says a model produced every string and no native speaker has checked any
Tamil value, and a placeholder cannot be mistaken for reviewed content or approved after the fact.
`source_reference` names the directive sections and the pinned vocabulary as its only inputs, and
states that no external text, scripture, community source or prior invitation was copied or
paraphrased.

It reaches the database **only** through the trusted write path of §10, and no migration or seed loads
it: `CAND-01` (§23) mints it through that path against the live stack, shows the authoritative guard
accepts it, and shows it stays invisible to a browser role because it is a draft. That test is the
half of the candidate's life that can be qualified; the human half is
[`docs/content-review/tamil-english-foundation-v1.md`](../content-review/tamil-english-foundation-v1.md),
whose own first line is "**Document status: a request for a human review that has not happened
yet.**" Every reviewer field in that file is blank on purpose, and its §6 records that no environment
holds the candidate as a row outside the transient `CAND-01` probe.

`src/test/traditionPackDraftCandidate.test.ts` (17 tests) reads the JSON file itself and pins its
honesty fields, so a later edit that flips `human_reviewed` or replaces a placeholder with real wording
fails a test before it fails a family.

## 17. The synthetic reviewed fixture

[`supabase/tests/stage4/60_reviewed_fixture.sql`](../../supabase/tests/stage4/60_reviewed_fixture.sql)
(668 lines, **57** assertions) is not an assertion battery; it *performs* the lifecycle that §8 of the
directive needs to exist wherever a later suite wants an approved release: create pack → draft release
→ populate a valid definition → mark reviewed with complete metadata → approve → select → freeze →
deprecate. Each step runs as the identity that owns it — `service_role` for content, `authenticated`
for the host's selection and freeze — never as superuser, so what is exercised is the sequence a real
release goes through rather than a privileged shortcut.

It manages its own transaction, and the reason is the stage's own immutability rule: an approved
release cannot be deleted, so §8's "ensure cleanup removes it" has exactly one honest mechanism left —
`ROLLBACK`. The file attempts the `DELETE`, records the refusal, and the queries *after* the rollback
compare the catalogue against counts remembered before it began, which proves the erasure rather than
asserting it. That is why `supabase/tests/stage4/run.sh` executes it **without**
`--single-transaction` while running `50_pack_release.sql` with it.

Four honesty strings, mandated by §8 and present in every fixture row: `pack_key`
`test_reviewed_fixture`, display name `TEST ONLY — Synthetic Reviewed Fixture`, reviewer label
`TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW`, qualification `Automated Stage 4 database
qualification only`.

**One recorded deviation from the directive's own spelling.** §8 writes the key as
`test-reviewed-fixture`, with hyphens, and the published
`tradition_packs_pack_key_slug` CHECK refuses a hyphen. Two ways out existed; loosening a published,
already-asserted constraint to fit a fixture's spelling is weakening a gate, so the fixture uses the
underscore form and step 0 *measures* the collision — it attempts the hyphenated spelling, shows it is
refused, shows it is refused by that constraint and no other, and shows it left no row. The deviation
is evidence in the run rather than a footnote.

## 18. API qualification over HTTP (directive §17)

`bash supabase/tests/api/run.sh` runs three files against this repository's own started stack and
prints one line per file: `stage3_publication` **37**, `stage3_security` **56**,
`stage4_tradition_packs` **28** tests, then a post-run ledger. `run.sh` refuses to start unless
`SUPABASE_LOCAL_URL` is a loopback host *and* its port matches the `[api]` port in this repository's
`supabase/config.toml`, and the Stage 4 file additionally asserts `PROJECT_ID === 'localvivaahvarnam'`
by name (`stage4_tradition_packs.test.mjs:105-108`) with the comment saying why: this suite writes
rows into a *persistent* local database, so it is the one place a mis-pointed project should be caught
by a string rather than only by a port.

The 40 numbered cases arrive as 28 tests in five groups:

| Group | Tests | What it holds |
| --- | --- | --- |
| `CAT-01`–`09` | 9 | the anonymous web is refused both catalogue tables with a control that distinguishes the grant layer from the transport; an approved release appears with its coverage and its pack appears *because of it*; the answer carries only the 7 readable columns; every reviewer/authorship/machine/maintenance column is refused **by name**; an unshipped pack and a retired release are invisible; a customer cannot write the catalogue at all, so review metadata cannot be forged; no maintenance function is callable and the exposed function list is pinned; the maintenance role reaches the catalogue and no browser role does |
| `SEL-01`–`06` | 6 | an owner points their own wedding at an approved release and it reads back; "no pack" is always legal; every non-approved release is refused with **one** sentence whatever the reason (draft, reviewed, absent); another user's wedding answers with silence, not a refusal; a reachable refusal names no table, column, schema or function; ruling A1 — not even `service_role` can newly point a wedding at a retired release |
| `FRZ-01`–`07` (+`06b`) | 8 | a no-pack freeze invents no release block; a freeze pins the release and marks reviewed wording `reviewed_pack`; a host replacement says `host`, not a blend; no HTTP route can freeze from a draft or a reviewed release; language resolution and the two ways a missing translation answers; a release retired after it was chosen refuses a *new* freeze and leaves the published one alone; the retired release stays readable to its owner and nobody else; the guest reads a frozen snapshot and an unknown section kind is a refusal rather than a half-document |
| `GST-01`–`03` | 3 | the guest document carries no reviewer, authorship, machine-disclosure or maintenance field; hostile text stays text and an unsafe link does not survive; identity and language fields never move a pack selection |
| `CAND-01` | 1 | the real draft candidate is accepted by the authoritative guard and stays invisible to a browser role |
| `LEDGER-01` | 1 | the fixture catalogue this run read and left behind, printed row by row |

**What the first run of this battery found, because the failures were the point.** `../.s4http.txt`
(19:24) is kept until §31 as the record of that run: seven tests red, and they split cleanly.

* A real product finding — `SEL-05`: a governance refusal arrived with PostgREST's repair `hint`,
  which quoted the table's own name *and* the `GRANT` statement that would open it
  (`Grant the SELECT, INSERT ON public.tradition_pack_releases TO authenticated`). That is the Stage 3
  §5.7 shape recurring at a new surface. The rule now asserts `hint === null` on every reachable
  selection refusal, and — rather than hiding the rest — measures the *grant* refusal separately: it
  does name the table, it names no column of the review record, and the test says plainly that no
  journey in the product asks a browser to write the catalogue, so that sentence is not copy a host
  sees.
* A real policy finding — `CAT-02`: "a retired release of a pack that has approved ones must not sit
  in the same answer", which is what tightened the deprecated-release half of §9's policy to
  owner-scoped rather than global.
* Instrument defects, fixed in the harness and not in the assertion: `CAT-04` issued a body on a GET
  (`TypeError: Request with GET/HEAD method cannot have body`); `CAT-08` compared a function list
  against a hand-written order and lost to the server's collation (the seven names were always the
  same set); `SEL-06` and `FRZ-07` failed inside `trustedSql`, whose multi-line `-c` statement reached
  `psql` through `docker exec` broken (`DETAIL: The input string ended unexpectedly`) — the same class
  of transport defect as §2D, one layer up. `sqlRows`/`trustedSql`/`trustedRefusal`
  (`:119-140`) are the repaired instruments, with `trustedRefusal` kept separate from `trustedSql` so
  "the gate fired" and "the row moved" stay two different observable outcomes.
* Fixture wording — `CAT-03` asserted a phrase from the scope statement that the fixture's own text
  had since changed, which is a test reading content rather than shape.

The re-run at 21:42 is green: 37 + 56 + 28, `==> RESULT: PASS`, with the runner's post-run ledger
confirming `weddings`, `auth.users` and `invitation_drafts` back to their starting counts and zero
orphan drafts. **What that ledger does not cover is disclosed:** it counts those three tables, not the
pack catalogue. Stage 4's fixture releases are deliberately persistent in the local development
database, because §8 makes an approved release undeletable — see §30 and §31.

## 19. The host selection UI

[`src/components/invitation/TraditionPackPanel.tsx`](../../src/components/invitation/TraditionPackPanel.tsx),
rendered inside `EditProject.tsx`, is a radio group over `listSelectableTraditionReleases()`: display
name, `release_number`, the languages it covers as labels, and the concept row's `scope_statement`
beside each option — the boundary travelling with the name rather than sitting under it. Two options
are worth naming because they are product decisions rather than markup:

* **"No tradition pack — write it yourself" is an option, not the absence of one** (`:26`, `:160-169`).
  Selecting it writes NULL, and `SEL-02` (case 10) proves NULL is always legal at the database too.
* **A failed write leaves the control where it was.** The radio is controlled by `selected`, so a
  refused update (`:107` comment) cannot leave the UI describing a state the row does not have; the
  adapter's own phrase is surfaced alone, following Stage 3's rule that the app does not re-narrate
  Postgres.

`src/integrations/supabase/traditionReleases.ts` is the fifth adapter module and the only writer of
`weddings.tradition_pack_release_id`: two reads (the `approved` catalogue; the wedding's current
selection, including the one retired release it may still point at) and one update, with the
`.select('id')` read-back at `:186` so "matched no row" is distinguishable from "wrote the wrong
thing". It never sends a reviewer, authorship or machine-disclosure column, because the role cannot
read them (§9) — the query shape is a consequence of the grant, which is what makes it hard to get
wrong by accident.

Pinned by 18 tests in `traditionPackPanel.test.tsx`, 22 in `editInvitationPage.test.tsx` and 15 in
`traditionReleases.test.ts`, all against the hand-written fetch double.

**Not claimed:** those two writes were **not driven through a browser against the live stack.** The
selection update was exercised over HTTP with a real JWT, including the 403 refusal of an unapproved
release (`SEL-03`), and the panel is unit-pinned against the double — but the attempt to click the
panel in a live browser session stalled on an instrument defect this stage could not diagnose (see
§31). Reporting the click as done would have made the matrix claim a capability the evidence does not
carry.

## 20. The no-pack path, end to end

A wedding with no pack is a supported product state, not a degraded one, and it is qualified at every
layer rather than assumed: `SEL-02` (selection), `FRZ-01` (freeze: the snapshot carries **no**
`tradition_pack_release` block and no invented release), `CASE A` of the render qualification
(`../.s4matrix.log` lines 13-19: the document resolves, no pack credit is present, its six sections
are the host's own four slots plus the two list sections, `every body it does carry is a sentence the
host wrote — host,host,host,host`, and no placeholder ceremonial wording reaches the guest), and
`[21] case A` in the shipped bundle (an article renders, no internal key or provenance string is
drawn, the heading order is the host's data and the renderer's own literals: `H1|Asha weds Bala /
H2|The groom's family / H2|The bride's family / H2|The ceremonies / H3|Muhurtham`, 437 characters).

## 21. The reviewed-fixture path, end to end

`CASE B` is the same journey with the synthetic approved release attached, and the measurements that
matter are the ones a pack-blind page cannot produce: the section order is the frozen release's own
(`opening,family,ceremonies` — three sections, because that is what the fixture declares), the
position written in the snapshot equals the list's, a section the host left alone reads
`reviewed_pack/welcome`, one the host wrote reads `host/true`, the fallback flag is `false` when both
languages are present, and the guest's pack credit is exactly
`{pack_key, display_name, release_number}` with `display_name` reading
`TEST ONLY — Synthetic HTTP Fixture`. `[21]` then draws the same document from the production bundle:
`H1|Asha weds Bala / H2|Opening / H2|Our families / H2|The groom's family / H2|The ceremonies /
H3|Muhurtham` — the two pack headings ("Opening", "Our families") arrive from the release's data,
not from a component, and 195 characters of text appear with no reviewer label, no release number in
the prose and no machine note.

That the order *changed* between CASE A and CASE B is the §12 claim measured rather than described:
the same host data, two different documents, because a row changed.

## 22. R1 → R2, deprecation, and what a guest keeps

The matrix's §22 block walks one wedding across a release retirement, with a real freeze and a real
guest link on the local stack:

| Step | Measured |
| --- | --- |
| V1 frozen from release 27 | snapshot 2365 B, sha256 `4801e20b…`; opening wording "…in the release that is about to be retired." |
| Approve release 28 | `C`: the wedding still points at `4952e4bc-…` — a newer release moving nothing is the difference between pinning and following |
| Deprecate release 27 | `A`: the guest link still resolves, and its answer is byte-identical (sha256 `29b50fdc…` before and after) |
| Freeze again from 27 | `B`: refused at the freeze gate — `403 42501 a new invitation version may only be frozen from an approved tradition pack release (this one is deprecated); a version already frozen from it is unaffected` |
| Select 28, freeze, publish | `D`: succeeds; the new version names release 28; the same credential is reused (`link_reused: true`); and re-selecting the retired release is refused with the same shape as any other non-approved release |
| Look back at V1 | `E`: byte-for-byte unchanged (`4801e20b…`), and the version row itself unchanged (`c1716f86-…|1|2026-09-28 15:45:07.131662+00`) |
| Read as the guest | `F`: now release 28's credit and 28's wording — "…in the release that replaces it." — and the document did change when the host re-published |

`D control` is the readable half of ruling A1 from the customer's side: selecting a retired release
answers `a wedding may only select an approved tradition pack release (this one is not readable by
this role)`, which is the *same sentence* a draft, a reviewed candidate and a nonexistent id all get
(`SEL-03`), so the refusal leaks nothing about which of the four situations the caller found.

## 23. The 10 shapes × 4 viewports render matrix

`scripts/stage4-render-qualification.mjs` drives the **production bundle** (`vite preview`,
127.0.0.1:4173) against the local stack. Its output is `../.s4matrix.log`; the summary line is
**`==> checks: 143, measurements: 33, findings: 0`** and `STAGE 4 RENDER QUALIFICATION: PASS`.

Ten document shapes × four viewports (360×740, 390×844, 768×1024, 1440×900), each asserting overflow,
clipping, host text escaping as markup, internal keys in the page text, unsafe link schemes, the
`lang` attribute, animation, and the drawn font size:

```
1-no-pack-minimal      2-no-pack-full        3-reviewed-tamil     4-reviewed-english
5-tamil-fallback       6-host-override       7-long-tamil         8-unbroken-english
9-mixed-script         10-hostile-markup
```

Selected measurements, all read from the log rather than retyped from a claim: zero horizontal
overflow and zero clipped elements in all forty cells; `1-no-pack-minimal` draws at **26px** where a
document that never chose a size would otherwise land at 16px, and `2-no-pack-full` draws the saved
30px lead at the clamped 30px with the saved alignment (`left`) and the saved colour (`#5c1a1b` →
`rgb(92, 26, 27)`) applied; `10-hostile-markup` confirms the store refuses a non-`https` venue map
link with `venues_map_url_check` (`23514`) before the page is ever asked to draw it (the fixture's
`map_url` is `javascript:alert(6)`, `scripts/stage4-render-qualification.mjs:365`). The four shapes
that carry Tamil code points are `3`, `5`, `7` and `9`, and the glyph evidence is theirs in that
order: for `3-reviewed-tamil`, **97 Tamil characters, 24 distinct, every one with a loaded Tamil
face** ("without a face=none"), 3 Tamil subset files loaded; for `5-tamil-fallback`, 62 characters,
21 distinct, none without a face; `7-long-tamil` 889/27 and `9-mixed-script` 84/25, both with no
code point left without a face. `72 declared · status {"unloaded":64,"loaded":8}` is
reported as a measurement, not an assertion — it is the font-loading race Stage 3's ADR 0006 records,
and the assertion is the narrower one about code points actually drawn.

Contrast is reported and **not** asserted, in the log's own words:
`contrast of the frozen colour on the paper — h1 12.17 · body 12.17 (ratio, reported not asserted)`.
Screenshots went to the OS temp directory (`stage4-render-HzrgTQ\shots\…`), and §31's cleanup removes
that scratch run tag's rows; the images are not committed.

The instrument writes wedding, release and credential rows into the **local** database for the
duration of a run and deletes them in teardown; the release rows it mints are the undeletable ones §31
discloses.

## 24. Cultural-safety checks

Six rules were added to `scripts/check-product-contract.mjs`, taking it from 17 to **23** rules over
the active tree, with `npm run product:check` printing **171 active file(s) scanned, 0 violation(s)**:

| Rule | Refuses | Scope |
| --- | --- | --- |
| `tradition-pack-identity-branch` | branching on `packKey` / `release_number` in application code (`===`, `!==`, `switch`) | `src/` |
| `tradition-selected-from-identity` | a line connecting `religion`, `caste`, `community`, `surname`, `gotra`, `family_name`, `mother_tongue`, `primary_language` or `additional_languages` to a pack selection | `src/` |
| `identity-tested-by-name-shape` | inspecting the *shape* of a name (`surname.startsWith(…`, `.includes(`, `.split(` …) | `src/` |
| `language-gated-rite` | gating ritual/ceremony/priest behaviour on a language comparison | `src/` |
| `ceremonial-authority-claim` | "authentic/verified/official/traditional" beside tradition/ritual/ceremony wording | `src/`, `index.html`, `README.md`, `content/` |
| `draft-candidate-claimed-shippable` | `human_reviewed: true` / `customer_selectable: true` anywhere, or prose claiming the candidate was reviewed | `src/`, `index.html`, `README.md`, `content/` |

The last two scopes include `content/` deliberately: the candidate file is the artifact most likely to
be edited into a false claim, and the rule that catches it must be able to read it.
`scripts/product-contract.test.mjs` (now **14** tests, green in 2.39 s) feeds each rule a hostile line
in its self-test — `option.packKey === "tamil_english_foundation"`,
`wedding.tradition_pack_release_id = suggestRelease(host.community)`,
`person.surname.startsWith("Reddi")`,
`if (language === "ta") body = "The priest will confirm the auspicious time"`,
`<p>An authentic Tamil tradition for your invitation.</p>`,
`{ "human_reviewed": true, "customer_selectable": true }` — and asserts the detected rule set equals
the whole rule list, so a new rule with no fixture cannot pass.

Alongside it, `scripts/domain-contract.test.mjs` scans column, table and constraint *names* for
caste/community/religion/ethnicity/sect vocabulary with a hostile control set it must catch and a
near-miss set it must leave alone; Stage 4 extended both lists (see §24's neighbour in
`docs/architecture/domain-model.md` §7). The near-miss half is what keeps the matcher honest: a
matcher that treats `sect` as a substring of `section` reports violations that do not exist, and would
have reported this stage's own `section_key` as a finding.

**What no checker can do, stated here because the matrix is the kind of document that invites it:**
these rules catch named patterns. A claim that overstates what a table does, or wording that is
culturally wrong without using any forbidden word, is out of their reach and is why §16's review
artefact and §31's limitation list exist.

## 25. Tests, old and new

No count below replaces another. Each line is the same instrument, run at the branch's start and at
its head, and where a total moved the reason names the file that grew.

| Instrument | Before Stage 4 | At Stage 4 head | Why it moved |
| --- | --- | --- | --- |
| `npm test` (vitest, whole tree) | 189 tests / 18 files | **355 tests / 24 files**, three times over: the §30 plain run, a `--reporter=json` run of the same tree used for the per-file breakdown, and a re-run after this stage's final documentation edits | six new files contribute 137 (`traditionPackDefinition` 38, `traditionPackResolver` 25, `invitationSections` 24, `traditionPackPanel` 18, `traditionPackDraftCandidate` 17, `traditionReleases` 15); the rest of the growth is inside suites that already existed — `invitationRenderer.test.tsx` now 31, `editInvitationPage.test.tsx` 22, `publicInvitationShape.test.ts` 17, `product-contract.test.mjs` 14, `weddingQueries.test.tsx` 13, `db-contract.test.mjs` 8, `domain-contract.test.mjs` 11 |
| `npm test` after §2's prelude | 191 / 18 | — | the two `checkGeneratedTypesEof` cases §2B added |
| Stage 0 RLS battery | 24 | **24** | unchanged, and that is the result: Stage 4 did not touch the archived-scaffold boundary |
| `stage2/30_migration_*.sql` | 41 (clean) / 75 (legacy) | **42 / 76** | one more table in the inventory floors the outcome suite asserts on |
| `stage3/20_draft_invariant.sql` | 46 / 49 | **46 / 49** | untouched |
| `stage3/30_publication.sql` | 269 / 269 | **284 / 284** | the `api` surface inventory re-asserted against Stage 4's function set; the seven names are still all of `api` (§10) |
| `stage2/20_attacks.sql` | 325 / 325 | **464 / 464** | Stage 4's privilege contract written out slot by slot: catalogue writes, forged review metadata, selection of every non-approved state, the column-grant edge |
| `stage2/40_catalog.sql` | 94 / 94 | **103 / 103** | C12/C12b (the column projection), the definer and `search_path` inventories, the new policy and trigger names |
| **Stage 4's own SQL** (`supabase/tests/stage4/run.sh`) | did not exist | **426** document assertions + **57** fixture-tooling assertions, per chain, printed apart from Stage 2's five | `50_pack_release.sql` groups `BASE/L/P/LC/D/S/B/V/F/C/A/I/T`; the totals are deliberately never joined to Stage 2's |
| HTTP (`supabase/tests/api/run.sh`) | 37 + 56 | **37 + 56 + 28** | `stage4_tradition_packs.test.mjs`, 40 numbered cases (§18) |
| Render qualification | Stage 3's own instrument | **143 checks, 33 measurements, 0 findings** | `scripts/stage4-render-qualification.mjs` (§23) |
| `dbtypes:check` | 17 migrations / 18 public tables | **18 migrations**, 19 `public` + 10 non-client tables, 29 column groups | one migration, one table |
| `product:check` | 17 rules / 154 active files | **23 rules / 171 active files, 0 violations** | six cultural-safety rules (§24) and fifteen new files; the file count is an output of the scanner, not a target — `docs/architecture/domain-model.md` §10 records the two files this stage deleted and the ones it added |

**Why the unit total is 355 and not the 354 an earlier draft of this table carried.** A full run at
21:47 printed 354; the widened `canonical-table-read-outside-the-adapter` table list (§24's neighbour
change) landed at 22:05 and took `product-contract.test.mjs` from 13 tests to 14. §30's clean battery is
the run this table quotes, so the row carries its number and the reason for the one-test difference is
written out rather than quietly renumbered. No other total in the table moved between those runs, and no
instrument that did not grow has been given a bigger number: every SQL, HTTP and checker figure below
was re-printed by §30's post-`npm ci` runs and matched what §25 originally recorded.

Two arithmetic reconciliations a reader should be able to check without running anything. **Policies:**
the live database at head has 45 policies in `public` (`select count(*) from pg_policies where
schemaname = 'public'`), and this migration is the only one that touches a pack policy — it creates 2
(`20260927120000_stage4_tradition_pack_releases.sql:1573` on `tradition_pack_releases`, `:1584` on
`tradition_packs`) and drops 1 (`:54`, `users_read_platform_packs`), so a chain stopped one migration
earlier prints 44. The table it dropped was the only pack policy Stage 2 wrote
(`20260925120500_stage2_rls_and_grants.sql:348`), and Stage 3's two closure migrations add and remove no
pack policy, so nothing in that count is owed to Stage 3. **Definers:** the `SECURITY DEFINER` population
is still **9** across `public`, `private`, `api`, `internal_api` and `legacy` even though this stage
shipped eleven functions — because all eleven are `SECURITY INVOKER` (§10). Both facts are asserted by
`40_catalog.sql`, and both numbers above were re-measured on the running local database rather than
carried over from an earlier draft.

### 25.1 The final clean battery, re-printed after `rm -rf node_modules && npm ci`

The directive's last step is a clean run of every gate, and it asks for old and new counts side by side
rather than the bigger number alone. "Branch start" is `b4b2022` as measured in §1; "clean head" is the
run below, taken after the dependency tree was deleted and rebuilt from `package-lock.json` (npm 11.19.0,
node v24.21.0, Vite 6.4.3, esbuild 0.25.12 resolved from the lockfile). Every line exited 0 unless the
column says otherwise.

| Gate | Branch start | Clean head | Note |
| --- | --- | --- | --- |
| `npm run lint` | 0 errors | **0 errors, 8 warnings**, exit 0 | all eight are `react-refresh/only-export-components` in `AuthProvider.tsx` and seven `src/components/ui/*` files; none is a file this stage added or edited |
| `npm run typecheck` | clean | clean, exit 0 | `tsc --noEmit -p tsconfig.app.json`, no output |
| `npm run dbtypes:check` | 17 migrations / 18 `public` tables | **18 migrations / 19 `public` + 10 non-client tables / 29 column groups, 0 findings** | the same one migration and one table §25 quotes, re-printed |
| `npm run product:check` | 17 rules / 154 active files | **23 rules / 171 active files, 0 violations** | 171 is what the scanner finds on the active tree today; it is an output, not a target |
| `npm test` | 189 tests / 18 files | **355 tests / 24 files, 0 failed**, 26.07 s | per-file breakdown in §25's first row |
| `npm run build` | `index` 489.05 kB / 147.24 kB gzip (Vite 5) | **`index` 491.21 kB / 148.31 kB gzip**, 2194 modules, 30 chunks, built in 15.88 s | byte-identical to §27's head measurement; the Vite 6 delta is explained there and the warning threshold was not touched |
| `npm audit` | 6 findings (5 moderate, 1 high), exit 1 | **4 moderate, 0 high**, exit 1 | exit 1 is npm's response to *any* finding; the count and the severities are the measurement |
| `npm audit --omit=dev --audit-level=high` | exit 0 (2 moderate) | **exit 0**, 2 moderate below the threshold | `react-router`, §26 |
| `git diff --check` | — | exit 0, no output | tracked + untracked-in-index whitespace and conflict markers |
| `bash supabase/tests/rls/run.sh` | 24 | **24** | unchanged, by design |
| `bash supabase/tests/stage2/run.sh both`, clean chain | 41 / 46 / 269 / 325 / 94 | **42 / 46 / 284 / 464 / 103** | outcome floor +1 (one more table); `30_publication.sql` +15 (the `api` inventory against Stage 4's function set); attacks +139 (the release contract, slot by slot); catalogue +9 (C12/C12b, definer and `search_path` inventories) |
| same, legacy chain | 75 / 49 / 269 / 325 / 94 | **76 / 49 / 284 / 464 / 103** | the same five movements, and the two chains agree on the three that are chain-independent |
| `bash supabase/tests/stage4/run.sh both` | did not exist | **426 + 57 per chain** | its own runner, its own totals, never added to the five above |
| `bash supabase/tests/api/run.sh` | 37 + 56 | **37 + 56 + 28**, 0 failed | the third file is `stage4_tradition_packs.test.mjs`; `LEDGER-01` is the assertion that prints what the run leaves behind, and §30 erases it |

Nothing in this table is a re-typed copy of an earlier section's number: all fourteen rows were
re-printed in this run, and each one matched the figure §25, §26 or §27 already carried. That agreement
is the point of running the battery twice — a number that only appears once is a transcription.

## 26. Dependency state

`npm ci` from `package-lock.json` at head, then `npm audit` and `npm audit --omit=dev --audit-level=high`:

* **4 findings, 4 moderate, 0 high** in the full tree — down from 6 (5 moderate, 1 high) at §1, because
  §2C replaced the dev-server advisory's carrier by patching Vite within its declared range rather
  than mitigating it.
* `npm audit --omit=dev --audit-level=high` **exits 0**: 2 moderate findings, both
  `react-router` / `react-router-dom` (`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`), each fixable only
  by a breaking major jump (`npm audit fix --force` → `react-router-dom@7.18.4`). This stage does not
  make that jump: the production surface is not exposed at `high`, the fix is a major version of the
  router this app is built on, and §27 of the directive forbids buying a moderate finding with a forced
  major. Recorded as a follow-up with the two advisory ids named.
* Vite `^6.4.3` (was `^5.4.19`), `esbuild` 0.25.12 as Vite's own dependency (was 0.21.5),
  `@vitejs/plugin-react-swc` and `vitest` unchanged — their peer ranges already admitted Vite 6.
* `npm` only. `pnpm-lock.yaml` and `pnpm-workspace.yaml` are untracked, unrelated to this stage, and
  were not read, edited, staged or committed; §31 leaves them exactly as found.

The §25.1 battery re-ran this section's commands after a second, deliberately clean `rm -rf node_modules`
+ `npm ci`, and printed the same four numbers and the same two exit codes. The resolved Vite and esbuild
were re-read from the installed tree rather than from `package.json`: `node -p
"require('vite/package.json').version"` → 6.4.3, `require('esbuild/package.json').version` → 0.25.12.

## 27. Bundle state

`npm run build` at head, 30 chunks, versus the same tree's Vite-6 measurement in §1 and versus
Stage 3's pinned figures (`docs/audits/stage-3-public-invitation.md` §7.8):

| Chunk | Stage 3 (Vite 5) | §1 baseline (Vite 6) | Stage 4 head |
| --- | --- | --- | --- |
| entry `index-*.js` | 488.93 / 147.23 kB gzip | 491.21 / 148.30 | **491.21 / 148.31** |
| `EditProject-*.js` | 58.60 / 19.32 | — | **86.09 / 25.85** |
| `InvitationRenderer-*.js` | 7.72 / 2.83 | — | **13.90 / 4.51** |
| `PublicInvitation-*.js` | 2.38 / 1.17 | — | **2.39 / 1.17** |
| `sanitizeSvg-*.js` | 29.89 / 11.52 | — | **29.89 / 11.52** |
| `index-*.css` | not recorded by §7.8 | — | **68.95 / 12.17** |

The stylesheet row is a head-only measurement: Stage 3's §7.8 table records the entry JavaScript
chunk, not the CSS, so no comparison for it is available and none is implied.

The reading that matters for a guest: **the entry chunk did not grow** (491.21 kB, +0.01 kB gzip against
§1's own Vite-6 figure, which is a hash-ordering artefact rather than code), and the guest route is
still 2.39 kB / 1.17 kB. All of Stage 4's client weight landed in the two lazy chunks a host reaches:
the editor route +27.49 kB raw / +6.53 kB gzip, the renderer +6.18 / +1.68 — the renderer being larger
is the direct cost of §15, a component that draws eleven section slots with provenance-aware bodies
instead of five hard-coded regions. Stage 3's +2.16 kB / +1.06 kB Vite-6 delta is still the entry
chunk's only growth since Stage 3's pinned tree.

The 500 kB chunk warning does not fire and was not silenced: `vite.config.ts`'s threshold is untouched,
which §30's clean build re-confirms on a freshly installed `node_modules` — after one detour that is
recorded in **§32.7**, because the first clean-build attempt measured a tree that `npm ci` had not
installed.

## 28. Local Supabase qualification — what it does and does not prove

Everything in §18, §22 and §23 ran against this repository's own `supabase start` stack:
`supabase_db_localvivaahvarnam` (54401), `supabase_kong_localvivaahvarnam` (54400), auth and REST
sidecars, Mailpit UI (54403), project ref `localvivaahvarnam` read from `supabase/config.toml`. CLI
2.118.0. The schema in it was installed by `npx supabase db reset --local --no-seed` from
`supabase/migrations/`, so what PostgREST served is what this branch's migrations produce — that is the
gap `stage2/run.sh`'s own boundary note has always declared, and it is why the HTTP battery exists
separately from the SQL one.

What the local stack proves: real sign-ups, real JWTs, real PostgREST routing and error envelopes, one
tampered JWT, the grant layer's actual refusal text, the guest door over HTTP, rotation and revocation,
and the renderer drawing a bundle built for production at four viewports.

What it does not prove, in the same words as Stage 3's audit: **local qualification is not production
qualification.** It says nothing about a hosted project's configuration, its version of PostgREST or
GoTrue, its SMTP/phone providers, real traffic, real credentials issued by a real auth server, CDN
behaviour, backup, or any capacity claim. The `db reset` was `--local` and `--no-seed`; the throwaway
Docker containers used by `rls/run.sh`, `stage2/run.sh` and `stage4/run.sh` are plain Postgres 16
containers that exist only for the duration of a run.

## 29. Remote Supabase — the statement

**No hosted Supabase project was contacted, read, written, configured or deployed by this stage, and
none was contacted by any command whose output is quoted in this document.**

`supabase link`, `supabase db push`, `supabase db pull`, `supabase db reset --linked`,
`supabase functions deploy`, `supabase migration up`, `supabase start` without `--local`-scoped
targeting and any `--project-ref` invocation were never run. The historical project reference in
`.env` was never used as a test target: `.env` (hosted values) is not read by the batteries, which use
`.env.local` (loopback), and the HTTP suite's own guard refuses to start if the URL is not loopback or
its port is not the one in this repository's `config.toml`, while `stage4_tradition_packs.test.mjs`
additionally refuses a project id other than `localvivaahvarnam`. §26 of the matrix quotes the built
bundle's own destinations, measured: one request to `127.0.0.1:4173`, one to `127.0.0.1:54400`, four to
the declared Google Fonts CDN, and **zero hosted-Supabase requests** — the assertion that the hosted
value is absent from the built bundle is in the render instrument's own prelude, which prints
`the hosted target .env declares is absent from the built bundle — the hosted value is not printed here`
so the check never has to echo a secret to prove itself.

The unrelated DueWeave stack (ports 54321–54327) was neither stopped, reconfigured, inspected nor
written to. `docker` invocations in this stage's evidence target only
`supabase_db_localvivaahvarnam` and the `vivaahvarnam-*` throwaway containers this branch names.

## 30. Cleanup performed

*Recorded after the §30 clean battery and this section's own execution; the numbers below are the
measured post-state, not the plan.*

**Before anything was measured, the dev server came down.** `npm run dev` had been left listening on
`127.0.0.1:5199` (PID 44340, plus its `esbuild` child) from the browser work in §19; it was stopped with
`taskkill /PID 44340 /T /F` before `node_modules` was deleted, because the two batteries that followed
rebuild the tree underneath a running Vite process. The background task that had been holding that
server then reported **exit 1** — the consequence of being killed, not a failing command, and it is
recorded here so a reader who sees that notification does not read it as a gate result. No preview
server was running; port 4173 was already free.

**Then the dependency tree was rebuilt from the lockfile**, because a gate run against a
`node_modules` that earlier tooling had re-shaped is not evidence about this repository:
`rm -rf node_modules` (that one path, nothing above or beside it) and `npm ci` from
`package-lock.json`. §25.1 is the battery that ran on the result.

**Database erasure, and what it is not.** `npx supabase db reset --local --no-seed` re-applied all 18
migrations onto a fresh local database — a second, independent proof that the Stage 4 migration applies
on a real Supabase stack and not only on the plain-Postgres chains §25.1 measures, since it printed
`Applying migration 20260927120000_stage4_tradition_pack_releases.sql...` and then
`Finished supabase db reset on branch stage4/tradition-pack-foundation.` Afterwards:

| Measured | Before | After reset | After stop |
| --- | --- | --- | --- |
| `public.tradition_packs` | 5, all `stage4_http_*` | **0** | volume deleted |
| `public.tradition_pack_releases` | 35 (`stage4_http_fixture` 30, `…_language_gaps` 2, `…_draft_only` 1, `…_retired_only` 1, `…_reviewed_only` 1) | **0** | volume deleted |
| accounts in `auth.users` | 2 (`s4ui-host@example.test`, `s4r-host-a+stage4render-mule7ue6-1n0gvq@example.test`) | **0** | volume deleted |
| `public.weddings` / `invitation_drafts` | 1 (`e04a8773-0c65-4b06-93b5-b91214fea7b4`) / 1 | **0 / 0** | volume deleted |
| `invitation_versions` / `publications` | 0 / 0 | **0 / 0** | volume deleted |
| `private.access_tokens` (digests only, never raw) | 0 | **0** | volume deleted |
| scratch or manifest tables | none | **none** (`tablename ~* 'manifest\|scratch\|fixture\|probe'` matched only `public.design_templates` and `legacy.templates`, i.e. nothing) | — |
| `public` policies / `SECURITY DEFINER` functions | 45 / 9 | **45 / 9** | — |

0 rows in the pack catalogue is §1's starting number, so the round trip is closed: the stage began with
an empty catalogue and ends with one, and the only approved releases that ever existed in it were
battery rows labelled `TEST ONLY`.

Then `npx supabase stop --project-id localvivaahvarnam --no-backup`, which printed
`Stopped supabase local development setup.` **`--no-backup` is the destructive half of that command**: it
deletes the stack's data volume instead of dumping it first, which is what §31 of the directive asks for
and why the "After stop" column above says *volume deleted* rather than quoting a row count. The honest
consequence for whoever works here next: `supabase start` and `supabase db reset --local --no-seed`
rebuild the database from the 18 migrations, and every qualification number in this document is a
measurement of a stack that no longer exists on this machine. Nothing was lost that the repository cannot
re-create — that is the point of the migration chain — but a re-run, not a recollection, is what will be
needed next stage.

**Containers and volumes.** `supabase/tests/rls/run.sh`, `stage2/run.sh` and `stage4/run.sh` each start a
throwaway `postgres:16-alpine` container named `vivaahvarnam-stage2-$$` / `-stage4-$$` / `-rls-$$` and
remove it on a shell `trap`, so none survived their runs. One container did survive this stage: the
§3 behavioural probe (`vivaahvarnam-scratch`, `postgres:16-alpine`, started 2026-09-27T14:59Z, no
published ports, its rolled-back probes never persisted). It and its anonymous data volume were removed
with `docker rm -fv vivaahvarnam-scratch`. After all of that, `docker ps -a | grep -i vivaahvarnam` and
`docker volume ls | grep -iE "vivaahvarnam|localvivaah"` both print nothing.

**Listeners.** This repository holds no socket: 54400/54401/54403 are gone with the stack, 5173/4173/5199
never came back, and the only entries `netstat` still shows on 54400/54401 are kernel `TIME_WAIT` records
from psql sessions this section closed. Two listeners that are **not** this stage's were deliberately
left alone: the unrelated DueWeave stack on 54321–54327 (never stopped, reconfigured, inspected or
written to) and a Vite dev server on `[::1]:3000` belonging to a different workspace
(`…\2026-09-24\1a7cc943\project-ar1\…`, PID 22316). Deleting either would have been the wrong kind of
tidy.

**Files deleted** — only scratch this stage's own commands wrote, each named rather than globbed over:
in the working directory above the repo, the gate logs `.s4battery.log`, `.s4api.log`, `.s4vitest.log`,
`.s4vitest-sub.log`, `.s4pc.log`, `.s4pc-test.log`, `.s4dev.log`, `.s4matrix.log`, `.s4http.txt`,
`.s4build.log`, `.s4audit.log` and the §30 battery's `.s4g-*` logs plus `.s4g-test.json`, the probe
scripts `.probe-candidate.mjs`, `fixline.js`, `parse-two.mjs`, `.count-tests.mjs` and the eleven
`st4-block-*.sql` extraction files; in the repository root, `.s4http.log` and `.s4preview.log`.

**Files kept, and why.** `artifacts/stage4-render/` (five PNGs, 1.2 MB) stays: it is gitignored
(`.gitignore:26`, added by this stage with the comment that its filenames carry throwaway local tokens)
and `docs/architecture/render-contract.md:347` documents it as the local evidence for §23 — deleting it
would make a tracked sentence false, which is worse than leaving an ignored folder on a laptop. `dist/`
is the §25.1 build output, ignored, and re-creatable. `pnpm-lock.yaml` and `pnpm-workspace.yaml` are
untracked, unrelated to Stage 4, and were not opened, edited, staged, committed or deleted. The
credential scan §32 describes ran from a scratch file outside the repository
(`%USERPROFILE%\tmp\s4added.txt`), so no scan artefact was ever written inside the working tree.

**The fixture the batteries could not delete.** §8 makes an `approved` release undeletable — that is the
immutability rule, not an oversight — so `stage4_tradition_packs.test.mjs`'s `LEDGER-01` deliberately
prints what a run leaves behind instead of pretending to clean it up, and `60_reviewed_fixture.sql`
relies on `ROLLBACK` as the only release its lifecycle walk can survive. The 35 rows in the table above
are the consequence, and a `DELETE` would have been the wrong fix: it would have meant writing an
escape hatch into the guarantee being qualified. `db reset --local` was the right eraser because it
rebuilds the schema rather than negotiating with the policy, and §31 of the directive authorises exactly
that stop-without-backup. **What is left behind now is nothing in the database and one sentence in this
section** — the next person needs to know why the local stack starts empty.

## 31. Known limitations, in plain terms

1. **No human-reviewed tradition content exists in this product.** The only approved releases in any
   database this stage touched are batteries' own rows, each labelled `TEST ONLY`, and the only real
   content artifact is a draft candidate whose every Tamil value is a bracketed placeholder. Nothing was
   read by a native speaker, and **no claim of linguistic correctness is made anywhere in this
   document — what was measured is rendering, so it is called rendering verification.**
2. **No religious or cultural authority is claimed.** `tradition_packs.scope_statement` exists to
   disclaim it, `event_vocabulary` is validated as a shape and never rendered, and the schema refuses to
   carry a column that expresses cultural identity. A pack supplies order and labels; it does not
   endorse a practice.
3. **No identity → tradition inference exists, and the build refuses it.** There is no code path from a
   name, surname, language, community or religion field to a pack selection, four of §24's rules are the
   automated refusal, and selection is a host's explicit choice or NULL.
4. **Content authoring has no surface.** §10's refusal of a maintenance RPC means minting, reviewing,
   approving or retiring a release is a trusted `psql` write. That is the Stage 4 boundary — the admin
   console was explicitly out of scope — but it means the lifecycle this stage qualified cannot be
   *operated* by a human without a database session, and that is the honest state of the build.
5. **The pack panel was never clicked against the live stack.** §19's disclosure: the two writes it
   makes were qualified over HTTP and pinned against a fetch double; the live-browser attempt stalled on
   an instrument defect (a page where every `evaluate_script` that read text timed out at 15 s while
   navigation kept working, on `/project/e04a8773-…/edit`). Not diagnosed, not worked around, and no
   browser click-through claim is made.
6. **The local development database accumulates `TEST ONLY` releases and cannot be cleaned by
   deleting them.** Measured before §30's erasure: **35 releases across 5 packs** — `stage4_http_fixture`
   30, `stage4_http_language_gaps` 2, `stage4_http_draft_only` 1, `stage4_http_retired_only` 1,
   `stage4_http_reviewed_only` 1 — the count having grown from the 34 an earlier run printed because
   §30's battery re-ran the HTTP suite once more. Any release that reached `approved` refuses `DELETE` by
   design (§7), so the only eraser is rebuilding the local database from migrations
   (`db reset --local --no-seed`), which §31 of the directive's cleanup step authorises and this stage
   performed: §30's table shows the measured 35 → 0. A future developer running the HTTP battery will see
   the count grow again; `LEDGER-01` prints what a run left behind rather than hiding it.
7. **`event_vocabulary` is validated but unused.** A release may declare up to 50 ceremony slugs and
   labels; nothing reads them into a document yet, so the vocabulary is a contract waiting for the
   editor that will offer it. Recorded in `domain-model.md` §7 with the same words.
8. **A guest's address carries the credential** (§26's disclosed Stage 3 residual, re-measured here: one
   navigation request to the preview origin has it in the path, the API call does not). Rotation and
   revocation exist precisely because of this; it is not a Stage 4 regression and it is not fixed here.
9. **Hosted CI is unavailable, not passing.** This private repository's monthly runner allocation is
   exhausted, so a run can conclude `failure` after zero steps with no runner ever starting. That is not
   an inference from the earlier stages' note: it was re-measured before this push. Run 36311012603 (head
   `b4b2022`, the expected `main`) has both jobs `conclusion: failure` with **`steps: []`**,
   **`runner_id: 0`**, **`runner_name: ""`**, `started_at` 09:57:48Z and `completed_at` 09:57:50Z — two
   seconds and no log at all (`gh run view --log-failed` answers `log not found: 108596803579`). A job
   that never reaches a runner cannot have executed a step, so its red is an infrastructure quota
   condition, recorded as `EXTERNAL CI QUOTA DEFERRAL`, and every gate quoted in this document was run on
   this machine instead. A job that *does* start and fails a step is a real failure and gets
   investigated. Note for whoever restores CI: `.github/workflows/ci.yml` runs `npm ci`, lint, typecheck,
   `dbtypes:check`, `product:check`, `npm test`, `build`, the env-tracking guard and the credential-shape
   scan — **it does not run `supabase/tests/{rls,stage2,stage4,api}/run.sh`**, so the database and HTTP
   batteries in §25.1 have no hosted enforcement and never have had.
10. **The migration is not a data-move.** §5: it presumes an empty `tradition_packs` and fails loudly
    rather than inventing a scope statement if that presumption is false.
11. **The fixture inventory is a count, not a catalogue.** The exact expected set is asserted where it
    matters (C12/C12b, the definer inventory, group `T`'s ledger) and re-measured each run; a reader who
    wants the current totals has to run the suites, which is the point of a battery but not a
    convenience for an audit.

### 31.1 What the review round found

Items 12–18 came from a review pass after §30's battery: three read-only reviewers over the whole diff
(application and tooling, SQL and migrations, documentation), each report then re-checked line by line
against the files before anything was recorded here. The round changed **no migration, no SQL battery,
no gate threshold and no product behaviour**. It changed one fixer hint inside
`scripts/check-product-contract.mjs` (it pointed at a module nothing imports), two comments in source
files, and five sentences of documentation — `domain-model.md` claimed all eighteen `private` functions
are invokers (sixteen are; the two trigger definers are named in the same section) and that "a fifth
definer is a red test" (C26 pins nine, by identity), and `render-contract.md` called five shapes the
pack-backed arms (eight freeze a release) and "Telugu Ceremonial" the only design-direction title on the
landing page (there are six). §23's shape roster in this document carried four names that do not exist
in the instrument.

12. **The seven-column grant is a floor on catalogue reading, not a ceiling on what a host can learn.**
    `internal_api.create_invitation_version` returns the snapshot it froze, and the snapshot embeds the
    selected release's `scope_statement`, `machine_assisted`, `author_label`, `review_label`,
    `reviewed_languages` and `source_reference` (`20260927120000_…:1093-1105`) — fields §9's grant
    withholds from a *table* read of the same release. The guest path is unaffected: the DTO narrows the
    block to display name, pack key and release number (`:1342-1347`). So a host who has selected a
    release learns what that release says about its own review; a host who has not, still cannot read it.
13. **The freeze gate is about the pointer column, not the jsonb body.** `require_frozen_pack_release()`
    returns early when `NEW.tradition_pack_release_id IS NULL` (`:759-761`) without reading
    `snapshot`, so a version row written with a null pointer and a snapshot that names a draft release is
    accepted. Reaching that requires INSERT on `invitation_versions`, which
    `20260925120500_stage2_rls_and_grants.sql:50-69` deliberately withholds from every browser role, with
    the §7 guard trigger as the backstop — the reachable writers are the owner and `service_role`, which
    is an operator with the database open, not a customer or the API.
14. **A deprecated selection may be kept, but not restated.** `weddings_pack_release_gate` fires on
    `UPDATE … OF tradition_pack_release_id` (`:734-736`) and has no "value unchanged" exemption, so a
    statement that re-asserts the same now-deprecated uuid is refused with `42501` while the same edit
    that leaves the column alone is not. The shipped adapter never restates it —
    `src/integrations/supabase/weddings.ts:201-220` (`updatePlanningDetails`) patches only the fields
    the host changed, and the panel's radio is `checked` against the current selection
    (`src/components/invitation/TraditionPackPanel.tsx:118-136`), so `onChange` — and therefore
    `writeSelection` (`traditionReleases.ts:191-206`) — is never reached with the value the column
    already holds. The battery records the behaviour as intended at
    `supabase/tests/stage4/50_pack_release.sql:944-946`. A future client
    that PATCHes a whole row would meet that refusal, which is why it is written here.
15. **One FK clause promises what a trigger forbids.** `reviewed_by → auth.users … ON DELETE SET NULL`
    (`:141`) can never fire for an approved release: the §8 guard refuses any change to the frozen row, so
    deleting a named reviewer's account aborts on the release's sentence instead of nulling the column.
    Erasure is §33's deferred work; until then an account that has been named as a reviewer cannot be
    deleted while the release it reviewed is approved.
16. **`TRUNCATE` was not revoked on the two pack tables.** Plain `TRUNCATE` is blocked by the `weddings`
    FK, and `TRUNCATE … CASCADE` would also clear `weddings`, which `service_role` may already delete — so
    it is a gap in depth rather than an exposure, and it differs from the DELETE/UPDATE posture the stage
    documented column by column.
17. **Three instrumentation asymmetries, none of them a weakened gate today.** `stage2/run.sh:108-119`
    totals the `PASSED (n)` markers without cross-checking them against emitted PASS lines, which is the
    repair `stage4/run.sh:117-137` was written for; `stage4/60_reviewed_fixture.sql:124-138`'s `H2`
    records a count and asserts nothing; and `rls/run-baseline.sh`/`rls/run-repro.sh` still pipe migration
    files without the CR-stripping §2D added to `rls/run.sh`. Each is a place a future false green could
    appear, and each is named rather than fixed here because fixing one means re-measuring the suites it
    reports.
18. **Two application findings left as Stage 5 work.**
    `src/components/invitation/TraditionPackPanel.tsx:79-97`'s `load()` has no
    sequence guard, so a slow first response can overwrite a newer one on a wedding change or a "Try
    again" click; and a v2 document's section list is the release's, so host text typed into a slot that
    no declared section carries is merged but never drawn (`src/pages/EditProject.tsx:171-204`). Separately,
    `src/lib/traditionPackResolver.ts` and `src/lib/traditionPackDefinition.ts` are imported only by
    tests — 80 tests' worth, measured per file at this head (`traditionPackResolver.test.ts` 25,
    `traditionPackDefinition.test.ts` 38, `traditionPackDraftCandidate.test.ts` 17) — so they are this
    stage's validation surface, not shipped behaviour; the
    §12 DTO path never calls them, and the two places that implied it does were corrected above.
19. **One policy is named for a status that does not exist.** The read policy is
    `users_read_approved_and_own_retired_pack_releases` (`:1573`), while the only status values the
    table admits are `draft`, `reviewed`, `approved` and `deprecated`
    (`CHECK (status IN (...))` at `:99`). Every "retired" in this stage's prose means `deprecated`;
    the policy name was not renamed, because a rename is a schema change the batteries assert against
    by name (C25) and this stage had no reason to spend a re-measurement on cosmetics. ADR 0007 and
    `domain-model.md` §2 carry the same clarification.
20. **One gate run in this stage measured a tree the repository policy forbids.** Between §30's
    `npm ci` (`22:48`) and the build that first fed §32.4's table (`00:25`), something ran `pnpm
    install` in this directory, and the bundle it produced disagreed with §27 by 68 kB on the entry
    chunk. The stage's discipline caught it because the number was recorded before the claim was
    written, but the cause was an outside action this report cannot attribute, and it recurred twenty
    minutes after the repair (§32.7). The same thing can silently move any future measurement here.
    §32.7 carries the timestamps, the repair, and the check a later gate run should print.

## 32. Commits, push and CI

### 32.1 The review round, and what it actually changed

§32's review was a line-by-line read of the diff, and it found errors. Two of them were in this
document's own claims, which is the reason the round happened rather than a formality:

* **A count that was wrong by half.** Item 18 above first said the resolver and the definition parser
  were exercised by "44 tests". Measured per file at this head they are 25
  (`traditionPackResolver.test.ts`), 38 (`traditionPackDefinition.test.ts`) and 17
  (`traditionPackDraftCandidate.test.ts`) — 80, and the three files are now named with their numbers
  because a bare total is how the wrong one got written.
* **Four citations that did not point at what they claimed.** `weddings.ts:200-241` spanned two
  unrelated functions; the patch-only behaviour is `updatePlanningDetails` at `:201-220`.
  `traditionReleases.ts:194-201` was a parameter list and a filter; the write is `writeSelection` at
  `:191-206`, and the reason the pointer is never restated is the controlled radio at
  `TraditionPackPanel.tsx:118-136`, not anything in the adapter. `50_pack_release.sql:943` was a blank
  line; the P8 assertion is `:944-946`. `product-contract.test.mjs:105-116` overshoots the seven
  honest sentences, which end at `:111`.
* **A vocabulary drift, now named as item 19.** The read policy says `retired`; the status CHECK has no
  such value. Renaming it is a schema change the catalogue asserts by name (C25), so the drift is
  documented in ADR 0007, `domain-model.md` §2 and item 19 instead of being silently harmonised.
* **A cross-check that found nothing to fix.** All 29 `file:line` citations in the Stage 4 documents
  were re-resolved against the tree (file exists, line in range): 0 problems. The eight rules, the six
  `src/`-scoped shape rules, the 23-rule total, the seven readable columns of twenty-two, the nineteen
  canonical tables, the 37 foreign keys and 88 CHECKs, the six no-pack sections and the six
  design-direction titles were each re-read from `scripts/check-product-contract.mjs`, the migration,
  `src/lib/invitationSections.ts` and `src/components/landing/DesignDirectionSection.tsx` rather than
  from the documents that quote them.

The two reviewer reports behind items 12–17 (grant-is-a-floor-not-a-ceiling, the freeze gate reading
the column rather than the jsonb body, the inert `ON DELETE SET NULL`, `TRUNCATE` not revoked, the three
instrumentation asymmetries) were checked against the schema and the batteries before being written
down; the claims that did not survive are in §31's item 18 note and are not repeated here as findings.

### 32.2 The commits

Seven commits on `stage4/tradition-pack-foundation`, base `b4b2022c5cdb31c5b0256cc28345759761a62937`
(Stage 3's closure commit; `origin/main` is unchanged and was not merged into), plus an eighth that is
this file itself:

| SHA | Subject | Files | + | − |
| --- | --- | --- | --- | --- |
| `20571b1` | `chore(tooling): close the Stage 4 carry-forward gate defects` — the test race, the generated-types EOF, the Vite chunk advisory | 3 | 313 | 135 |
| `5556f47` | `test(supabase): make the SQL runners read the same bytes on every machine` — the CR-stripping §2D repair | 2 | 66 | 30 |
| `91eee55` | `feat(supabase): freeze tradition-pack releases as the unit of selection` — the one forward migration, its two tables, gates, guard, policies and grants | 5 | 2452 | 94 |
| `ca8f6ea` | `test(supabase): walk the release lifecycle from SQL and from HTTP` — the Stage 4 battery, the fixture tooling, the HTTP suite, the catalogue additions | 12 | 9031 | 145 |
| `890c022` | `feat(app): select a release and render what that release declares` — adapter, panel, contract modules, normaliser, renderer, editor page, their tests | 23 | 5204 | 138 |
| `38ca88b` | `feat(governance): put the cultural-safety rules and the candidate artifact in the gate` — six rules, their self-tests, the draft candidate JSON, the review work order | 6 | 2057 | 1 |
| `a45ee5e` | `docs(stage4): re-read every count at this head and record what the mechanism does not do` — README, three architecture documents, three product documents, ADR 0007 | 8 | 791 | 75 |

That is 59 files, +19,914 / −618 before this document, which is the eighth commit and cannot print its
own SHA — see §32.5.

Staging was by explicit path in every one of the seven, with `git status --porcelain` read back after
each `git add` to check what actually entered the index. `git add .` and `git add -A` were never run.
`pnpm-lock.yaml` and `pnpm-workspace.yaml` appeared as untracked files during this stage, were never
staged, are still untracked, and are still not in any commit on this branch.

### 32.3 The credential-shape scan

Run against the added lines, using the same pattern CI runs (`.github/workflows/ci.yml:84` — a JWT pair,
a `service_role` secret, a private-key header, an `AKIA…` access key id):

* 19,123 added lines across the six code commits and 791 across the documentation commit: **0 hits**.
* The two documents that are entirely new (this audit and ADR 0007) were scanned whole rather than as a
  diff: **0 hits** each.
* Added lines were also searched for the shapes the pattern does not cover — an `Authorization: Bearer`
  literal, an `access_token=` URL, a `supabase_token` cookie, the `eyJhbGciOi` JWT prefix: **0 hits**.
* The env-file guard was checked locally: `git ls-files` tracks no `.env` or `.env.*` except
  `.env.example`. `.env.local`, which the HTTP and browser suites need, stays gitignored, and what it
  holds are keys for a stack bound to loopback that is now stopped.
* No secret value is quoted anywhere in this document. Where a credential is discussed it is discussed
  as a shape (`x-invitation-token`, a digest column, a header name), never as bytes.

Only paths are reported by that scan, never matched text, which is why the clean result is safe to
print.

### 32.4 Gates re-run after the document edits

§30 requires the docs-scanning gates to be re-run after the audit and the documents were edited.
Measured at this head, after §32.1's corrections:

| Gate | Result |
| --- | --- |
| `npm run lint` | 0 errors, 8 warnings (the same eight pre-existing ones) |
| `npm run typecheck` | clean |
| `npm run dbtypes:check` | 18 migration files, 19 public + 10 non-client tables, 19 client tables, 29 query column groups, 0 findings |
| `npm run product:check` | 171 active files scanned, 0 violations |
| `npm test` | 24 files, 355 tests, 0 failed |
| `npm run build` | see §32.7 |
| `git diff --check` | 0 lines |

The one anomaly in that table, stated rather than smoothed: **the first `npm test` run of this round
reported 1 failed file and 1 failed test out of 355.** Its name was not captured — the command was
piped through a filter, and by the time the failure was noticed the run had ended. Four subsequent full
runs passed 355/355, including a final one whose complete output was kept. As written at the time, root
cause was **not established**: the probe performed was a search for `Date.now()`, `performance.now()`
and `setTimeout` in `src/test`, it found none, and so the ordinary timing explanation had no evidence
behind it. §32.7 later caught the same class failing three files at once, named them, and read the
assertion that timed out — which is to say that search was the wrong probe, because the relevant timer
is Testing Library's own default `waitFor` budget rather than anything the test files call directly.
Even there the cause is recorded as consistent-with contention, not proven.

Two provenance corrections to this table, both established in §32.7: every node gate in it ran between
`23:52` and `00:25`, when the installed tree was a pnpm one rather than the `npm ci` tree §30 required;
and each row reproduces with the same numbers on the restored tree — so the rows stand, but they are
confirmed by §32.7 rather than by the run that first printed them.

### 32.5 Push

`stage4/tradition-pack-foundation` was pushed normally to `https://github.com/Pavithran-R-A/wedding-invites-pro.git`
— no `--force`, no `--force-with-lease`, no amend, no rebase, no history rewrite, no tag, no release,
no pull request, and `main` was not merged into. The remote was read back with
`git ls-remote origin refs/heads/stage4/tradition-pack-foundation` rather than taken from the push
output, and the remote SHA was compared with the local `HEAD`.

Those two numbers, and the equality or the disagreement, are reported in the closing message rather
than in this table: **this file is carried by the commit whose SHA it would have to print**, so the
proof of the push is in the transcript of the command, not in the document. `pnpm-lock.yaml` and
`pnpm-workspace.yaml` were not pushed because they are not in any commit.

### 32.6 Hosted CI

`.github/workflows/ci.yml` triggers on pushes to `main` and on pull requests targeting `main`, so a
push of this branch starts nothing by itself. The account's monthly Actions runner allocation was
re-measured before this push and remains the operating condition recorded in §31's item 9 —
`EXTERNAL CI QUOTA DEFERRAL`: a job concludes `failure` after about two seconds with `steps: []`,
`runner_id: 0` and no log at all. Every gate in §32.4 ran on this machine. What did **not** run
anywhere is the four database/HTTP batteries on a hosted runner, because `ci.yml` does not invoke
`supabase/tests/{rls,stage2,stage4,api}/run.sh` at all — a fact about the workflow, not about this
stage's discipline, and the reason §25.1's numbers have to be read from a local run.

`npm run build` is the remaining gate in §30's list; its measurement, including the chunk-size
advisory that the prelude repaired, is in §32.7 below.

### 32.7 The clean build, and the 68 kB that turned out not to be this branch's

§30's order was followed exactly: the local stack was already stopped, `node_modules` was deleted,
and `npm ci` was run from `package-lock.json`. The first `npm run build` after that reported **entry
`index-B3R0VnCn.js` 559.47 kB / 166.05 kB gzip with 2202 modules, and the "Some chunks are larger
than 500 kB" advisory firing** — which contradicts §1's and §27's `491.21 / 148.31` at 2194 modules,
and is exactly the kind of change §30 says to stop on rather than write off.

The comparison that localised it: four chunks were **byte-identical** to §27's head measurements
(`index-pAdj4Tzx.css` 68.95 kB, `sanitizeSvg-CfK6a1-E.js` 29.89 kB, `InvitationRenderer` 13.90 kB,
`PublicInvitation` 2.39 kB — same hashes too), while only the entry, `Header` and `EditProject`
moved. Grepping the built entry for this stage's own vocabulary (`tradition`, `reviewed_pack`,
`pack_key`, `definition`) returned **zero hits in the entry and 22/3/8 hits in the lazy
`EditProject` chunk**, so no Stage 4 code had entered the eager graph. That ruled out the one
explanation that would have mattered.

**Root cause: the tree the build ran against was not the tree `npm ci` installed.** A follow-up build
attempt failed with `EPERM` and printed its own resolution path:
`node_modules/.pnpm/vite@6.4.3_@types+node@22.20.4_jiti@1.21.7/node_modules/vite/...`. `.pnpm/` and
`.modules.yaml` are pnpm's install layout, not npm's. The filesystem timestamps give the sequence:
`node_modules/.package-lock.json` (npm's marker) `2026-09-28 22:48:44` — that is §30's `npm ci`;
`node_modules/vite` (a symlink into `.pnpm`) and `pnpm-lock.yaml` both `23:52`;
`node_modules/.modules.yaml` `2026-09-29 00:23`, minutes before the 00:25 build that reported 559.47
kB. So a `pnpm install` ran in this directory after this stage's `npm ci` and replaced the
lock-faithful tree, and pnpm's resolution differs from `package-lock.json`'s by eight modules.
**I did not run it, and this report cannot say who did.** `package.json` and `package-lock.json`
still carry `2026-09-27 18:43` timestamps and `git status` shows no tracked file modified, so nothing
in the repository changed; the bytes that did change were `node_modules` and the untracked
`pnpm-lock.yaml`, which §31 says to leave as found — it was already not as found by the time §32.2
committed, and that is disclosed here rather than smoothed over.

The repair is §30's own instruction, run again: `rm -rf node_modules dist`, `npm ci`
(`2026-09-29 00:37`, npm layout, no `.pnpm/` present), then `npm run build` twice.

| Measurement | OLD (§27 head) | pnpm tree (00:25) | NEW (§30 clean `npm ci`) |
| --- | --- | --- | --- |
| modules transformed | 2194 | 2202 | **2194** |
| entry `index-*.js` | 491.21 / 148.31 kB gzip | 559.47 / 166.05 | **491.21 / 148.31** |
| `EditProject-*.js` | 86.09 / 25.85 | 88.33 / — | **86.09 / 25.85** |
| `Header-*.js` | not recorded | 132.19 / — | **127.59 / 42.14** |
| `InvitationRenderer-*.js` | 13.90 / 4.51 | 13.90 / — | **13.90 / 4.51** |
| `sanitizeSvg-*.js` | 29.89 / 11.52 | 29.89 / — | **29.89 / 11.52** |
| `PublicInvitation-*.js` | 2.39 / 1.17 | 2.39 / — | **2.39 / 1.17** |
| `index-*.css` | 68.95 / 12.17 | 68.95 / — | **68.95 / 12.17** |
| chunks | 30 | 30 | **30** |
| ">500 kB" advisory | did not fire | **fired** | **did not fire** |
| exit code | 0 | 0 | **0** (41.17 s, then 22.68 s) |

The entry hash was identical on both clean runs (`index-JFLqmOae.js`), so the restored figure is
reproducible and §27's head row stands corrected-by-confirmation rather than rewritten.
`vite.config.ts` was never touched: it contains no `chunkSizeWarningLimit` and no `manualChunks`, and
§27's claim that the advisory does not fire "on a freshly installed `node_modules`" is now backed by
the measurement instead of by inference.

Every other node-dependent §30 gate was re-run on that restored tree, and each reproduced its recorded
number: `npm run lint` 0 errors / 8 warnings, `npm run typecheck` clean, `npm run dbtypes:check` 18
migrations / 19 `public` + 10 non-client tables / 19 client tables / 29 column groups / 0 findings,
`npm run product:check` 171 files / 0 violations, `npm audit` 4 findings all moderate and 0 high,
`npm audit --omit=dev --audit-level=high` exit 0 with 2 moderate, `git diff --check` empty.

`npm test` is the one gate that moved, and it moved twice in opposite directions:

* The first default run on the restored tree: **3 failed / 352 passed of 355** — `appRoutingAuthIsolation`,
  `contentEditor`, `editInvitationPage`, each failing in a `waitFor` with `Unable to find an element
  with the text: …`, the DOM snapshot showing the toast region and no content.
* Those three files alone: **46 passed / 46**, 25.71 s.
* A further full default run: **24 files / 355 tests passed**, exit 0 (58.36 s).

What the code says about the mechanism: those assertions rely on Testing Library's default 1000 ms
`waitFor` budget — there is no `asyncUtilTimeout`, `testTimeout` or `isolate` setting anywhere in
`vitest.config.ts` or `src/test/setup.ts`, so every default applies — and the failing run's own
per-file timings were the three largest files in the suite (`appRoutingAuthIsolation` 6.32 s,
`contentEditor` 29.29 s, `editInvitationPage` 31.68 s) inside a run that spent 42.24 s on setup and
154.71 s on collection; the same three files, run alone, finished 46 assertions in 25.71 s.
**Consistent with** contention: the files that failed are the three whose assertions wait on the
longest async chains, and they failed only in the run where the pool was busiest. What it is not:
proof. Vitest prints no per-`waitFor` elapsed time, so no number here says "the wait exceeded 1000 ms
because the machine was busy" rather than "because the promise never resolved". This is the same class
of defect commit `20571b1` closed for `editInvitationPage.test.tsx` by replacing a bare assertion with
a `waitFor`. **Not established:** that contention is the whole cause; it is the only cause this
measurement can point at, and no product-code change reproduces the failure, and none removes it. It is
left as a named follow-up instead of repaired here, because raising a timeout now would re-open every
count in §25 that the same suite produced, and silently tolerating the flake is the false green this
stage's whole discipline exists to avoid.

One probe result is recorded only so nobody mistakes it for a gate: `npx vitest run --pool=forks
--poolOptions.forks.singleFork` reported 30 failed of 59 with `Found multiple elements with the text`
and stopped after three files. In that mode the files run one process deep and the duplicate elements
show the DOM each assertion sees is not the fresh per-file one the default configuration gives; whether
the flag disables isolation or merely reuses it was not investigated, because the probe measured
nothing about this branch and is not part of §30's list.

**The lasting record of this section is the environment risk, not the number.** A `node_modules`
tree in this workspace can be replaced underneath a gate run by an installer that repository policy
forbids, and the only thing that revealed it was a build that disagreed with the audit. Any future
gate run that reports a size, a module count or a version should print the installer marker it ran
against (`node_modules/.package-lock.json` for npm, `node_modules/.modules.yaml` for pnpm) rather
than assuming the tree is the one §30 installed.

**That check earned its place immediately.** After the two clean builds, every re-run gate above, the
commit and the push, `node_modules/vite` was found to be a symlink into `.pnpm/` again and
`node_modules/.modules.yaml` carried `2026-09-29 00:58–00:59` — a second install of the same kind,
twenty minutes after the first was repaired. No measurement in this document was taken after that
moment: the commands run from 00:58 onward were `git status`, `git rev-parse`, `git ls-remote`,
`gh run`, `docker ps`, `netstat` and `stat`, none of which reads `node_modules`. The tree is left in
that state deliberately, because §31 says to leave the two pnpm files as found and repairing the
directory again would only be undone by whatever keeps doing it. What this stage can assert is the
narrower, useful thing: **the 491.21 kB / 2194-module figures were measured on a tree whose npm
marker was the only installer marker present at the time**, and the way to confirm that on any future
run is the marker check, not the number.

The marker check was then used as instructed, wrapped around the last documentation round rather than
remembered afterwards: a third `npm ci` at `2026-09-29 01:10`, `npm run product:check` and the full
`npm test` run in the same shell invocation, with `node -p existsSync` on both markers printed
immediately before and immediately after. Both readings were npm-only (`npm: true pnpm: false`),
`product:check` reported 171 files / 0 violations, and `npm test` reported 24 files / 355 tests with
exit 0. That is the shape a §30 run should take on this host from now on: the gate and the proof of
which tree it ran on come back in the same command.

## 33. Stage 5 boundary

This stage stops here. **Stage 5 is not started, and nothing below has been designed into Stage 4's
schema beyond the columns that already exist.**

What Stage 4 leaves for the next stage to decide, in the shape of a sentence rather than a plan:

* **The host's editing surface for pack-provided structure.** §19 gives a host a choice of a release
  and a scope statement; the sections a release declares are not yet editable per-wedding beyond the
  four host slots. Event and venue editors are Stage 5's named work.
* **`event_vocabulary`'s consumer.** The data is validated and unread (§31.7); wiring it to the event
  editor is a Stage 5 decision, and the rule that it must not become a cultural claim about a person
  does not change when it does.
* **A content-authoring path a human can operate** without a database session — which needs a ruling
  about who that human is, and is the admin console this stage was told not to build.
* **Real reviewed content.** `docs/content-review/tamil-english-foundation-v1.md` is the artefact a
  reviewer needs; the lifecycle is qualified and waiting. Until a reviewer with the standing to make
  the claim signs the basis and scope fields, nothing in this product should be described as reviewed.
* Still explicitly deferred, unchanged from `domain-model.md` §8: guest RSVP actions, the family
  approval workflow, uploads and Storage, entitlements from a real payment provider, retention and
  erasure, and pack × template compatibility (still no join table, because no pairing needs one yet).
