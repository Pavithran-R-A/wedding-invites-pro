# Stage 7 — Family approval and review: one credential, two doors, and the host's own record

Branch `stage7/family-approval`. The stage opened with local and remote head `56fbb46117ddab98751511eb53b0e6bad3249bc0`,
which is two commits above `refs/heads/main` at `92a3ac561567d2463d4a1515ac0815852b5295c8` (Stage 6's merged head).
Working clone `Documents/Qoder/2026-09-24/37be0a2a/s5qual`. Every number in this file was re-taken from a capture in
`../q7-logs/` before being written down; each section says which.

Append-only. A section is never edited after it is committed; a wrong statement is corrected by a later section that
names it.

## 1. Scope, taken from the repository rather than from this stage's ambition

The repository defines Stage 7 in one line, `docs/architecture/domain-model.md:372`:

> `| Family approval UX | schema only | Stage 7 |`

Three adjacent rows say what that promotion touches and where it stops. `:398` classifies
`public.approval_feedback.message` as high sensitivity — "a named third party (a family reviewer) writing opinions
about a family's decisions", append-only, "author recorded by label rather than by account link, and there is no
reviewer login yet", with "reviewer-facing view is Stage 7". `:407` says the product has people who never signed up
and that "Stage 8/Stage 7 must design that person's view and objection path". `:370` floats a different promotion —
"Stage 7's review workflow, if the review is ever to be done by a named person inside the product rather than by a
maintenance identity at a terminal" — for *content authoring for a tradition-pack release*. That row is the one this
stage declines, and §9 says why in its own words: it would merge two reviewers who must not become one identity.

So Stage 7's scope is: make the existing `approval_requests` / `approval_feedback` tables do their job through the
product, with a credential that is not an account, a host who asks, a relative who answers, and a record that cannot
be silently rewritten. Out of scope, and stated as out: a guest replying to anything (Stage 8's RSVP path),
retention and erasure (Stage 13), the paid/entitlement gate (Stage 10), and any hosted environment.

The doctrine this stage inherits is `stage-2-domain-blueprint.md` §15's storage-and-sensitivity rulings and Stage 3's
credential design: digest not token, one live credential per subject, a closed refusal shape, and a client that names
no table. The commission added five requirements that the repository had not itself written down: refusal of expired,
revoked, forged, cross-wedding and cross-version credentials; no raw token in a database record, committed code,
telemetry or log; history that cannot silently mutate the approved snapshot; no equation of "holds the link" with
"verified identity"; and the Stage 6 private asset boundary preserved on the new route.

### 1.1 The state this stage actually started from

`56fbb46` is a one-line documentation correction to `domain-model.md`, and `0571191` extends the
`canonical-table-read-outside-the-adapter` rule's table list to cover `wedding_assets`, with the two self-test fixtures
that prove it. Both were already pushed. `git status` at the reconcile measured `worktree_tracked_changes=0`, so the
stage began from a clean tree at a head identical to its remote (`q7-logs/s7-baseline-gates-01.log`, lines 2-5).
`0571191` did one thing that this stage inherits as a defect to close: it repaired the rule while leaving
`docs/product/feature-readiness.md:42` still describing the un-repaired state as "a recorded Stage 7 debt". §16.

## 2. Baseline gates at `56fbb46`, before any Stage 7 code (`q7-logs/s7-baseline-gates-01.log`)

Taken because the commission asked for them before building further, and because a stage that cannot say what was
green before it started cannot say what it broke.

| gate | result | readout |
| --- | --- | --- |
| `npm run product:check` | exit 0 | "Product contract OK — 186 active file(s) scanned, 0 violation(s)." |
| checker self-test | exit 0 | "Product contract self-test OK — 29 rule(s) verified." |
| `npm run dbtypes:check` | exit 0 | 20 migration files; 19 `public` + 10 non-client tables; 19 client tables; 34 query column groups reconciled, 0 findings |
| `npm run typecheck` | exit 0 | no output |
| `npm run lint` | exit 0 | "✖ 9 problems (0 errors, 9 warnings)" |
| `npm run test` | exit 0 | 32 files, 473 tests passed, 107.38s |

Environment measured in the same capture, kept because it is load-bearing for the rest of the stage:
`installer_markers: npm=YES pnpm=YES vite=symlink` (both installers have laid this tree; the symlink form is the
discriminator, per the Stage 4 lock), and `free_c_kb=11857228` at the start of a disk that has previously filled
mid-gate.

## 3. The `contentRefusal` question: investigated, measured, repaired, published

The commission asked whether the duplicated `contentRefusal(...)` call in `weddingAssets.ts` was genuinely redundant.
Phase 1 of root-cause work came before any edit, and the instrument was built first so the answer could be measured
rather than argued (`q7-logs/s7-contentrefusal-gates-02.log`).

* Before: a duplicate-await detector keyed on call-expression, run against the **pre-repair** file taken from
  `56fbb46`, flagged exactly one pair — `uploadAsset::await contentRefusal(draft, file) at lines 247,249`. That is the
  defect's shape: the same pure validation call, twice, on the same two arguments, with nothing between them but a
  `null` check on the first result. `dupscan_flagged=1`.
* The instrument was then run over the whole production source, where it produced a second flag:
  `WeddingAssetsPanel.tsx discard::await load() at lines 202,207`. That one was rejected as a defect, with a reason
  measured rather than asserted: the two calls sit on mutually exclusive paths — the 202 branch returns — so exactly
  one runs per call and neither is redundant. Recording the rejected flag is the point; a detector that flags two
  things and repairs two things learned nothing.
* After: the repair deletes the second call (2 lines), and the test file gains a case that pins the sequence rather
  than the count, so the pair cannot come back quietly. `npm run test` at the repaired tree: 32 files, **474** tests
  passed (the 473 plus the new one), `typecheck` / `product:check` (still 186 files, 0 violations) / `dbtypes:check` /
  `lint` (still 0 errors, 9 warnings) / self-test (still 29 rules) all exit 0.
* Published as `65fb4f0 fix(assets): drop the duplicated byte gate so an upload reads the file's head once`
  (`src/integrations/supabase/weddingAssets.ts` −2, `src/test/weddingAssetUploadRules.test.ts` +29), pushed without
  force, and read back: `remote_sha_readback=65fb4f0fb603eb9f0403f34946022b23f8f17696` equals local head, and
  `worktree_tracked_changes_now=0`.

Verdict on the commission's question: it was genuinely redundant, and the redundancy was behavioural, not cosmetic —
an upload read the same file head twice and validated it twice against the same rule.

## 4. The substrate, read before deciding anything

Five facts from the existing schema set most of Stage 7's shape, and each is cited where it is used rather than
restated in a design note.

1. `20260925120300_stage2_guests_approvals_rsvp.sql` already created `approval_requests` with a status vocabulary
   including `invalidated`, a `responded_at`, and a biconditional CHECK tying a `answered` row to a non-null
   `responded_at` — which is why withdrawal can only invalidate an *unanswered* ask, and why the alternative would
   erase when the family answered.
2. `approval_feedback` is append-only by trigger (`private.reject_client_write()`/`reject_client_delete()`), and its
   `(wedding_id, request_id, version_id)` composite FK is what `domain-model.md:95` calls the pin that lets a
   credential bind request *and* wedding *and* version.
3. `private.access_tokens` already carried `token_kind`, scoped FKs including `approval_request_id`,
   `expiry_policy`/`expires_at`/`revoked_at`/`last_used_at`/`created_by_role`, and a digest-only `token_hash`
   (`domain-model.md:229`). Stage 7 needed no new column anywhere.
4. The Stage 2 RLS file already granted the client a table read on `approval_requests` and nothing else
   (`20260925120500_stage2_rls_and_grants.sql:301-304`, `owners_read_approval_requests`). Stage 7 left that grant
   exactly where it stood, so the battery measured what leaving it means instead of assuming it: the owner reads its
   own ask rows (200, at least one), a stranger's read of the same relation is an empty list rather than a smaller
   row set (G-06, `supabase/tests/api/stage7_family_approval.test.mjs:602`), and every write is a 403/42501 whose
   hint names the missing grant (`GRANT UPDATE ON public.approval_requests` — G-05, `:574`). What that readable row
   can never carry is a credential: `private.access_tokens` is not in the exposed catalogue at all, so naming it is
   a 404/PGRST205 (G-05's closing assertion, `:597-599`). The product's own queue read goes through
   `api.get_approval_requests` rather than the table, and no client module names either approval relation — the
   ban is a contract rule with both tables in its named set and two self-test fixtures (§10).
5. `internal_api.create_invitation_version` was the only place a successor version becomes true, which is the only
   place invariant I-12 ("a new version closes the predecessor's open asks") can be enforced without a race.

The two doors' separation came from Stage 3's published decision that a credential-holding reader is not a signed-in
reader (`../architecture/public-invitation-security.md`), and the client-side rule "name no table, call the wrapper"
came from Stage 6's adapter boundary. What Stage 7 added is not a new pattern; it is the same pattern pointed at a
write.

## 5. The migration: `20261008120000_stage7_family_approval_review.sql` (931 lines, eleven sections)

| § | adds | the decision it carries |
| --- | --- | --- |
| 1 | constants | the 14-day default window and the 43-octet grammar stated as constants, not sprinkled (`:38`) |
| 2 | `internal_api.request_family_review`, `revoke_family_review`, `get_approval_requests` | host verbs, `authenticated` only; the queue returns asks, answers and link state, never a credential (`:57-325`) |
| 3 | `internal_api.resolve_family_review()` | the reviewer's door: anonymous, `VOLATILE`, **zero-argument**, reading the credential from the request header (`:326-466`) |
| 4 | the projection | what a reviewer may see, built as the guest's own DTO, with no `object_key` and no guest material (`:467-485`) |
| 5 | `internal_api.submit_family_review` | one decision, append-only, refused twice before it can be written once; the snapshot is only ever `SELECT`ed (`:486-643`) |
| 6 | `create_invitation_version` redefined | I-12 performed where a successor is born: pending asks invalidated, live `approval_review` credentials revoked, guest links untouched (`:644-778`) |
| 7 | the separation statement | cultural-authority review stays where it is (`:779-798`) |
| 8 | five `api` wrappers | the exposed half, each a `SECURITY INVOKER` one-line call into `internal_api` (`:799-856`) |
| 9 | the caller matrix | `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then precise grants, restated for both halves (`:857-888`) |
| 10 | `one_live_token_per_approval_request` | a partial unique index, so "one live link per ask" is a schema fact rather than a convention (`:889-906`) |
| 11 | catalog posture | comments written where a reader of the catalog will find them (`:907-931`) |

**How that table was re-measured, and why it moved.** Its first draft was read off the file when the file was
926 lines. `dee3a52` then edited that migration without editing a byte of its behaviour — five prose lines added
to §5.2's comment block, and the `COMMENT ON FUNCTION internal_api.submit_family_review` text reworded to name
the section-key read — and every span after section 5's interior shifted by exactly +5 while nothing before it
moved. So each row's endpoints were taken again from the current file: the eleven section titles sit at
`:38, 57, 326, 467, 486, 644, 779, 799, 857, 889, 907` and each row's end is the next title's `-- ===` rule line,
with row 11 ending at `:931`. The old values are named here rather than quietly replaced because a reader holding
`65fb4f0`'s copy of this file would otherwise see two tables that disagree. Two consequences of that same edit are
recorded in §20: the SQL captures predate it, and `9f212fd`'s message counted a tier's assertions from an
artefact that under-reports them.

Zero-argument is the load-bearing choice for the credential's travel: because `api.resolve_family_review()` takes no
parameter, there is no query string for a token to be put in, at any layer, by any client that misunderstands the API.
The header itself is read inside the function from `request.headers`. §12 of
[`../architecture/family-approval-review-security.md`](../architecture/family-approval-review-security.md) states the
same boundary as doctrine; this file keeps the measurements.

Two things in that table are corrections made after the first battery ran, and they are recorded here because the
battery found them, not a review of the code:

* **D-S7-01** — `IF NOT p_decision IN ('approved','changes_requested')` is `NULL` when `p_decision` is `NULL`, so an
  anonymous RPC carrying a JSON `null` walked past the refusal and into `approval_feedback`, and the caller received a
  schema-level `23514` about a check constraint instead of the product's own sentence. Repaired in the migration with a
  NULL-safe membership test.
* **D-S7-02** — the host queue joined every credential row, so an ask whose link had been revoked and reissued printed
  twice with identical history. Repaired with a `LATERAL` that picks the representative credential.

Both repairs are in the migration file; neither is papered over in a probe.

## 6. Applying it, and what "applied" is evidenced by

`q7-logs/s7-family-review-battery-01.log` records the chain the first green battery ran on:
`00_bootstrap.sql -> stage6/00_storage_schema.sql -> every published (non-_stageN_) migration -> stage2..stage7 suites`,
on a throwaway `postgres:16-alpine` cluster, with `app.stage_head=stage7` carried in `PGOPTIONS` on every statement.
The Stage 7 migration is replayed as part of that chain, on a fresh database, three separate times across the stage
(the `review` chain, the `clean` chain and the `legacy` chain), each ending in the suite totals in §8 and §9.

There is no log line in this stage that says "proof-clean", and this file will not invent one. What the evidence says,
verbatim, is:

* `s7-stage7-runner-review-03.log`: `DECLARED_HEAD=stage7`, `API_NAMES=13`, `INTERNAL_NAMES=24`, then
  `STAGE7 FAMILY REVIEW TESTS PASSED (255)` and `STAGE7 REVIEW BOUNDARY TESTS PASSED (116)` with `exit=0`.
* `s7-stage7-runner-historic-clean-01.log`: the same head readout on a chain whose databases were then asked to run
  the twelve older suites, all green.
* The local hosted-shaped stack: `s7-http-runsh-03.log` line 21, `ok 21 migrations applied, matching
  supabase/migrations` — a count taken from `supabase_migrations.schema_migrations` on the running
  `supabase_db_localvivaahvarnam` container and compared against the directory, which holds 21 files. `ls
  supabase/migrations | wc -l` at the tree this section describes is also 21.

So: applied on throwaway Postgres through the published chain, applied and read back on the local stack, and never
pushed to or pulled from a hosted project. Nothing in this stage ran `supabase link`, `db push` against a remote,
`db pull`, or `db reset --linked`.

## 7. Four historical suites became false, and each was measuring something else

Adding five `api` names and five `internal_api` names is a schema event in this repository: four suites carry
catalogue tripwires that pin counts. `s7-historic-at-stage7-head-0{1,2,3}.log` and
`s7-stage7-runner-historic-clean-01.log` record what each one did and what it was changed to assert.

| suite | what it had pinned | what Stage 7 made it true about |
| --- | --- | --- |
| `stage2/40_catalog.sql` | the `api`/`internal_api` name sets by inventory | now names the five Stage 7 hosts verbs and the reviewer door, and asserts `internal_api.get_approval_requests`/`request_family_review`/`resolve_family_review` are where they belong rather than in the exposed schema |
| `stage3/30_publication.sql` | "exactly one `api` function reads a credential without arguments" | the rule was measuring the guest door's uniqueness by count; Stage 7 legitimately adds a second. G4 now asserts the argument-free set is exactly those two, by name, `COLLATE "C"`-sorted, so a third appears as a finding |
| `stage4/50_pack_release.sql` | the customer surface as a count | rewritten to a ladder: Stage 4 added none, Stage 5 added exactly one (the preview/freeze-parity read), Stage 7 added exactly five, and only the two doors are reachable without a JWT |
| `stage5/50_review_binding.sql` | the reachable-name inventory | M5b now states the surface at *this* head, with the head taken from `app.stage_head` and a spelled-check (`a stage head must be spelled stage<n>`) so a missing GUC fails loudly instead of deriving the expectation from the measurement |

None of the four was weakened. Each moved from a count to a named set, because a count that a legitimate stage must
update is not a tripwire; and the `declared head` mechanism was extended rather than bypassed. This is re-measured as
part of §9's totals: the same four files at this head score 103, 284, 428 and 122.

## 8. Stage 7's own SQL batteries: 255 and 116, on a runner that had to be built for them

`supabase/tests/stage7/run.sh` (274 lines) is a new runner, and the reason it is new is stated in its own header
before the code: the Stage 6 runner builds one database per chain and runs *everything* in it, which is fine for
relational assertions and wrong for `80_family_review.sql`'s closing census, whose R-group counts are cluster-wide
("no approval request exists that does not belong to one of this battery's three weddings"). Stage 2's own attack
suite deliberately commits seed weddings and approval requests into the same database. So Stage 7 split databases
rather than assertions:

```
review    storage fixture -> bootstrap -> published -> stage2..stage7 -> 80, then 90
historic  storage fixture -> bootstrap -> published -> [legacy seed]
          -> stage2..stage7 -> Stage 2's five suites -> Stage 4's two -> Stage 5's three -> Stage 6's two
```

and `80` must run before `90` in the same database, because `90` does not build its own family — it reads the wedding,
the seven asks and the nine credentials `80` committed and asserts against them by name and count. Running `90` alone
is not a weaker test, it is a different one, and it does not pass; which is why the runner refuses a single-suite
argument for `review`.

The two batteries and what they cover, group by group, from the source banners:

| `80_family_review.sql` (1650 lines) | | `90_review_boundary.sql` (1577 lines) | |
| --- | --- | --- | --- |
| **F** | the fixture, three weddings and two versions | **X** | the cast — who the file speaks as, measured not assumed |
| **A** | one ask answers with three names and no fourth | **P** | the projection's shape |
| **B** | who may ask: a foreign wedding, a nonexistent one, `anon`, `service_role` | **K** | what it must not carry: no `object_key`, no guest list, no history |
| **D** | the open | **S** | the frozen snapshot is read-only, and a write attempt is `42501` from the trigger |
| **K** | refusal at the door: absent header, wrong shape, wrong kind, revoked, expired, answered, cross-version | **G** | who may write the three tables this workflow touches, and the guard's own scope read from its body |
| **V** | the answer's own rules: eight payload refusals, each in the product's sentence | **C** | cultural-authority review stays separate, by name, by mirror, and by row count |
| **W** | the two section checks, which necessarily run after the credential resolves | **N** | the guest link, and the two credentials that are not one |
| **S** | an approval, recorded once | **Z** | the census this file leaves behind, named row by row |
| **N** | a request for changes, pinned to a section | | |
| **X** | withdrawal, including an ask that does not exist and someone else's | | |
| **E** | expiry, reached by moving the clock, not by waiting | | |
| **O** | one live credential per request | | |
| **I** | I-12, and the guest link it must not touch | | |
| **Q** | the host's queue, including the four states it can name read from the function body | | |
| **R** | residue, scoped to this battery | | |
| **L** | the floor | | |

Measured totals (`s7-stage7-runner-review-03.log`, cross-checked in `s7-stage7-sql-pair-01.log`):

```
stage 7 80_family_review:    PASSED (255)  [PASS lines observed: 255, counted: lines]
stage 7 90_review_boundary:  PASSED (116)  [PASS lines observed: 116, counted: lines]
```

The `lines` mode means the suite's own reported total and the number of `NOTICE: PASS` lines agree exactly; the
in-suite floors (L1 at 254 and 115 assertions) are the measured pre-floor counts, not guesses, and were raised in the
same breath as the totals they track. `s7-family-review-battery-01.log` records why the floor was corrected once: the
L block used to print a PASS without moving the counter, so a `lines` runner would have reported 254 assertions while
255 lines printed. That is a re-measurement caused by a check changing, and the number moved from 254 to 255.

### 8.1 Masking at the runner, and the one self-check reading that needs a sentence

`run.sh` pipes every byte a suite prints through `sed -E 's/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'` on its way out,
because the boundary battery's comparison helper prints the value it was given when an assertion fails, and in this
workflow one of the values routinely compared *is* a live review credential. That is the commission's "no raw token
in a log" requirement enforced at the last place where it can be enforced for every suite at once.

The self-check on `s7-family-review-battery-01.log` reports `1`, not `0`, and the honest reading is that the `1` is
line 5 of that file — `schema under test: supabase/migrations/20261008120000_stage7_family_approval_review.sql` —
whose 43-character run `20261008120000_stage7_family_approval_review` is the migration's own name, which happens to be
made of the credential alphabet. Re-taken to prove it rather than assert it: the pattern matches exactly one line in
that capture, it is line 5, and that line contains the filename. `[REDACTED-43]` also appears in the same file,
showing the mask ran. The four captures that come out of the runner or the HTTP tier —
`s7-stage7-runner-review-03.log`, `s7-stage7-sql-pair-01.log`, `s7-stage7-runner-historic-clean-01.log`,
`s7-http-runsh-03.log` — match the 43-character pattern **0** times each.

## 8.2 The historical suites, re-measured against a schema that contains Stage 7

`s7-stage7-runner-historic-clean-01.log` (`Chain: clean`) and the `legacy` chain in the same capture, both at
`DECLARED_HEAD=stage7`, `API_NAMES=13`, `INTERNAL_NAMES=24`:

| suite | clean | legacy |
| --- | --- | --- |
| stage 2 migration outcome | 42 | 76 |
| stage 3 draft invariant | 46 | 49 |
| stage 3 publication boundary | 284 | 284 |
| stage 2 privilege + RLS attacks | 464 | 464 |
| stage 2 catalog conformance | 103 | 103 |
| stage 4 pack documents | 428 | 428 |
| stage 4 §8 fixture tooling | 57 | 57 |
| stage 5 review binding | 122 | 122 |
| stage 5 authoring vocabulary | 50 | 50 |
| stage 5 document resolution | 124 | 124 |
| stage 6 asset registry | 90 | 90 |
| stage 6 storage policies | 80 | 80 |

The runner prints the boundary of these numbers itself, and this file repeats it rather than improving it: Stage 7's
own two batteries ran on a chain that ran nothing else, because `80`'s census counts cluster-wide; the twelve older
suites ran on chains that had been given Stage 7's schema but not Stage 7's family. Neither set of numbers is evidence
about the other database. Every total labelled "at Stage 7 head" is a re-measurement of an older suite against a
schema containing Stage 7 — the older runners' own totals still describe their own heads. And the whole tier is plain
Postgres plus a role/auth shim plus a storage-schema fixture: PostgREST, Supabase Auth and the Storage API were not
executing, so no REST-level or browser-level claim is carried by these numbers.

## 9. The HTTP battery: 61 in Stage 7's file, 281 across the seven, against the real stack

Written after probing, not before. `s7-http-probe-discovery-0{1..6}.log` recorded what the live stack actually answers,
because "refused" is four different wire shapes here and an assertion written from the migration's prose would have
been wrong about all of them:

* the closed refusals are **200** with a body: `{"available": false}` and `{"recorded": false, "reason": "unavailable"}`
  — `OPEN-AFTER-ANSWER`, `ANSWER-REPLAY`;
* a caller who may not ask gets **403 / 42501** with the product's sentence: `ASK-NULL-ARGS` →
  "the caller may not ask for a review of this wedding"; `ASK-FOREIGN-VERSION` → "that version is not a version of
  this wedding"; `REVOKE-NO-SUCH-REQUEST` → "the caller may not withdraw this review request";
* a payload the schema itself bounds comes back **23514** carrying product copy, measured for all four of
  "that note does not name a section of this invitation", "that section reference is too long", "say who is answering,
  in their own words" (over-long label) and "that note is too long to record";
* a *partial* argument list never reaches the door: **404 / PGRST202**, "Could not find the function
  api.submit_family_review(p_reviewer_label) in the schema cache" — which is why the product-contract rule in §10 has
  to exist: the router resolves by signature, and a client that drops an argument gets a schema-cache miss rather than
  a validation error;
* and a review credential aimed at the guest path is a **404** (`REVIEW-AT-GUEST-ANSWER-RSVP`), while a valid review
  credential opens its own door and its guest-shaped neighbour stays shut (D-04, D-05 in the battery).

The battery itself (`s7-http-runsh-03.log`, `==> node --test supabase/tests/api/stage7_family_approval.test.mjs`,
1532 lines of source) is **61 tests, 61 pass, 0 fail** in eight named groups: TRANSPORT (T-01..T-05: reachability, the
absence of a parameter in both spellings, the query-string echo that is the reason for that absence, the publishable
key alone opening both doors, header case-folding); CALLER MATRIX (G-01 ×3 verbs, G-02 `service_role` stopped at the
schema, G-03 another host refused by name in all three sentences, G-04 nulls as an ownership question and never a
crash, G-05/G-06 the approval tables off the client); ASK (K-01..K-10, including the digest-not-token storage, the
14-day default read against the row's own instant, and "asking a second relative does not withdraw the first"); REVIEW
DOOR (D-01..D-10, including the stamp on `last_used_at` and nothing else, the single refusal across every unusable
credential, expiry closing both doors, and the reviewer seeing none of the Stage 6 asset boundary or the guest list);
REVIEW ANSWER (A-01..A-12, including replay refused with the first row unchanged, a JSON `null` decision, whitespace
not being a note, the 2000-character note stored in full, section pinning re-checked against the frozen document, and
an answer being unable to rewrite the invitation); HOST QUEUE (Q-01..Q-06, including "no credential of any kind appears
in the queue, though its states do"); VERSION SUCCESSOR (X-01..X-04, I-12 over HTTP and the guest link untouched by
it); CREDENTIAL STORE (C-01..C-06, nothing raw anywhere in the store or in a readable record, and the audit table
holding no credential either).

Whole-tier readout from the same capture, the seven API files the repo owns: stage3 publication 38, stage3 security
56, stage4 packs 28, stage5 admin CLI 36, stage5 pack-driven 28, stage6 storage 34, stage7 family approval 61 —
**281 tests, 0 failures**, `RESULT: PASS`, `code=0`. Stack identity recorded at the top of the capture
(`project_id=localvivaahvarnam`, API `http://127.0.0.1:54400`, port matched against this repository's `[api]`
configuration, images `postgres:17.11.0.002`, `kong:2.8.1`, `postgrest:v16.4`, `gotrue:v2.197.0`), and the run is
bracketed by a baseline census of ten tables at 0 rows and a post-run check that all ten are back at 0, including
`approval_requests`, `approval_feedback`, `access_tokens` and `storage.objects(wedding-assets)`. The Stage 6 battery's
own residue census and the Stage 7 one both printed after teardown; both were zero. `supabase/tests/api/run.sh` was
extended to run the new file and to enforce that bracket.

## 10. Client, types, UI and the two contract rules that keep the transport honest

* `src/integrations/supabase/familyReview.ts` (96 lines) is the host's module: three `api` RPCs
  (`request_family_review`, `revoke_family_review`, `get_approval_requests`), names no table.
  `src/integrations/supabase/publicReview.ts` (145 lines) is the reviewer's: the other two (`resolve_family_review`,
  `submit_family_review`) on a client whose `global` headers carry
  `x-review-token`, `persistSession: false`, `autoRefreshToken: false`, and the 43-octet shape checked locally before a
  round trip is spent. It transcribes the six submission refusal sentences from the HTTP battery rather than from the
  migration, because what a reviewer is owed is the string the transport actually returned; anything unrecognised is
  folded into one generic sentence with its code logged, and a message this build has not read is not put in front of a
  stranger.
* `src/integrations/supabase/types.ts` was regenerated: 13 `api` function signatures and 24 `internal_api` in the
  non-client half, matching the catalogue readouts in §6 rather than a hand-copy.
* `src/lib/publicInvitation.ts` gained `parseInvitationObject` — the document read apart from whatever envelope
  carries it. `api.resolve_family_review` nests the same projection one level deeper than the guest door does, and a
  second parser would be a second thing that can drift from the first: same fields, same wholesale refusal, one
  implementation.
* `src/App.tsx` mounts `/r/:token` as a lazy sibling of `/i/:token`, in the second router tree — the one *outside*
  `AuthProvider` and outside `ProtectedRoute`. A reviewer has no account affordance to mount machinery for, and the
  chunk is separate because a relative came to approve an invitation, not to use an editor.
* `src/components/invitation/FamilyReviewPanel.tsx` (420 lines) is the host's queue on the editor page;
  `src/pages/FamilyReview.tsx` (405 lines) is the reviewer's page.
* `scripts/check-product-contract.mjs` gains `reviewer-door-called-with-arguments` — a `.rpc('resolve_family_review',
  {` anywhere in `src/` is a finding, with no `exclude`, for the same reason the guest rule has none: the module that
  must not write it is the module most tempted to. The checker's self-test now proves the rule bites on the sanctioned
  adapter's own path and that the argument form is a finding there, and reuses the guest rule's other half. The
  `canonical-table-read-outside-the-adapter` list gains `approval_requests` and `approval_feedback` (it already
  carried `wedding_assets` and `publications`), with fixtures for both.
* Unit tests: `src/test/familyReviewPanel.test.tsx` (27), `familyReviewPage.test.tsx` (22),
  `familyReviewShape.test.ts` (27), `familyReviewTransport.test.ts` (15) — re-taken individually at this tree:
  **4 files, 91 tests, 0 failed**, 15.87s. The transport file is the one that pins the `describe()` masking path the
  browser tier cannot reach (§13, console coverage).

## 11. What the reviewer is, and what the product refuses to claim

The commission's line — do not equate possession of a link with verified identity — is implemented as copy and as
schema, not as a comment. `reviewer_display_name` is the host's words *about* a person; `author_label` is the
reviewer's words *about themselves*; `reviewer_contact_text` stays NULL because the product does not collect it; and
`last_used_at` is stamped by the door so the host's queue can honestly say *an* opening happened while never claiming
to know who did it. The panel shows the signature rather than a promise: journey B's Thavu answers "I am actually the
neighbour" and the host is shown exactly that, marked as unverifiable in the panel's own copy. The queue distinguishes
`never_issued` as a state the schema cannot produce (Q19: every ask minted exactly one credential), so the four link
states a reader can be shown are read from the function body rather than from a list in a test.

## 12. Browser tier, four journeys, and the runs it took

`scripts/stage7-browser-review.mjs` (1418 lines) on the house CDP driver, against the production preview
(`http://127.0.0.1:4173`) and the loopback API (`54400`), authored and executed in the same sitting. The final capture
is `q7-logs/s7-run-full-4.txt`, run tag `s7ui-muzpa0r1-kvklf`, evidence log
`s7-browser-s7ui-muzpa0r1-kvklf.log`, screenshots `s7-reviewer-390x844.png` and `s7-panel-390x844.png`:

```
==> checks 104, measurements 18, findings 0
STAGE 7 BROWSER TIER: PASS
exit=0
```

* **Prelude** — five reviewer sentences asserted as *bytes in the shipped bundle*, the loopback target called, no
  hosted Supabase origin of any shape baked in, the stack answering, the five Stage 7 verbs present on it, 1007 KB of
  shipped JS/CSS/HTML scanned.
* **A — host asks, relative answers on a phone, host reads it back.** Sign-up through the product with no
  email-confirmation step; a wedding built through the UI; the panel refusing an ask while nothing is frozen and the
  ask button not offered; four prose slots and person/venue/ceremony filled through the product; a freeze; an ask made
  through the panel's own button; the link shown once and not handed back on reload; that address opening the reviewer
  page in a context with no session; the reviewer shown the frozen invitation and the host's own words, addressed by
  the name the host typed, offered no account affordance, and saying so in the reviewer's language; the send button
  refusing an empty form, refusing a name alone, requiring a note for a change request, and refusing an empty note
  before anything reaches the server; the answer accepted, receipted with the reviewer's own words and the version it
  is pinned to, and the form gone afterwards; the host reading it back including the note exactly as typed; the
  database holding one answered request, one decision row and one credential with a 64-hex digest whose pre-image is
  the link; **the frozen snapshot byte-identical across the whole exchange** (`digest before eae1334a6960…, after
  eae1334a6960…`) and no second version written; the refused revisit recording nothing further; the host still
  editing the same draft.
* **B — withdrawal, forgery, and a stranger with a session.** A live link withdrawn through the panel, credential
  revoked and ask invalidated in the store; the withdrawn address and a well-formed-but-never-issued credential both
  refusing with the same one sentence (`{"available": false}` measured on the wire); a malformed credential refused
  locally with **zero** round trips; the stranger's own dashboard listing none of the host's invitation and no review
  queue at all; and the same stranger holding a live link still being let in — the link is the credential, the session
  grants nothing — answering under their typed label, and the answered link then refusing a second reply with exactly
  one feedback row.
* **C — the wire.** Every credential-carrying request proved to be one of the two review RPCs over the one header; the
  travel tallied by location (`url:path@127.0.0.1:4173`, `header:x-review-token@127.0.0.1:54400`); nothing crossing the
  loopback edge; no credential in any query, hash, page text, title, storage or cookie; the only off-machine
  destinations the two font hosts the product ships; no analytics, replay or telemetry host; the browser left with no
  session and no credential after answering (19 requests, their header names listed).
* **D — accessibility and mobile.** 0px horizontal overflow at 390×844 on both surfaces; one `h1`, `h2`s for family,
  ceremonies and the answer; every control named; radio aims measured at 316×44 through their labels; 12 keyboard stops
  all with a visible indicator; the panel labelled by its own heading with three controls tested at 44×44; screenshots
  taken at the phone viewport.
* **Cleanup** — every account, ask and credential this run created gone (residue report 0/0/0/0/0), and the masking
  sweep re-taken: `6 credential(s) registered, 5 appeared in what this run tried to print, 5 write(s) were rewritten,
  0 escaped`. The sixth is journey B's deliberately forged string, which this tier never prints; the gap is disclosed
  rather than smoothed.

## 13. Six captures, and what each failure was

| capture | run tag | result | what it was |
| --- | --- | --- | --- |
| *(no console capture kept)* | `s7ui-muznr9p1-l78nw`, 20:25 | 56 `ok` lines, 7 `..`, no `FAIL` in its evidence log | the tier's first full attempt at journey A alone, before the masking probe and journey B existed. Its `.log` is kept; the stdout file for it is not, so this row cites the log and says so rather than inventing a capture. |
| `s7-run-full-1.txt` | `s7ui-muzo10mm-5utnj`, 20:33 | 102 checks, 20 measurements, **4 findings**, exit 1 | three journey-C findings and one cleanup finding, each of which turned out to be an assertion that could not be true as written (§14) |
| `s7-run-full-2.txt` | `s7ui-muzonrys-7t9p2`, 20:52 | 104, 17, **1 finding**, exit 1 | the replacement Referer claim, falsified by the legitimate font hop (§14.1) |
| `s7-run-ac-3.txt` | `s7ui-muzp02yu-88l58`, 21:01 | 71, 13, **0 findings**, exit 0 | a partial (`--only=a,c`) re-run of the reshaped C, which is where the save-settling transient appeared (§15) |
| `s7-run-full-3.txt` | `s7ui-muzp2ru9-x0yj2`, 21:04 | 104, 18, **0**, exit 0 | first full green |
| `s7-run-full-4.txt` | `s7ui-muzpa0r1-kvklf`, 21:10 | 104, 18, **0**, exit 0 | re-taken after the last edit to the tier itself; the published capture |

**Where the two kinds of number come from, and one of them was published wrong.** Each run writes two
artefacts: the stdout capture (`s7-run-*.txt`) and the evidence log (`s7-browser-<tag>.log`). They do not carry
the same tally, and the difference is structural, not a lost line: the log's final two lines are written about
the log — `[cleanup] every credential this run tried to print was masked before it left` and `.. [cleanup]
evidence log, written from the side that left for the terminal` — so a log cannot contain them. `diff`ing
full-4's two files confirms it: the log has 103 `ok` and 17 `..` where the stdout file has 104 and 18, and the
only lines present in one and not the other are exactly those two. The stdout capture's own summary line
(`==> checks 104, measurements 18, findings 0`) therefore agrees with its own body, and it is the number every
section above quotes.

That is not what commit `9f212fddefa829164b762e03021932717e4a90e6f`, which adds the tier, says. Its message
reports "103 ok / 17 note / 5 raw" for the published run and "103 ok / 17 note / 5 raw" for the green run
before it, tallied from the evidence logs, and describes full-1's journey-C findings as three when the run
scored four — because the fourth, §14.2's vacuously green masking check, is the line the log cannot hold. Those
figures are one check and one measurement short of the truth and the finding count is one low. The commit is
pushed, so the message stands and is corrected here: the published capture is **104 checks / 18 measurements /
5 `raw` / 0 findings, exit 0**, and run 1 carried **four** findings. Nothing in the repair changes a behaviour
the tier exercises; the error is a counting artefact, and it is the reason §12 now names the stdout file rather
than the log as the authority.

Nothing was fixed by loosening a check. Each of the four findings in runs 1-2 was investigated to a root cause
before its assertion was touched, and the two claims that turned out to be wrong are recorded in §14 with what
replaced them and the measured difference.

## 14. Two assertions this tier wrote wrong, and the re-measurements that replaced them

**14.1 The credential-travel claim, and the Referer claim that replaced it.** Run 1 failed `[c] the raw credential
appears in no URL …` because the reviewer's own page address *is* `/r/<credential>` — the design puts it there — and
failed the two "no origin outside the loopback" checks because the product ships Google Fonts. The ban-shaped claims
were not measuring a leak; they were measuring the design. Run 1's third finding (`fonts.googleapis.com` as a
"third-party host") is the same error one level down: the product's own font policy is documented in
`index.html`/ADR 0006 and was already qualified in Stage 3.

Run 2 replaced them with a declared-travel shape — the credential's allowed locations are stated as *places*, and each
sighting must fall inside one — which is what Stage 5's lineage had already arrived at for the same reason. Run 2 then
produced one new finding, `[c] no request leaving this machine carried a Referer`, from the measured values
`fonts.googleapis.com: (empty) | fonts.gstatic.com: https://fonts.googleapis.com/`. Before touching it, an isolated
probe (`stage7-referer-probe.mjs`, its own CDP session, a 43-character needle that is not a credential, port 9431)
answered three questions: the gstatic hop carries the *stylesheet's own address*, which is a Google-to-Google hop and
not this machine's; it does so identically with and without a credential in the page path, so it is not Stage 7's; and
a set of the requests run 2 counted as egress were `data:`/`blob:` pseudo-requests, which leave nothing.

So the claim was both over-wide and mis-instrumented. The replacement, now in the code with that history in a comment
above it: `no Referer that leaves this machine names it or carries a credential-shaped string` (a regex over
`127.0.0.1|localhost|[A-Za-z0-9_-]{43}`), with `data:`/`blob:` excluded from egress and named in the measurement, plus
a disclosure measure that states what this tier cannot reach — the reviewer's address holds the credential by design,
so it also sits in that browser's history and in whatever access log the hosting stack keeps; a local run has no such
log, so the tier proves the travel and discloses the residue instead of claiming none. **Re-measured because a check
changed**: run 2 scored 104 checks / 17 measurements / 1 finding; runs 3 and 4 score 104 / 18 / 0. The check count did
not move; one check's *claim* moved, and one measurement was added.

**14.2 The masking check that was vacuously green.** Run 1's cleanup finding read `6 registered, 0 appeared in what
this run tried to print, 0 write(s) were rewritten, 0 escaped` — a green-looking line that proved nothing, because
`check()` and `measure()` scrub before writing, so the stdout hook never saw a credential and could not have rewritten
one. Deleting the scrub would have kept that line green. The fix is `printRaw`, which writes through the hook
unmasked and is labelled `raw` in the log so a reader can tell the masking probe's line from a measurement; the closing
sweep now requires `carried.length > 0` to be meaningful. Runs 3 and 4 report the 5-of-6 numbers quoted in §12 — the
before/after is 0 appeared → 5 appeared, 0 rewritten → 5 rewritten, and it is the second pair that is the evidence.

**14.3 The ask tally, strengthened rather than replaced.** `pressEvidence` printed the host page's *cumulative* RPC
log, so on a shared host page journey B's ask looked like "HTTP 200, HTTP 200" and journey D's like five 200s — the
tier could not tell "one press, one ask" from "one press, five asks" from that line. `askForLink` now reads
`request_family_review`'s count before and after the press and requires `after === before + 1`, and the headline copy
says "made exactly one ask". Five asks, three answers, five `raw` lines in run 4, and the cumulative tally in the
evidence log is now the thing that proves the increment, not the thing that obscures it.

## 15. One transient observed once, disclosed, and not repaired

The `[a] the header save status from the Save press to a settled save` measurement samples the header's own words. In
`s7-run-full-{1,2,3,4}.txt` it reads `Saved` at the first sample: +164ms, +163ms, +184ms, +170ms. In `s7-run-ac-3.txt`
it reads `+189ms: Saving…  →  +345ms: Saved`. That is the same action settling one sample later, on the partial run
only, and it is a measurement line, not a check: the following check ("the page calls the draft saved on both of its
two witnesses before the freeze") passed in all five runs whose stdout capture carries the line — §13 records
a sixth run that exists only as an evidence log, and a journey-A run cannot carry this measurement anyway.

No root cause was established, and this file does not invent one: it is consistent with the save round trip arriving a
few tens of milliseconds later on that run, and there is no second observation to test that against. It is recorded
because a tier that reports only the runs it liked is not evidence. It did not become a retry, a longer timeout or an
assertion.

## 16. Truth sync: what Stage 7 made false, and what it is now

Twenty-one status claims moved in this section, and the number has moved three times. The
first pass said **seven** and named seven; the sweep widened after that draft — from the rows
that mention Stage 7 to every row that carries a count or a "nothing reaches this yet" phrase,
which is the rule this repository already applies elsewhere: a count with no list behind it is
not a scope — and it became sixteen. Items 18-21 are the last four, and they are a third kind:
they are not claims in the tracked documents at all but claims this stage *published* about its
own evidence, in commit messages and in a checker fixture list. Each was found by reading what
this stage wrote against what this stage measured, which is the only way that class of defect
gets found. Items 16 and 17 arrived by §17's gate numbers contradicting prose; items 18-21
arrived by re-measuring this stage's own artefacts. Each item was found by reading the claim
against the code and the measurements, not by searching for the word "Stage 7".

1. `docs/product/feature-readiness.md:42` calls the `wedding_assets` omission in `canonical-table-read-outside-the-adapter`
   "a recorded Stage 7 debt". `0571191` closed it before Stage 7 began; the pattern line at this tree names both
   `wedding_assets` and `publications`, and the self-test carries a `wedding_assets` fixture. The claim is repaired to
   state the closed state, with the commit that closed it and the fixture that proves it.
2. `feature-readiness.md:28` — "Product code reaches the database through **six** modules". **Eight** exist
   now, counted from the directory rather than from prose: `weddings.ts`, `weddingContent.ts`,
   `publication.ts`, `publicInvitation.ts`, `traditionReleases.ts`, `weddingAssets.ts` and Stage 7's
   `familyReview.ts` and `publicReview.ts`; `client.ts` builds the client and `types.ts` is generated, so
   neither reaches the database and neither is counted. The repaired sentence lists the eight and the count
   in the same file's adapter row agrees with it. (This item's first draft said "nine", having counted
   `weddingAssets.ts`'s Storage half as a module separate from `weddingAssets.ts`; the directory says eight
   and the row at `:283` says eight, so the draft was corrected rather than the documents.)
3. `feature-readiness.md:35-37` — "`publication.ts` calls seven of the eight `api` wrapper functions and
   `publicInvitation.ts` is the guest's single argument-free RPC — the eighth wrapper". There are **13** `api` names
   (§6's readout), two of them argument-free, and the second is the reviewer's door, so the "single" and the "eighth"
   are both false. Repaired against the measured catalogue and the G4 case that now pins the argument-free set by name.
4. `feature-readiness.md:46-48` — `approval_requests` and `approval_feedback` listed among canonical tables "no
   product code reads or writes yet". Product code in the browser still names neither (§10's widened rule, and HTTP
   G-05: the tables stay off the client in the owner's own session), but the database's own functions read and write
   both, so the sentence is repaired to say which kind of "product code" it means rather than to move the tables onto a
   list where they would be false too.
5. `feature-readiness.md:216` — Family approval flow `PLANNED V1` with "**no reviewer login, no screen, no request is
   ever created by this build**". Every clause of that is now false in the direction of existing. The row moves to
   `IMPLEMENTED` (local stack only), with the specific non-claims kept: there is still no reviewer *login*, by design,
   and the label is a signature; and nothing here ran against a hosted project.
6. `domain-model.md:372` — "Family approval UX | schema only | Stage 7". Repaired to built-and-locally-qualified with
   the numbers a reader can check, and `:398`'s "there is no reviewer login yet" corrected to say what replaced it.
7. `domain-model.md:402` — credentials described as "minted by `api.publish_invitation_version`/`api.rotate_invitation_token`".
   `api.request_family_review` mints a third kind now; the row is corrected to name all three mints and the kind column
   that keeps them apart at both doors (N3/N4 in the boundary battery).
8. `feature-readiness.md`'s "Row-level security" matrix row restated the Stage 6 census as a present-tense fact.
   Re-read against the live stack at this head: **45** `public` policies over **19** tables, and **13** `api`
   functions with **24** `internal_api`. The count moved for neither stage — Stage 6's three new policies are on
   `storage.objects`, which is not a `public` table, and Stage 7 writes no `CREATE POLICY` at all, a fact readable
   from its migration and confirmed by the unchanged live read. The HTTP total on that row moved to **281** across
   seven files, item by item in §9. Method disclosed in full: the 45/19/13/24 was a `pg_policies`/`pg_proc` count
   taken on the local stack while it was running, earlier in this stage; the 13/24 half is independently corroborated
   without the stack by the SQL runner's own `API_NAMES=13 / INTERNAL_NAMES=24` marker in
   `q7-logs/s7-stage7-runner-review-03.log` and `s7-stage7-runner-historic-clean-01.log`.
9. `feature-readiness.md`'s "Canonical domain schema" row put `approval_requests` and `approval_feedback` among the
   tables no product path reaches. Repaired to the measured shape: they are reached now, but only through the `api`
   wrappers — G-05's `PATCH` over the REST table is HTTP **403 / 42501** naming the missing `UPDATE` grant,
   `approval_feedback` `POST` and `DELETE` the same with their own verbs named, G-06's stranger gets an empty list
   rather than a smaller row set, and `GET /rest/v1/access_tokens` is **404 / PGRST205** because the store is not in
   the catalogue at all. The six tables still unreached are named, not counted.
10. `feature-readiness.md`'s "Forward migration chain" row said **18** migration files and **29** reconciled column
    groups. Re-derived from the directory and from `npm run dbtypes:check`'s own readout: **21** and **34**. This one
    is partly inherited and is recorded that way: `git ls-tree` at `56fbb46`, the head Stage 7 started from, already
    listed **20** migrations, so the row was one file stale before this stage opened and three after it closed. The
    Stage 7 counts are printed beside the totals, never added into them.
11. `feature-readiness.md`'s "Data-access adapter" row described six modules and the pre-Stage-6 verb shape. Repaired
    to eight, naming `publication.ts`'s seven RPCs, `familyReview.ts`'s three and `publicReview.ts`'s two, closing the
    `wedding_assets` gap by commit (`0571191`), and giving the **91** unit tests over the four Stage 7 client files as
    measured (`27 + 22 + 15 + 27`, re-run for this section: `Test Files 4 passed (4) / Tests 91 passed (91)`, exit 0).
    Its HTTP sentence now reads `38 + 56 + 28 + 36 + 28 + 34 + 61 = 281`, taken off the seven `ℹ tests` lines of
    `q7-logs/s7-http-runsh-03.log`, and the three-file total it replaced is disclosed rather than deleted.
12. `feature-readiness.md:16-18` — "Verified against this repository as of the Stage 6 storage-and-assets audit". The
    lineage line points at the Stage 7 audit *beside* Stage 6's rather than overwriting the older claim, because the
    older claim is still true of the work it measured.
13. `README.md`'s Stage 5 section bullet "**220 HTTP tests** across six files … `internal_api`'s nineteen functions".
    Checked, and it is exactly what it says: `38 + 56 + 28 + 36 + 28 + 34 = 220` over the six files that existed at
    that head, every `ℹ fail 0` in the same capture. It was left standing with a forward-pointing clause naming the
    seven-file **281** and the **24** bodies, because replacing one head's measured number with another's would
    destroy the only record that the older tier ever ran at that size.
14. `README.md:601`'s "**`service_role` holds no `USAGE` on `internal_api` at all**" — the sentence the maintenance-CLI
    paragraph rests on. Resolved by measurement rather than by reading the `GRANT`s, though the `GRANT` reading points
    the same way (the only schema-level grant on `internal_api` anywhere in the chain is
    `20260926150000_stage3_privileged_bodies_behind_wrappers.sql:111`, `TO anon, authenticated`, with
    `REVOKE ALL … FROM PUBLIC` above it and no `service_role` grant in any file). Two historical batteries assert the
    privilege directly — `supabase/tests/stage2/40_catalog.sql:475` and
    `supabase/tests/stage3/30_publication.sql:1644`, both `NOT has_schema_privilege('service_role','internal_api','USAGE')`,
    both green at the Stage 7 head in `q7-logs/s7-historic-at-stage7-head-04.log` (103 and 284). Stage 7's own
    `G3b`/`G3c` go further and read all six role/schema pairs (`anon` and `authenticated` `true` on `api` *and*
    `internal_api`, `service_role` `false` on both) and print the raw `nspacl` of both namespaces —
    `{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}` — so the role is absent from the control string
    itself, not merely from the boolean probes. The static reading alone could not have settled it: a membership
    granted outside these files would be invisible to `GRANT` text and visible in `nspacl`.
15. Two claims inside *this* audit were wrong and are corrected here rather than left for a reader to find. §4 said
    the approval tables were unreadable by the owning account; they are readable, which is what G-06 measures, and the
    boundary is the credential column, not the row. §10 said `familyReview.ts` drives five `api` RPCs; it names three,
    and `publicReview.ts` carries the reviewer's two. Both were caught by re-deriving the sentence from the source the
    first time the section was read for citation, and both sections were still uncommitted when corrected — the
    append-only rule binds a committed section, and a correction to a draft is a correction, not a retraction.

`docs/architecture/public-invitation-security.md` was read end to end against a second credential kind and needs no
change, and the reason is worth stating rather than assuming from silence: its table of who-can-learn-what is written
about `anon` and about the `public_invitation` kind, its "every bad credential is the same bytes" claim is the claim
Stage 7 mirrors rather than modifies, and its "the raw string exists in exactly one HTTP response" is now true twice
over, once per kind — which is `family-approval-review-security.md` §3's opening claim, not a contradiction of it.

`feature-readiness.md:262`'s "ten of the nineteen are read or written directly by product code" and "the other nine …
carry no client `.from()` at all" were checked rather than assumed, because Stage 7 is exactly the kind of stage that
would move a table onto that list. Re-counted from the source: `.from()` in `src/` names exactly ten tables
(`weddings` 8, `wedding_assets` 5, `wedding_people` 4, `wedding_events` 4, `venues` 4, `tradition_packs` 2,
`tradition_pack_releases` 2, `invitation_drafts` 2, `design_templates` 2, `invitation_versions` 1) and no
`approval_*`. Stage 7 reached no new table from the browser. That row stays as written.

16. `README.md:194-195` — "**31 unit tests over the adapter itself** (`src/test/weddingAssetUploadRules.test.ts`,
   no engine needed, inside a 473-test / 32-file suite)". Both halves of that moved, and the first one moved
   because of this stage's own repair: `65fb4f0` added exactly one `it()` to that file when it dropped the
   duplicated byte gate. Measured rather than inferred — `npx vitest run
   src/test/weddingAssetUploadRules.test.ts` is **32 tests**, and the whole suite is **566 across 36 files**
   (`q7-logs/s7-unit-count-01.log`, taken at `9f212fd`: `Test Files 36 passed (36) / Tests 566 passed (566)`,
   104.69 s, exit 0). Repaired with both addends named, because "32 inside 566" is only
   evidence if the reader can see why it is not "31 inside 473 + rounding".
17. `feature-readiness.md`'s two Stage 6 qualification rows (`:133` and `:248` at this tree) — "**473** unit
    tests" in each. The
    number was true and is now not the suite's size, so the two rows could be read as describing the current
    tree. They were **qualified, not replaced**: 473 is what Stage 6's capture measured
    (`q6-logs/s6-final-head-gates-06.log`), and writing 566 into a Stage 6 evidence row would credit Stage 6
    with 93 tests it never ran. Each row now says "473 at Stage 6's head" and puts this head's 566/36 beside
    it with the capture that measures it. §17's own table keeps **565** for `65fb4f0`, which is what that head
    measured; the two numbers differ by the single `it()` `38a4d8a` added to
    `scripts/product-contract.test.mjs` (that file measured 14 tests before and 15 after,
    `q7-logs/s7-selftest-file-count-01.log`, `Test Files 1 passed (1) / Tests 15 passed (15)`, exit 0).
18. Commit `f8d4cb8`'s message — "the whole node suite 36 files / 565 tests
    (`q7-logs/s7-gates-postcomment-03.log`), which is **the same file and test count as before Stage 7's client
    files landed in the tree**". The measurement in that sentence is right and the comparison in it is false, so
    the correction is about the clause, not the capture: `q7-logs/s7-baseline-gates-01.log:32-33` — §2's run at
    `56fbb46`, before any Stage 7 code — reads `Test Files 32 passed (32) / Tests 473 passed (473)`. The suite grew
    by four files and 92 tests across that commit's own tree (91 from Stage 7's four client files, 1 from
    `65fb4f0`), which is the opposite of "the same count", and the sentence is the kind a reviewer would use to
    conclude the client work displaced nothing. It is pushed, so it stands and is corrected here: the addends are
    473 + 1 + 91 = 565 at `f8d4cb8`, and 566 at `9f212fd` and after (§17's table carries the per-head numbers).
    Rewriting the message would destroy the evidence that a false clause was published, which is worth more than
    the tidiness.
19. The checker's Stage 7 copy guard shipped as three paraphrases and one real sentence.
    `MUST_NOT_MATCH` gained four entries when the reviewer page landed, asserting that the reviewer's own words
    must stay writable; three of the four were plausible *rewordings* of copy the product does not print, and each
    of those three measures zero occurrences across the whole repository (`q7-logs/s7-checker-copy-presence-01.log`).
    A guard like that is not decorative — it is the reason a later sweep cannot flag "This review link is not
    available." as retired-brand-shaped text — but a paraphrase guards nothing, because the sentence it protects
    is not the sentence in `src/`. Repaired in `38a4d8a`: the five strings are now the app's own, held in one
    exported list (`SHIPPED_REVIEWER_COPY`, `scripts/check-product-contract.mjs`) and each measured at exactly one
    occurrence, and `scripts/product-contract.test.mjs` reads the two shipped reviewer sources and fails if any of
    them stops appearing there, so the drift class has a test rather than a promise. Self-test re-taken after the
    repair: `node scripts/check-product-contract.mjs --self-test` → "30 rule(s) verified", exit 0
    (`q7-logs/s7-checker-repair-01.log`), and the vitest tier of the same file at 15 tests (`-02.log` ran red
    first, `s7-checker-selftest-vitest-01.log` `code=1`, for the reason §20 names).
20. `scripts/check-product-contract.mjs`'s comment above `MUST_NOT_MATCH` (written in Stage 4, still pushed)
    describes the list as copy the app actually prints. Measured at this head: of its **33** entries, **21**
    appear somewhere outside the checker and **12** appear nowhere but the list itself
    (`q7-logs/s7-mustnotmatch-presence-01.log`). The 12 are honest as *shapes* — the list's job in `selfTest()` is
    to prove that no rule pattern matches a benign line, and it tests each entry against every rule pattern
    ignoring scope (`check-product-contract.mjs:847-851`), which is where their value lives — so this is a comment
    that over-claims, not a list that is vacuous. Stage 4's sentence is not rewritten here (that file is pushed
    and the clause is not load-bearing for any rule), and Stage 7's five entries are the part of the list that is
    now backed by the shipped source by test, which is what item 19 bought.
21. `README.md:244` and this file's §5 both described the Stage 7 migration as **926 lines**; the file is
    **931**. Same cause and same proof as §5's table: `dee3a52`'s comment-only edit. Both now read 931, and §5
    names the eleven section headings so a reader can re-derive the number without the engine.

## 17. Gates at the final tree, and the head this stage publishes

Written after the run; the captures are `q7-logs/s7-final-gates-01.log` (the seven node gates),
`s7-unit-subset-01.log` and `-02.log` (Stage 7's four unit files alone), and `s7-43octet-scan-03.log` (the
committed-text scan).

The sweep is `q7-gates.sh`, run from the repository at `65fb4f0fb603eb9f0403f34946022b23f8f17696` on the
`stage7/family-approval` branch, host clock 2026-10-09 12:03:35 → 12:07:35 IST, and the tree it measured had
32 dirty worktree files (its own filter excludes the two `pnpm*` files from that count; neither is Stage 7's
work, and both stay unstaged). The sweep's own marker test is not sufficient for what it printed, so the
marker state was measured directly rather than read off that line: `node_modules/.package-lock.json` is a
regular file dated 2026-10-05 16:58, `node_modules/.modules.yaml` and `node_modules/.pnpm/` are both present
dated 2026-10-08 11:14, and `node_modules/vite` is a **symlink into `.pnpm/vite@6.4.3_…`**. By the rule
`docs/audits/stage-4-tradition-pack-foundation.md:1621-1626` establishes — the symlink form, not the
presence of one marker file, is the discriminator — this is a pnpm-linked tree that npm has also written
into. That is disclosed rather than repaired, because it is the same state the Stage 6 certification ran on
and reported in its own capture (`q6-logs/s6-final-head-gates-06.log:57,:104`: `npm_marker=YES
pnpm_marker=YES vite=symlink node_modules_dirs=355`). That 355 is an `ls node_modules | wc -l` count, and the
same enumeration at this head measures 355 again. The certification sweep now prints the decomposition
rather than one ambiguous name, because the two commands a reader might reach for disagree by design:
`node_modules_ls_len=355`, `node_modules_real_dirs=327`, `node_modules_top_level_symlinks=34`. They are the
same tree: 321 non-hidden real directories plus 34 non-hidden symlinks is exactly the 355 `ls` prints, and
`find -maxdepth 1 -type d` adds the five hidden directories (`.bin`, `.ignored`, `.pnpm`, `.vite`,
`.vite-temp`) plus `node_modules` itself to reach 327, while the three hidden plain files
(`.modules.yaml`, `.package-lock.json`, `.package-map.json`) make the eight entries `ls -A` sees and `ls`
does not. The 34 symlinks are the discriminator, not an artefact of the counting: they are what a
pnpm-linked tree looks like from the top. The
consequence that matters is that the bundle figures below are like-for-like against Stage 6's: the entry
chunk moved 577.47 kB → 577.70 kB (gzip 172.27 → 172.35) across two stages' worth of work, and that +0.23 kB
is the whole of Stage 7's footprint on the non-lazy part of the bundle.

Every `exit=` below is read from the line immediately after that gate's own output, which is what makes it
a claim about that run rather than about the shell's last unrelated command.

| gate | argv as run | measured | exit |
| --- | --- | --- | --- |
| product contract checker | `npm run --silent product:check` | 197 active file(s) scanned, 0 violation(s) | 0 |
| contract self-test | `node scripts/check-product-contract.mjs --self-test` | 30 rule(s) verified | 0 |
| database contract | `npm run --silent dbtypes:check` | 21 migration file(s); schema 19 public + 10 non-client table(s); client types 19 table(s); 34 query column group(s) reconciled, 0 finding(s) | 0 |
| typecheck | `npm run --silent typecheck` | no output, which for `tsc --noEmit` is the pass shape | 0 |
| eslint | `npm run --silent lint` | 9 problems, 0 errors, 9 warnings — all `react-refresh/only-export-components`, all in `AuthProvider.tsx`, `ContentEditor.tsx` and seven `src/components/ui/*` primitives | 0 |
| unit | `npm run --silent test` | 36 test files passed, 565 tests passed, 129.35 s | 0 |
| production build | `npm run --silent build` | built in 46.37 s; `dist/` newest file 2026-10-09 12:07 against newest `src/` file 2026-10-08 19:43 | 0 |

Four things in that table are worth naming rather than leaving as green cells.

The nine eslint warnings are not Stage 7's. Every one of them is the fast-refresh rule on a file this stage
did not create or edit, and none of `familyReview.ts`, `publicReview.ts`, `FamilyReview.tsx`, the host panel
or `EditProject.tsx` appears in the list — so the honest reading is that Stage 7 added no warning and
removed none, and the count is the repo's standing one.

565 is 473 + 1 + 91, and each addend is a measurement rather than an assumption. Stage 6's head measured
473 across 32 files (`q6-logs/s6-final-head-gates-06.log`); the +1 is the single `it(…)` that `65fb4f0`
added to `src/test/weddingAssetUploadRules.test.ts` when it repaired the duplicated byte gate; and the +91
is Stage 7's four files, which were also run alone so the 91 has a list behind it — `familyReviewPanel.test.tsx`
27, `familyReviewShape.test.ts` 27, `familyReviewPage.test.tsx` 22, `familyReviewTransport.test.ts` 15, 4
files 91 tests `exit=0` at `q7-logs/s7-unit-subset-01.log` and `-02.log`, both stamped at
`65fb4f0…` on 2026-10-09 12:09 and 12:10. 36 files is Stage 6's 32 plus those four.

The build prints Stage 7's own two chunks, which is the check that the reviewer door is lazy-loaded rather
than folded into the host bundle: `familyReview-CCm8c6p9.js` 8.53 kB (3.21 kB gzip) and
`FamilyReview-DPbe9XSa.js` 8.94 kB (3.43 kB gzip), next to `PublicInvitation-BE1A9Mg8.js` at 2.39 kB. The `index-Fm4eWRT1.js` 577.70 kB chunk and the "Some chunks are
larger than 500 kB" warning are the standing condition `docs/audits/stage-3-public-invitation.md:1627-1631`
records — Vite's threshold was never raised, the warning still prints, and the guest-facing chunks stayed
separate — and Stage 6's certified build printed it too (`q6-logs/s6-final-head-build-03.log`, same tree
shape as this one). Stage 7's contribution to it is the +0.23 kB above; the reviewer's code is in the small
chunks, not in the index.

**The 43-octet scan, and the five literals that deserve a reader's attention.** The rule under test is
§I10's: a minted review credential must not enter database records, committed code, telemetry or logs. The
first capture's version of that scan was not adequate to the claim and says so in its own shape: it printed
`head -40` of a `scan_hits=65` line, and that number counts *files*, so 25 of the 65 had no line behind
them. `q7-logs/s7-43octet-scan-03.log` replaces it with the complete enumeration — every matching tracked
file with its count, the files-with-a-match grouped by tree (9 under `docs/` outside the audits, README 1,
`content/` 1, the lockfile 1, `src/` 13, `supabase/` 32, `scripts/` 8 — which is where the 65 comes from),
and a shape classifier that never prints the
matched bytes. Over 258 source/test/doc files (excluding `docs/audits/`, which is exempt by the rule's own
terms, and `package-lock.json`, whose 361 matching lines are base64 SHA-512 integrity digests — the capture
prints `audit_files_in_set=0` and `package_lock_in_set=0` because an earlier form of this scan leaked this
stage's own untracked audit file into its exclusion list's blind spot, counted five extra filename runs, and
had to be re-run rather than re-worded) the 509 runs
distribute as 417 separator-comment hyphen runs, 60 filename-or-hash runs (the migration and ADR file names
are themselves ≥43 characters in the `[A-Za-z0-9_-]` alphabet, which is why the mask eats them), 22
snake_case SQL/TS identifiers, 5 digit-only literals, and **5 runs that are credential-shaped**: mixed
case, digits, ≤2 separators, exactly 43 characters, and delimited by quote characters — i.e. the profile a
minted token has. The classifier is `q7-logs/shape-analyze.mjs`, kept outside the tree so that distribution
is re-derivable rather than taken on faith: it takes file paths on argv and prints line numbers and shape
counts, never the matched bytes.

Those five are in this stage's own test files: `supabase/tests/api/stage7_family_approval.test.mjs:830` and
`:1109`, and `supabase/tests/stage7/80_family_review.sql:758`, `:764`, `:768`. Each is what its surrounding
assertion calls a well-formed credential that was **never minted** — the forged input whose whole purpose is
to get past the 43-character grammar check and die at the digest lookup, which the case then asserts is
answered with the same closed refusal as no credential at all (`D-03`, `A-10`, and the V/W groups). None of
them can be a live credential, and the proof is internal to the battery rather than a reassurance: a
committed value that *was* minted would make those assertions fail, because they require the refusal. The
disclosure exists because the distinction is unobservable from the bytes — `run.sh`'s `mask()` is there for
exactly this reason, and a reader who cannot tell a forged literal from a leaked one is entitled to a note
saying which it is. Nothing in the tree, the SQL batteries' output or `q7-logs/` carries a credential that
the stack issued.

**Re-taken at `9f212fd`, and what moved.** The same sweep ran again on 2026-10-09 16:33→16:36 IST at the
head the browser tier published, with five dirty worktree files rather than 32 (`q7-logs/s7-final-gates-02.log`),
and all seven gates returned `exit=0`: 197 active files and 0 violations, 30 rules verified by the
self-test, 21 migration files / 19 public + 10 non-client tables / 34 query column groups reconciled, no
`tsc` output, the standing nine eslint warnings and no error, `✓ built in 1m 5s`. The unit suite measures
**36 files / 566 tests**, one more than the row above, and the +1 has a name: `38a4d8a` added the presence
assertion to `scripts/product-contract.test.mjs`, the file that binds `SHIPPED_REVIEWER_COPY` to what
`FamilyReview.tsx` and `publicReview.ts` actually print — which is why §18's unit row and `README.md` say
566 while this table, stamped at `65fb4f0`, says 473 + 1 + 91 = 565. The build reproduced the same four
chunk names, and names are the proof (Vite puts a content hash into every one), measured straight off
`dist/` because `gate()` prints only the last 28 lines of a gate's output and that is not enough to
re-derive a chunk from: `index-Fm4eWRT1.js` 577,696 B (gzip 172.35 kB), `familyReview-CCm8c6p9.js`
8,530 B (3.21 kB), `FamilyReview-DPbe9XSa.js` 8,939 B (3.43 kB), `PublicInvitation-BE1A9Mg8.js` 2,388 B
(1.17 kB), over `dist_files=35` / `dist_total_bytes=1,052,473` / `dist_js_css_html_files=33` /
`dist_js_css_html_bytes=1,031,926` (`q7-logs/s7-dist-chunk-measure.mjs`, kept outside the tree so the
measurement is re-runnable rather than re-quoted). That last figure is 32 bytes under §20 E's
`bytes: 1031958`, and the gap is the two instruments' definitions rather than the bundle: the prelude
concatenates the 33 files with `texts.join("\n")` and measures the joined string, which adds exactly the 32
separators between 33 entries, while the helper sums `statSync` sizes. 33 files on both sides, and the
difference is arithmetic, not bytes on disk.

The sweep's own instrument changed in that run, which is a reportable act, not a silent one: three lines
replaced the single ambiguous `node_modules_dirs`, and the dist-chunk block was added. No gate was dropped
and no threshold moved, so the two captures remain comparable.

One number in the older capture needed re-deriving rather than re-quoting. The I10 committed-text scan
printed `scan_hits=65` at `65fb4f0`; at `9f212fd` the same pathspec over the tracked tree matches **76**
files (36 `supabase/`, 19 `src/`, 9 `scripts/`, 9 `docs/`, README, `content/`, the lockfile), and the
eleven-file gap is precisely the files Stage 7's own four commits added — the reviewer's transport module,
its page, its adapters and four unit files, the widened checker and its self-test, and the browser driver.
The shape classifier was therefore re-run over the wider set, not extrapolated
(`q7-logs/s7-43octet-scan-04.log`, 75 files with the lockfile and the audit directory excluded, matching
-03's file-set rule): 510 runs distribute as 417 divider runs, 22 identifiers, 5 digits-only, 61
filename-or-hash (+1, a new file name of its own), and **`CREDENTIAL_SHAPED_RUNS=5` at the same five
coordinates as -03** — `stage7_family_approval.test.mjs:830`, `:1109`, `80_family_review.sql:758`, `:764`,
`:768`. The set of credential-shaped literals did not grow with the tree, which is the form of this claim
that survives Stage 7's own UI commits.

**What these numbers do not say.** They are node-gate numbers on a local tree: they say nothing about
PostgREST, Supabase Auth, Storage or a hosted project, and none of them was produced by CI (the Actions
quota is exhausted, so there is no run id behind any cell above). The unit and build gates ran at
`65fb4f0…`, which is not the SHA this stage publishes; the difference between that head and the published
one is the files this sweep enumerated plus this file, and the commits add no edit to any file the gates
read — which is the same head-certification shape Stage 6 closed, so it is answered by re-taking the gates
into `q7-logs/` at the final head rather than by writing another section about the need for one.

## 18. Which captures describe the published tree, and what that question cannot be answered with

A tier is evidence for a tree only if the tree it ran on is the tree that gets published, so each tier's
capture time was compared against the modification time of its own inputs rather than against a general
feeling that the run was recent. Measured on 2026-10-08 and re-taken on 2026-10-09 after §20's three edits,
alongside §17's node gates and unit subset; files read from the working tree:

| tier | capture | newest input of that tier | stands? |
| --- | --- | --- | --- |
| SQL, Stage 7's two batteries | `s7-stage7-runner-review-03.log` 17:28, `s7-stage7-sql-pair-01.log` 17:16, `s7-stage7-runner-historic-clean-01.log` 17:30 | `80_family_review.sql` 13:43, `90_review_boundary.sql` 17:24 — both older than the runs; **`supabase/tests/stage7/run.sh` 19:50 — later than all three**; **the migration itself 2026-10-09 13:02:23 — a day later** | with two disclosed gaps, below and §20 A |
| HTTP, seven files | `s7-http-runsh-03.log` 18:31 | the six older files newest at 18:25:57 and `supabase/tests/api/run.sh` at 18:18:17 — both before the run; **`stage7_family_approval.test.mjs` 2026-10-09 12:40:38**; the migration again | with one disclosed gap, §20 B |
| Browser, four journeys | `s7-run-full-4.txt` 21:10 (run tag `s7ui-muzpa0r1-kvklf`) | `scripts/stage7-browser-review.mjs` 21:07; `dist/` built 20:19 after the newest `src/` file at 19:43 | yes, and the bundle-only half re-taken at this head (§20 E) |
| Unit | `s7-unit-subset-01.log` 12:09 and `-02.log` 12:10 on 2026-10-09, plus the whole-suite run inside `s7-final-gates-01.log` 12:04-12:07, and `s7-unit-count-01.log` 15:54 | the whole `src/` tree, newest 2026-10-08 19:43 | yes, by construction |

The SQL row's gap is the one thing a reader should press on, and it was investigated rather than smoothed.
`run.sh` was edited at 19:50, after the captures that quote its output. What can be shown without the
engine is that the file in the tree now is the file that printed those captures, in three independent
respects: every suite label the current enumeration produces appears in the captures
(label-for-label — the two Stage 7 labels four times in the review capture, and each of the ten static
historic labels twice, once per chain, with the loop-generated Stage 5 and Stage 6 labels resolving to
the 122/50/124/90/80 lines §8.2 tabulates); the summary format at `run.sh:157` is the exact string the
captures print (`[PASS lines observed: N, counted: lines|counter]`); and the head-shaped probe at
`run.sh:196-200` prints `DECLARED_HEAD=stage7 / API_NAMES=13 / INTERNAL_NAMES=24`, which is what both
captures show directly above the suites that assert those numbers — the file's own comment at `:90-96`
records that the *earlier* form of that probe printed `(unset)/0/0`, so the captures cannot have come
from the pre-fix code. What cannot be shown without a re-run is that the 19:50 edit changed no counting
behaviour that a green run does not exercise; the honest statement of that limit is that the totals
describe the runner as it stood at 17:28, and the runner as it stands at 19:50 has not been executed.
The change visible in the file is the opt-in `STAGE7_LOCAL=1` backend at `:67-72` and the exit-3 hint at
`:84` that points at it — a branch the container path never enters.

The SQL row acquired a second gap on 2026-10-09, and the HTTP row a first, when `dee3a52` and `465c6bb`
landed; both are measured in §20 rather than smoothed here, and the short form is that the migration edit is
twelve added lines of which eleven are comments plus one catalog string that nothing in the repository reads,
and that four of the HTTP tier's five committed files are provably the bytes their capture measured — only
Stage 7's own battery file carries a gap, bounded there by label identity in both directions. What §20 does
not do is close either gap: a bound is not a re-run.

That re-run is currently blocked, and the block is the stage's only outstanding environment dependency.
The Docker engine went down on 2026-10-09 while this section was being written: `docker ps` fails on the
Desktop Linux pipe, no Docker backend process is running, and the six `supabase_*_localvivaahvarnam`
containers that were `Up 13 hours (healthy)` when the day started are unreachable. It was not restarted
from this seat because the engine is shared with another project's containers, which makes starting it a
shared-state action rather than a local step. Until it is back, three tiers cannot be re-taken (the SQL
runner needs `docker run`, the HTTP tier needs the stack on 54400, the browser tier needs the stack and
the preview on 4173), and the scratch container this stage created cannot be removed. Nothing in this
section depends on a re-run being possible; the numbers above are the numbers that were measured.

What this stage does not claim, and cannot from a local stack:

* that any of it works against a hosted Supabase project — nothing was linked, pushed, pulled or reset
  against a remote, and no `*.supabase.co` origin is reachable from the code or the tests;
* that a real relative behaves as the browser tier's scripted reviewer does, or that the journeys
  measured real network conditions, real fonts over a CDN, or a real phone;
* that a review link reaches anyone: the product shows the link once and delivers nothing — no email, no
  SMS, no WhatsApp — so "a parent reads the invitation" is verified only as "a person holding the address
  can read it";
* that the person behind an answer is the person the host named. §5's classification stands as a
  limitation, not a to-do this stage closed;
* that the private asset boundary extends to the reviewer's door in any direction — the reviewer sees the
  frozen document, and no photograph key is projected there — `90_review_boundary.sql`'s K-group measures
  exactly that absence, and §12's journey A shows the reviewer's page carrying no account affordance;
* anything at all about production traffic, retention, or deletion, which §11 leaves where
  `domain-model.md:383-385` puts it.

GitHub Actions was not used: the quota is exhausted, so every number in this file is local, and no CI
badge, log or run id backs any of it.

## 19. Cleanup, scoped to what this stage created

* **Containers.** The SQL runner names its own throwaways `vivaahvarnam-stage7-$$` and removes them in an
  `EXIT` trap (`run.sh:74-75`), so as far as its own code goes its chains left nothing behind; the manual
  historic replay used `vivaahvarnam-s7hist-844`, and the paired battery run re-used a scratch cluster
  `vivaahvarnam-s7probe-1461` that was still live at 17:16 when that capture began. Whether either is
  still present cannot be checked while the engine is down, and nothing was deleted on the strength of a
  guess; the scratch probe cluster is the named item to remove when the engine returns, and the replay
  container, if it survives, is the second. The six `supabase_*_localvivaahvarnam` containers were left
  exactly as found — not
  stopped, not restarted, not `db reset` — both because the directive said to preserve running containers
  and because a reset would have destroyed the state several captures were taken against. No container
  outside those names was touched.
* **Evidence.** `q7-logs/` lives outside the repository and stays out of every commit; it holds masked
  captures only, and §8.1 records the one capture whose 43-character self-check reads `1` and what that
  `1` actually is. Two of its own outputs are superseded inside the same directory rather than rewritten:
  `s7-final-gates-01.log`'s secret-scan block prints 40 lines against a file-count it labels `scan_hits=65`,
  so `s7-43octet-scan-02.log` and then `-03.log` carry the enumeration §17 quotes — `-02` is kept rather
  than deleted because its own file set wrongly included this stage's untracked audit file, and `-03` is the
  re-run that excludes it — and the same sweep's one-line
  installer test is replaced in §17 by the three marker paths measured directly. Every older file is kept
  unmodified — a capture that was inadequate is evidence that it was inadequate. The scan's classifier,
  `q7-logs/shape-analyze.mjs`, is this stage's own scratch file and lives outside the tree for the same
  reason as the captures.
* **Scratch probe kept, not deleted.** `%LOCALAPPDATA%/Temp/stage7-referer-probe.mjs` (authored 2026-10-08
  for journey C's finding, §14.2) writes nothing, contacts only loopback and the two font hosts, and holds
  an invented token it never prints. It is kept because it is the only re-runnable form of that
  falsification, and it is outside the tree so it cannot be committed by accident.
* **Not touched.** The `%LOCALAPPDATA%/Temp/diffbeacon-stage7-browser` temporary-profile tree was left
  alone after measuring it: its entries carry dates from 2026-10-04 and 2026-10-05 as well as this
  stage's, so it is a shared directory rather than this stage's output, and the same scoping rule that
  keeps other projects' containers out of reach keeps it out of reach. The `*.scratch.*` files in the
  workspace root belong to earlier stages and were likewise left where they are.
* **Untracked by design.** `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain unstaged. This repository
  tracks `package-lock.json` and this stage's gates ran on the npm tree; a pnpm lockfile written by an
  outside install is not this stage's artefact and is not committed by it.

## 20. Three files newer than the runs that quote them, and one count taken from the wrong artefact

§18 asks whether each tier's capture describes the tree that gets published. For three inputs the answer is
"not directly", and this section carries what can be measured instead of a sentence asking the reader to
trust. Each item ends with the thing the argument does *not* buy.

**A. `dee3a52` edited the migration after every SQL capture, and the proof that it changed nothing runs
through the catalog, not through prose.** `git show --stat dee3a52` is one file, 12 insertions and 7
deletions, in two hunks: `@@ -495,6 +495,11 @@` and `@@ -917 +922 @@`. Of the seven removed lines six begin
`--` and of the twelve added lines eleven do; the single non-comment line on each side is the string literal
that is the argument of `COMMENT ON FUNCTION internal_api.submit_family_review(text, text, text, text)`. So
exactly one SQL statement in the file is touched, and it is a catalog-comment statement.

The obvious defence — a comment is discarded by the parser — is not sufficient here, and saying so is the
point. A `--` line inside a `$$ … $$` body is *stored*: it survives into `pg_proc.prosrc`, so
`pg_get_functiondef()` for that function genuinely differs before and after the edit. A test that greps a
function's stored text would therefore move. Measured, no such test exists: `pg_get_functiondef` appears
nowhere in the repository, and `prosrc` appears once, at `supabase/tests/api/stage5_admin_cli.test.mjs:448`,
where it asks a Stage 5 function whether it contains a `delete from public.tradition_pack` phrase — a body
this migration does not touch. The other catalog readers name a wider set (18 tracked files match
`pg_proc|prosrc|pg_get_functiondef|routines|pg_proc`) but ask only about names, namespaces, argument lists
and grants — Stage 7's own file reads pronames at `stage7_family_approval.test.mjs:297` and argument-emptiness
at `:306` — and the edit changes none of those. On the catalog-comment side, `git grep -E
'pg_description|obj_description|shobj_description'` over tracked files returns one hit repo-wide,
`supabase/migrations/20260926150000_stage3_privileged_bodies_behind_wrappers.sql:663`, which is a section
heading written in prose rather than a query; over `src/`, `scripts/`, `supabase/tests/` and `content/` it
returns zero. Nothing reads the row the edit rewrites.

The consequence for state, which a reader inherits rather than the argument: the local development database
was applied before `dee3a52`, so one `pg_description` row in it carries the *old* sentence while the
published migration writes the new one. That is the entire difference between the captured schema and the
schema the tree describes. The consequences for this file are §5's table spans, each of which moved by +5,
and the migration's size, 926 → 931 (item 21).

The same shift moved a second file, and the sweep found a mistake that was not caused by the shift.
`docs/architecture/family-approval-review-security.md` cites the Stage 7 migration by bare line span 36
times as written, 40 at the corrected head (the rewrite below added four). Of those, 19 occurrences across
18 distinct spans were five lines early — `:577-583`, `:911` (twice), `:854-856`, `:858-861`, `:796-799`,
`:895-899`, `:557`, `:558`, `:752-756`, `:564-575`, `:523-536`, `:606`, `:603-612`, `:615-622`, `:549-555`,
`:593-601`, `:731-756`, `:773-791` — and each was re-pointed against
the published file rather than by arithmetic alone: `:582-588` is the `IF NOT FOUND` block that gives the
one refusal phrase, `:562`/`:563` are the header read and the shape filter, `:569-580` the six-predicate
lookup, `:598-606` the section-key `NOT EXISTS`, `:608-617` the feedback `INSERT` and the status `UPDATE`,
`:620-627` the `v_rows <> 1` replay guard, `:757-761` the credential revocation inside
`create_invitation_version`, `:900-904` `one_live_token_per_approval_request`, `:916` and `:922` the two
`COMMENT`s. The spans below 501 were left alone and spot-checked instead of assumed: `:127` is still the
`gen_random_bytes(32)` line, `:129-140` the `access_tokens` `INSERT`, `:112-116` the expiry default,
`:388-390` the door's header read and filter, `:399-408` and `:426-430` the resolve lookup and the
`last_used_at` stamp, `:435-438` the section-key array. What the sweep then found at the doc's §7 had
nothing to do with numbering: it asserted that submit's "single interaction with `invitation_versions` is
a `SELECT` of `version_number`", which is false in both halves. Submit touches that table once, at
`:600-601`, and reads `v.snapshot -> 'sections' -> 'items'`; `version_number` is read by the review door at
`:414` and by the host queue at `:258`, neither of which is the answer path. The doc's own bullet three
lines above already said the true thing, so the file contradicted itself. The sentence is now the measured
one, cites `:495-505` and `:922` for the rule as the migration states it, and names the immutability guard
as the Stage 2 trigger `versions_immutable_no_update`
(`20260925120200_stage2_versions_and_publication.sql:50`) rather than "the Stage 3 freeze trigger" — a
BEFORE UPDATE trigger created by Stage 2, with no Stage 3 counterpart. This correction is made in place,
with the disclosure here rather than in a later section, because the document has never been committed:
the append-only rule binds the audit file at its own head, and there is no published text of this doc for
a reader to have been misled by yet.

What this does not buy: `s7-stage7-sql-pair-01.log` 17:16, `s7-stage7-runner-review-03.log` 17:28 and
`s7-stage7-runner-historic-clean-01.log` 17:30 all ran on 2026-10-08 against the pre-edit file, whose
working-tree copy is now dated 2026-10-09 13:02:23. The reasoning above is that the batteries cannot measure
the difference; it is not a re-run, and it rests on a reader accepting a grep of the repository as evidence
about what those batteries do. When the engine returns, §8's pair re-runs in minutes and this paragraph
becomes history rather than argument.

**B. The HTTP battery file is 18 h newer than its own capture, and the case labels are what survive that.**
`supabase/tests/api/stage7_family_approval.test.mjs` carries mtime 2026-10-09 12:40:38 and entered git at
`465c6bb` (12:43:08); the run that quotes it, `s7-http-runsh-03.log`, is dated 2026-10-08 18:31:11. The
version that actually ran on 10-08 was never committed, so there is no diff to inspect and the ordinary
freshness method is unavailable. What replaces it is two-directional label identity,
`q7-logs/s7-http-freshness-label-04.log`, `code=0`: the capture's Stage 7 block prints 61 `✔` case lines and
0 failures; the file declares 58 `test('…')` literals plus one template that emits G-01 once per host verb,
which is 3, so 61 declared labels; capture labels absent from the file = 0; declared labels with no
identical line in the capture = 0; `RESULT labels-missing=0 unmatched=0 capture-cases=61 file-labels=61`.
The other six files in that directory are all older than the run — newest is
`stage5_pack_driven_http.test.mjs` at 18:25:57, and `supabase/tests/api/run.sh` at 18:18:17 — so the HTTP
tier's *runner* has no gap at all and only this one file does.

That last clause is a positive result and should be read as one, because it is the opposite of §18's SQL
row. `465c6bb` is the only commit that ever wrote `run.sh`, `stage3_publication.test.mjs`,
`stage4_tradition_packs.test.mjs` and `stage5_pack_driven_http.test.mjs` (49, 80, 20 and 17 lines
respectively), it wrote them at 12:43:08 on 10-09, and each file's last write in the working tree precedes
the capture — 18:18:17, 12:10:02, 18:20:11, 18:25:57 on 10-08, all before 18:31:11. Since a modification
time is the time of the last write, none of those four was touched between the run and the commit, so the
bytes `s7-http-runsh-03.log` measured are the bytes this stage publishes. 281 − 61 = 220 of the tier's
cases therefore sit on committed bytes that are provably the ones that ran; the 61 are bounded the way B
bounds them. The leak census §9 describes lives in `run.sh`, which is one of the four.

Identity shows the case *set*; it does not show that a predicate inside a case is unchanged. The commit that
made the edit says what the edit was — `465c6bb`'s message records one line changed inside the leading
comment block, where the header named `80_family_approval.sql` while the battery file in the tree is
`80_family_review.sql` — and that correction is visible at `stage7_family_approval.test.mjs:3`, with
`node --check` exit 0 as the no-syntax-damage check. The limit is the same shape as A's: the file's 10-08
working copy is unrecoverable, so the bound is "the labels match and the one described change is a header
comment", not "the bytes are the bytes".

Three of the four captures for this check are wrong, and they are kept rather than deleted because each
records a distinct filter bug. `s7-http-freshness-label-01.log` reports 14 labels ABSENT because it compared
possessive case names against source text without accounting for `\'` escaping; `-02.log` and `-03.log` both
report 14 unmatched because they unescaped the source *before* extracting labels, which truncates every
label at its apostrophe and then cannot find the truncated string in the capture. `-04.log` is the form that
extracts from the raw file with an escape-aware class — `/^ {2}test\('((?:[^'\\]|\\.)*)'/gm` — and unescapes
only the captured group. The script is one file, `q7-logs/s7-http-freshness-label-01.mjs`, edited in place,
so its current body is `-04`'s and the four logs are the audit trail of the four outputs.

**C. `9f212fd`'s message counted a tier's assertions from an artefact that structurally cannot see itself.**
§13 carries the corrected figures, the disclosure, and the byte-pinning proof that `kvklf` is the post-write
run; the mechanism belongs here in one sentence: the driver writes the evidence log *while* counting, so the
log never contains its own two self-describing lines, and a tally read off it under-reports by exactly one
check and one measurement — 103/16 against the console's 104/17, and four findings rather than three because
the console form also carries the masking check that had nothing to mask.

**D. The checker's presence test went red before it went green, and the red is the reason the green means
something.** Item 19 deferred this. `s7-checker-selftest-vitest-01.log` reads `code=1`, `1 failed | 14
passed (15)`, with `ENOENT: no such file or directory, open '…\s5qual\scripts\undefined'` — the new test
built its input path from a value that had none, so it tried to open a file literally named `undefined`.
That is a defect in the test harness, not in the product, and it is exactly what makes `-02.log` usable:
a test that cannot locate its input cannot pass, so `Test Files 1 passed (1) / Tests 15 passed (15)` at
13:22:38 is the test opening `src/pages/FamilyReview.tsx` and `src/integrations/supabase/publicReview.ts`,
which is what `scripts/product-contract.test.mjs:237-246` does, rather than comparing two constants to each
other.

**E. Half the browser tier is reproducible without the engine, and that half was re-taken at this head.**
The journeys need the stack, but the prelude's two bundle-only assertions are pure reads.
`q7-logs/s7-browser-prelude-offline-02.log`, at `9f212fd` on 2026-10-09 16:07:49 IST, runs
`node --check scripts/stage7-browser-review.mjs` (`code=0`) and then the prelude against the `dist/` rebuilt
at 13:31:33: `driver SENTENCES entries: 5 | bundle js/css/html files scanned: 33 | bytes: 1031958`, five
`present` lines, `hosted Supabase origins baked into the bundle … 0 (none)`, `RESULT copy-missing=0
hosted-origins=0`, `code(prelude)=0`. Those three numbers are identical to the ones `-01.log` printed, which
is the whole value of the re-run: that part of the tier is not a claim about a stale capture. The script
reads the driver's own `SENTENCES` list out of the committed file, so it cannot drift from what the tier
asserts.

What E does not do is re-prove a journey. The run at 21:10 on 10-08 used the `dist/` built at 20:19 that
evening, and that tree is gone. `s7-bundle-identity-compare-02.log` compares *names* between a 23-name
enumeration of the older build and the 32-asset rebuild — `only in 12:07: none`, `shared: 23` — and since
Vite writes the content hash into the filename, a shared name is shared bytes. But the older side is a
subset enumeration, not the complete asset list, so the honest reading is "the new bundle carries everything
the old one did, plus nine small chunks that enumeration never named", not "the bundle is unchanged".
`compare-01.log`'s name-plus-size form is not usable evidence at all — `identical name+size rows: 0 of 25`
is an artefact of comparing Vite's formatted size column, and it is why `-02` exists.

Taken together these five items bound the three gaps §18's table records; they do not close them, and none of
them is offered as a substitute for the SQL/HTTP/browser re-runs that a restarted Docker engine would make
possible.

## 21. The engine returned, the three tiers ran at this head, and §20's bounds became re-runs

§18 closed on a block and §20 closed by declining to pass its arguments off as a substitute for lifting it. The
engine came back — started from the Desktop UI by the human rather than from this seat, because the same daemon
hosts another project's twelve containers and starting it is a shared-state action — and the three tiers were
then run at `48568ce485a913a07f4da1c49e118fe64ffbe49d`, the head this file describes, between 19:01 and 19:09
IST on 2026-10-09. Each was invoked with the command its own runner documents rather than an improvised one:
`bash supabase/tests/stage7/run.sh both`, `bash supabase/tests/api/run.sh`, then `npm run build` followed by
`node scripts/stage7-browser-review.mjs` against the preview on 4173.

**Freshness is now measured rather than argued.** Every input of every tier is older than the capture that
quotes it, so the two disclosed gaps in §18's table and the two bounded gaps in §20 are gone:

| tier | capture window | newest input of that tier, measured | gap |
| --- | --- | --- | --- |
| SQL, both chains | `s7-qual-sql-both-01.log` 18:59:33 → 19:01:25 | `20261008120000_stage7_family_approval_review.sql` 2026-10-09 13:02:23; `supabase/tests/stage7/run.sh` 2026-10-08 19:50:08 | none — §18's row and §20 A both named these files and both are now antecedent |
| HTTP, seven files | `s7-qual-http-01.log` 19:02:08 → 19:05:32 | `supabase/tests/api/stage7_family_approval.test.mjs` 2026-10-09 12:40:38; `supabase/tests/api/run.sh` 2026-10-08 18:18:17 | none — §20 B's eighteen-hour gap is replaced by a run that postdates the file |
| production build | `s7-qual-build-01.log` | newest `src/` file 2026-10-09 13:05:58; `dist/index.html` written 19:06:59 | none |
| Browser, four journeys | `s7-qual-browser-01.log` 19:07:22 → 19:09:39 | that `dist/`, plus `scripts/stage7-browser-review.mjs` 2026-10-08 21:07:23 | none |
| Unit and node gates | `s7-final-gates-05.log` 18:42 → 18:45 | the whole `src/` tree, newest 13:05:58 | none, by construction |

**The numbers, each from the capture named above.**

* SQL, `runsh_exit=0`: three chains reach the Stage 7 head and each prints
  `DECLARED_HEAD=stage7 / API_NAMES=13 / INTERNAL_NAMES=24`; Stage 7's own batteries are
  `80_family_review: PASSED (255)` and `90_review_boundary: PASSED (116)`; on both historic chains the twelve
  older suites re-measure at Stage 2 42 (clean) / 76 (legacy), draft 46 / 49, publication 284, RLS attacks 464,
  catalog 103, Stage 4 428 and 57, Stage 5 122 / 50 / 124, Stage 6 90 / 80. The capture carries zero raw
  43-character runs and zero `[REDACTED-43]` markers — a green run gives the runner's mask nothing to redact,
  which is the property §17 claims of it rather than an absence of instrumentation.
* HTTP, `runsh_exit=0`: 38 / 56 / 28 / 36 / 28 / 34 / 61 = **281** tests across the seven files, `fail 0`
  reported in every block, `==> RESULT: PASS`, and the post-run check restoring all ten counted tables
  (`weddings`, `auth.users`, `invitation_drafts` back to the baseline 1 each; the other seven at 0).
* Build, exit 0: 2219 modules, 38.04 s. Measured directly out of `dist/` rather than from the gate's tail-cut
  log: `35` files / `1,052,473` bytes, of which `33` JS/CSS/HTML files / `1,031,926` bytes. Those four numbers
  are identical to the same measurement taken at 18:45 in `s7-final-gates-05.log`, so the bytes the browser tier
  drove are the bytes the node gates measured; the tier's own prelude independently scanned 1007 KB of
  JS/CSS/HTML against them.
* Browser, `tier_exit=0` on the line after the verdict: four journeys A–D, `checks 104, measurements 18,
  findings 0`, `STAGE 7 BROWSER TIER: PASS`, run tag `s7ui-mv10fb9z-4yhnl`, teardown reporting
  `0 weddings, 0 asks, 0 feedback, 0 credentials, 0 accounts` and
  `6 credential(s) registered, 5 appeared in what this run tried to print, 5 write(s) were rewritten,
  0 escaped`.

**§20's items, restated for what they now are.** A and B were bounds on gaps that the re-runs closed, and the
argument-work in them is no longer load-bearing: the migration the §20 A edit touched is now the migration the
capture ran, and the battery file §20 B could only bound by label identity is now the file that printed those
labels. C and D are about artefacts and stand exactly as written. E's bundle-only half was simply re-taken
inside a complete tier, so the subset comparison against the 10-08 build — the one §20 called "the bundle is
unchanged, which is not what it proves" — carries no part of the browser evidence any more.

**Where each boundary the qualification asks about is answered, by case, at this head.** The SQL column names
labels read out of the two battery files; the runner prints suite totals, not per-case lines, so that column
says which assertions the 255 and 116 cover rather than quoting them. The HTTP and browser columns are labels
and assertion texts printed by the two captures above.

| boundary | SQL battery | HTTP battery | browser tier |
| --- | --- | --- | --- |
| a review credential is stored one-way, and never raw | A8, A8b, A8c, A8d, A8e, Z4 | K-01, C-01, C-02, C-06, D-08, Q-05 | "the row's credential is one-way (digest equals SHA-256 of the link, not the link) — 64 chars, matches sha256(link)=true"; "no raw review credential is stored in any column of the three review tables — 0 of 1 credential(s) found in 1584 chars of stored text" |
| one account cannot reach another's review | B-group, F3, G8d, K11, K12 | G-03, G-05, G-06, Q-06, D-10 | a stranger's dashboard "lists none of the host's invitation"; "a signed-in stranger on the host's project URL reads no review queue at all" |
| credential kinds do not cross doors | N1, N3, N4, N5, N6, N7, N8 | D-04, D-05, C-04, T-01, T-03 | "every credential-carrying request is one of the two review RPCs, over the one header" |
| expiry | E1, E2, E4, E5, E7, E8, E8c, E14 | K-02, K-06, D-07 | not exercised — a tier cannot wait out fourteen days; the window is crossed by setting it, so the refusal is measured at both doors rather than on a clock |
| replay, and one answer per ask | N7, S17, S18, X9, X13, I11 | A-03, A-11, D-06, K-10 | "the same link, reopened after the answer, refuses with the one sentence"; "and exactly one feedback row exists for it — 1" |
| the frozen snapshot does not move when a reviewer answers | I18, I19, N5, N6, P0–P4 | A-09, A-12, X-03 | "the recorded answer left the frozen snapshot byte-identical to what the reviewer read — digest before eae1334a6960…, after eae1334a6960…"; "and no second version was written by the review — 1" |
| forged, malformed and withdrawn credentials | K2b, K3, K5, K7, K8, E10, I13 | D-01, D-03, A-10, K-09, K-10 | "a well-formed credential that was never issued refuses with the same sentence"; "a malformed credential is refused locally, without a round trip — resolve calls: 0" |
| who may call, and where the wrappers are not exposed | G1–G8, G3a–G3f | G-01 (×3 verbs), G-02, T-01, T-02, Q-01–Q-05 | "the five Stage 7 verbs are on the stack this run will exercise"; "the reviewer page offers no account affordance at all — none" |
| family review stays separate from cultural-authority review | C1, C2, C3, C4, C5, C6 | — no Stage 7 HTTP case names this invariant; the separation is carried by the SQL battery alone | — the `product:check` rule `ceremonial-authority-claim` guards copy that *claims* a cultural review happened, which is a different assertion from this one |
| a credential never leaves this machine, or a log | — | — | "no credential of this pass reaches a host outside this machine — nothing crossed the loopback edge"; "no Referer that leaves this machine names it or carries a credential-shaped string" |
| masking on the way out | the runner's `mask()` at `run.sh:65`, exercised on a failing path only | every refusal shape above | the 5-of-5 rewrite line quoted above, and the five `raw [journey]` lines that read `http://127.0.0.1:4173/r/‹credential masked›` in the capture |

**What the re-runs surfaced, and what was checked rather than assumed.** The HTTP runner's baseline census
reads 1/1/1 (`s7-qual-http-01.log:13-15`) where Stage 6's runs read 0/0/0, which looks like residue from the
suite that just ran and is not: `q7-logs/s7-qual-http-baseline-identity-02.log` selects the three rows and they
carry `created_at` 2026-10-08 14:49–14:50 UTC and an auth email holding the run tag `s7ui-muznkpmg-ybk7g`, an
earlier browser-driver run of this stage that the engine's death interrupted mid-teardown. Today's tier tore
down to `0/0/0/0/0` in its own capture, and the runner compares before against after, so both sides of that
census read 1/1/1 and the leak check still had teeth. Those three fixture rows were deliberately left in the
local database: removing them is DML on a shared stack this directive forbade resetting, and the census is
built to tolerate a stable baseline.

Two defects found in this segment were in my own instruments, not the product, and both are recorded in the
captures that show them. `q7-logs/s7-qual-cleanup-01.log` labels one count `absent_probe_1461_before` while its
expression counts `s7hist-844`, and its `docker_rm_exit=0` line measures a repeat invocation rather than the
removal, because the removal had already happened in the command before it.
`q7-logs/s7-qual-http-baseline-identity-01.log` queried `public.access_tokens`, which does not exist — the table
is `private.access_tokens`, named correctly at `supabase/tests/api/run.sh:103` — and took its `code=` values
from the masking `sed` instead of the engine. The `-02` capture for each fixes the form and keeps the inadequate
file. The
measured reason the first defect matters: on this engine (29.8.1) `docker rm -f` against an absent container
name prints nothing and exits 0, so an exit code is not proof that a container was removed; the proof is the
name the real invocation echoes and the presence count taken after it.

**§19's cleanup is now executed, and its one open item is closed.** `vivaahvarnam-s7probe-1461` — measured
before removal as `Exited (255)`, image `postgres:16-alpine`, created 2026-10-08 07:57:39 UTC, one anonymous
volume mounted at its data directory — was removed by name and is absent from `docker ps -a` afterwards.
`vivaahvarnam-s7hist-844` was absent at every measurement taken this session, so §19's "if it survives"
conditional resolves to *it did not*, and this section does not claim a removal for it. No
`vivaahvarnam-stage7-*` container survived either, which is what the runner's `EXIT` trap at `run.sh:74-75` is
for. The six `supabase_*_localvivaahvarnam` containers are `Up` and healthy and were not stopped, restarted or
reset; the twelve `_dueweave` containers and `p3c-rest-v16` were not touched. The probe's anonymous volume is
**kept**, because the instruction preserves volumes and `docker rm` was run without `-v`; it is now unlabelled
orphan storage (`com.docker.volume.anonymous`, created at the container's own instant, digest `523c8f75…`) and
removing it is a human decision, not a step this stage takes. The preview server this segment started was
identified by reading pid 20016's command line before stopping it, and `4173` now has no listener while `54400`
still does. `q7-logs/s7-qual-cleanup-02.log` carries all of that as measured lines.

**What this still does not establish.** §18's list of non-claims is unchanged by a re-run at the same head: this
is a local stack, no hosted project was linked or pushed to, no CI backed any of it because the Actions quota is
exhausted, the scripted reviewer is not a relative, the review link is shown once and delivered nowhere,
possession of a link is not verified human identity, and expiry is crossed by setting a window rather than by
waiting. The re-runs move three tiers from *bounded* to *measured at the published tree*; they do not add a
tier, a platform, or a production claim.
