# Stage 8 — Guest households, personalised links and event-scoped RSVP: the design pass, and what it rested on

Branch `stage8/guest-rsvp`. The stage opened with local head `333803f85293050d7282a55af5ceda67caed11c0` and
`git ls-remote origin refs/heads/stage8/guest-rsvp` answering the same SHA (`q8-logs/s8-substrate-01.log`, lines 8-12,
`code=0`, `local_head_equals_remote_head=yes`). Working clone `Documents/Qoder/2026-09-24/37be0a2a/s5qual`. Stage 7
was reviewed, approved and fast-forward merged into `main` by the independent reviewer before this branch opened, so
this file records work sitting on top of a merged head rather than on a branch awaiting its own merge.

The evidence directory is `q8-logs/`, which lives **outside** the repository, in the working clone's parent
(`Documents/Qoder/2026-09-24/37be0a2a/q8-logs/`). It is never committed and never staged. Earlier audits write the
shorthand `../qN-logs/`; here the path is spelled once so a reader can actually open it.

Append-only. A section is never edited after it is committed; a wrong statement is corrected by a later section that
names it. This holds for the `q8-logs` captures too — a superseded capture stands unmodified and a later one names
its defect, which is what `-02` through `-05` do to each other.

## 1. Scope, taken from the repository rather than from this stage's ambition

The repository hands Stage 8 its scope in four places, and all four were read before anything was designed.

`docs/architecture/domain-model.md:371` closes the *guest links* row with the exact thing this stage opens: "what is
still deferred is a guest *doing* anything — RSVP, approvals, a reply of any kind." `:372` closes Stage 7's row with
the same deferral pointed the other way: "A guest replying is Stage 8." `:396` classifies `public.rsvp_responses`
under **high** sensitivity — "attendance and party size reveal who will be somewhere, and free-form answers may
contain dietary, mobility or health information the product never asked for and must not treat as structured data" —
and names its owner as "the owning user (manual entry today); the guest submission path is Stage 8". `:395` does the
same for `public.guest_households`: "**high — third-party personal data the host enters about people who are not
users of this product.** `host_notes` in particular can hold anything; it is free text with no server-side meaning",
with "no guest-facing read path exists yet". And `:407` states the obligation this stage is the first to meet
head-on: the product has "people who never signed up, and Stage 8/Stage 7 must design that person's view and
objection path".

Three rows say where Stage 8 stops, and the boundary is not this stage's choice. `:368` records that per-recipient
identity has "no table, no JSON column" and names its own promotion criterion, which Stage 2 wrote into the schema
(`20260925120300_stage2_guests_approvals_rsvp.sql:8-12`): a *per-recipient credential, or an RSVP that records one
named person*. Stage 8 keeps the household as the unit, so it does not cross that line. `domain-model.md:374` (the
Stage 6 uploads row) defers "a guest seeing an uploaded file" and requires that deferral to be reopened only with
"its own threat model, a minting path for guest-delivered media and a stated retention rule rather than a policy
tweak" — so this stage ships no guest-facing media, which is also the directive's own instruction. `:372`'s deferral
of a reviewer *account* is Stage 7's decision and stands.

So Stage 8's scope is: host management of households, salutations and expected party sizes; per-household event
assignment; one personalised link per household that needs no account and no installation; a guest answering only for
the events that household was invited to; the host recording a phone answer; the host reading what came back; and
correct behaviour when a credential is revoked, expired, replaced, forged, replayed or aimed at another household.
Out of scope, and stated as out: per-recipient credentials, guest-visible uploaded media, retention and erasure
(Stage 13), the paid/entitlement gate (Stage 10), any hosted environment, and any reviewer or guest *account*.

## 2. Environment reconciled, before any design claim was allowed to rest on it

**Git.** Read back rather than inherited: branch `stage8/guest-rsvp`, local head and `ls-remote` head identical at
`333803f…`, and `git status --porcelain` at that moment showing three untracked entries —
`docs/architecture/guest-rsvp-security.md` (this stage's design artefact), plus `pnpm-lock.yaml` and
`pnpm-workspace.yaml`. The two pnpm files are pre-existing in this worktree, are never staged by this stage, and are
**not deleted** because this task did not create them (`s8-substrate-01.log:13-19`). No commit has been made on this
branch yet at the time of writing.

**The live stack, read-only.** `supabase_db_localvivaahvarnam` was queried with `SELECT` counts only, never reset
(`s8-substrate-01.log:21-32`): `guest_households=0`, `household_event_scopes=0`, `rsvp_responses=0`,
`access_tokens=0`, `tokens_guest_invitation_live=0`, `code=0`. That query exists because Ruling 2.1 tightens a CHECK
with `VALIDATE` semantics, which is only safe if no existing row violates it. A second instrument asks a different
question — whether the legacy migration chain ever writes those tables at all — by grepping the two files that move
old data (`s8-substrate-01.log:34-44`): every count is 0, `code=0`, and the capture states the instrument's own limit
in the next line: "it proves no INSERT/UPDATE mentions the table in those files. It does not prove a row count on a
built chain", which is what `stage8/run.sh` will measure on both chains. Two instruments, two questions, neither
presented as the other.

Containers, from `-02`: six `*_localvivaahvarnam` containers Up (db, storage, rest, inbucket, auth, kong — five
healthy, `supabase_rest` has no healthcheck), twelve `_dueweave` containers and `p3c-rest-v16` Exited. None of them
was started, stopped, restarted, pruned or removed by this session. **Starting or restarting the shared Docker engine
is a human action** and this stage has not asked for one, because the stack it needs is already running.

**Disk and commit headroom — the part that produced four corrections before it produced a number.**
`-01` measured the residents and the free space; `-02` corrected `-01`'s neighbour counts, because `docker ps -q`
**ignores `--format` and prints container IDs**, so every name-based grep over it scored 0; `-03` corrected `-02`'s
`grep -c` value that had been labelled an exit code, and its `(TotalVirtualMemorySize − FreeVirtualMemory)` figure
labelled `freeCommit_GB`, which is the commit charge *in use*; `-04` settled the label by switching to
`Win32_PerfFormattedData_PerfOS_Memory` and reconciling two independent instruments
(`CommitLimit − CommittedBytes = 32.49 − 28.16 = 4.33`, and `FreeVirtualMemory = 4.33`); `-05` then corrected `-04` on
two counts — a "second sample" that had not actually been re-run, and a claim that no earlier stage measured disk,
which a broken case-insensitive grep had produced (the pattern `Avail` matches the product's own `{"available":
false}` refusal body, so its 31 hits were test output, not measurements). Every one of those files stands unmodified,
and `-05` names the defects rather than repeating them.

The corrected facts Stage 8 will run under, all from `-05`: C: is at 100% with **~2.70 GiB available**
(`avail_kb=2831896`) and commit headroom is **~4.4 GB**, stable to ~0.1 GB across 45 s, with an auto-managed pagefile
that grew the commit limit from 31.49 to 32.49 GB during the diagnosis. Stage 6's own capture gives the measured cost
of the gate tier rather than a guess: `dist` rebuild plus all five node gates moved free space 8,236,440 →
8,184,860 KiB (~50 MiB total), the largest single gate being `npm run test` at 21,872 KiB — small because
`node_modules` already exists; a from-clean install would be ~544 MiB (measured: `s5qual/node_modules = 556,692 KiB`).
`postgres:16-alpine` is already pulled (420 MB, `docker_images_exit=0`), so the SQL tier needs no download. Stage 6's
per-gate floors (60,000/90,000 KiB) are recorded as a do-not-fill-the-disk tripwire, **not** as a working-set
requirement, and are not copied forward as if they encoded one. The guard for this stage is therefore: each tier
capture opens and closes with `df -k /c` available KiB and `CommitHeadroom_GB`, each with its own adjacent exit code;
a tier is refused rather than attempted below 1 GiB free or 2.0 GB commit headroom; and a refused tier is reported as
the blocker with its two figures and the list of what did not run.

One thing this stage declines to explain: between `-03` (21:22) and `-04` (22:03) the commit charge appears to have
grown by roughly 22 GB on a machine shared with other projects and Docker, and the process responsible was not
identified. Nothing in this design or in any later section treats a remembered headroom figure as usable, which is
the only consequence available.

**The directive's own disk question, answered in `-06`.** Free space fell about 2.2 GB in the five minutes between
`-05` and the pre-commit checker run, then partly recovered — this stage having written only two documents and run one
`product:check` in that window (18 MiB, measured). Attributed by re-sizing the residents and naming the writers in a
3 s counter sample: `pagefile.sys` moved 17.05 → 18.13 GB (+1.05 GB in ~55 min) as the auto-managed commit limit grew
from 31.49 to 32.49 GB; the named sustained writers were `svchost` (3.9 MB/s) and `chrome` (2.5 MB/s); and
`docker_data.vhdx` is the largest resident at 30.7 GB but not a current writer — its six `*_localvivaahvarnam`
containers read `cpu=0.00-0.36%` in `docker stats --no-stream`, and its fresh mtime is a touch, not a write, which
matters because treating it as evidence of consumption would have mis-attributed the whole thing to this project.
`docker system df` reports 27.6 GB of images-plus-volumes inside it with ~16 GB nominally reclaimable, most of that
belonging to other projects, so it was read and not pruned. The load-bearing negative is that Stage 8's own stack is
not the consumer. The consequence the stage accepts: free space is currently below this stage's own 1 GiB tier floor,
so authoring continues (MiB-scale) and no heavy tier starts until its own capture records both figures above the
floor at the moment of the attempt.

Before committing, `npm run product:check` was run once as a pre-commit sanity check on the two new documents, with
headroom recorded on both sides of it: `product_check_exit=0`, "Product contract OK — 198 active file(s) scanned, 0
violation(s)", `avail_kb=617976 → 599972`. That is a check that the docs do not violate the contract rules; it is not
the Stage 8 gate run, and §4 says what still has not been run.

## 3. The design pass, and the standard its citations were held to

The design artefact is `docs/architecture/guest-rsvp-security.md` — 601 lines, fifteen sections, nine numbered
rulings (2.1, 2.2, 3.1, 3.2, 4.1, 5.1, 5.2, 8.1, 8.2), written **before** any Stage 8 code exists, as the directive
requires ("Design the necessary database policies, immutable/history boundaries, abuse resistance, data
minimisation, privacy controls and teardown strategy before coding"). Nine migration files, `config.toml`, the
product-contract checker, four client files, two test runners, `domain-model.md` and ADR 0006 were read at
`333803f` and their relevant lines inventoried in `s8-substrate-01.log:46-133`.

Its central finding is that Stage 8 is a **door and credential** stage, not a table stage: every table it needs was
written by Stage 2 as a reserved shape and no later stage used it — `guest_households`, `household_event_scopes`,
`rsvp_responses` with its FK onto the scope's full PK (which is what makes an out-of-scope answer *unrepresentable*
rather than merely disallowed), and the `guest_invitation`/`rsvp` members of the `token_kind` vocabulary with
`household_id` and its composite FK already on `private.access_tokens`. Consequently Stage 8 adds **no new table, no
new table privilege, and no new grant to any browser role** (Ruling 8.2); what it adds is six functions behind the
existing `api`/`internal_api` split, one partial unique live-credential index, one CHECK tightening (Ruling 2.1), one
length-bound CHECK in Stage 3's established idiom, and two re-declared publication verbs (Ruling 8.1).

The verification standard for this section is the one the stage set for itself: *a wrong file:line in a security doc
is a defect*, because a reviewer either cannot check the claim or checks the wrong code. Every range was re-taken
from the files at this head rather than recalled from an earlier session or taken from an agent's report, and the
pass found the following — each of these was a live defect in the doc at the moment it was found, not a
hypothetical:

| found | actual | why it mattered |
| --- | --- | --- |
| `…:1172-1240` for `private.public_invitation_dto` | `20260927120000…:1172-1391` | truncated the function mid-body; the whitelist the whole privacy argument rests on was partly outside the cited range. Measured by `awk 'NR>=1172 && NR<=1400 && /^(RETURN\|END;\|\$\$;)/'`, which returned only `1390: END;` and `1391: $$;` — one function, not two. |
| `20260926150000…:129-130` cited for "No historical migration was edited" | `docs/architecture/decisions/0006-…md:130` | the cited lines are `v_try integer := 0; BEGIN`. Found by `grep -rn` over the repository rather than by argument. |
| a bare `:1386-1388` inside a paragraph anchored to a 1059-line file | `20260927120000_stage4_tradition_pack_releases.sql:1387-1389` | unresolvable in context; the fix also names that it is a *different file* from the one above it. |
| `:181-213`, `:174-179`, `:186-212` on the credential-kind block | `:180-214`, `:175-179`, `:186-214` | three near-misses on the same constraint, each one excluding a line a reviewer would need. |
| `:58`, `:42-44`, `:64-68` in §6 | `:57`, `:43-45`, `:67-69` | off-by-one/two ranges pointing at blank or adjacent lines; the quoted text was measured, not assumed. |
| bare cross-file cites in §§3, 7, 8, 9 | each given its migration filename | a bare `:NNN` is only resolvable inside one file; four paragraphs cited a file other than the one they were anchored to. |
| `domain-model.md:264` cited for the enumerable minting surface | `:402` | `:402` is the Credentials row that enumerates the three exposed verbs and the two writers of `private.access_tokens`; `:264` is a paragraph about which `private` functions are `SECURITY INVOKER`. Related subject, wrong claim, and a reviewer following it lands on definer/invoker counts instead of the minting surface §8 needs. |
| §7's first bullet, after a batched `perl` edit | rewritten by hand | the batch had stripped the sentence's subject, leaving "the whole model and it was chosen by Stage 2 with this stage in the comment". Restored with Stage 2's full quoted comment (`20260925120300…:90-92`) and its correct anchor. |

The last row is a method finding, not a typo. A batched regex edit over prose can leave valid markdown while breaking
a sentence's subject, so nothing passes: the file still parses, the still-wrong sentence still reads as a claim about
Stage 2, and only a reader who already knows the source notices. Several of that batch's pairs did not match at all —
the count was not recorded at the time, which is itself the lesson — because of line wraps and em-dash bytes.
Batched regex over prose is not a proofreading instrument. From that point on, doc edits were per-hunk with the target
text read first.

Two design gaps the pass closed rather than inherited. **`last_used_at`**: Stage 7 was the first writer to a column
Stage 2 declared (`20261008120000…:340-343`, stamped at `:427`), and the guest door inherits that field. It stamps on
a **successful read only**, so a forged, revoked or expired token cannot move it and a probe cannot make a dead link
look touched; §14 carries that as a named battery obligation (L-series) instead of an assertion. **Ruling 2.1's
`VALIDATE` safety** was originally a single inference; it now rests on the two independent instruments described in
§2, with the second one's limit stated in the same capture.

The verification standard applied to the design doc was also applied to this file, one pass over its own text before
it was committed, and it found four defects here: `s8-substrate-01.log` cited as ending at line 117 when the capture is
137 lines and its inventory runs to 133; `domain-model.md:402` described as the no-inference row when `:402` is the
Credentials row and the no-inference vocabulary sits at `:348`/`:351`; a "`stage7/run.sh` `API_NAMES=13` count" that
does not exist in that form (the probe at `:198-199` reports a count and asserts nothing); and an unrecorded batch-edit
count written as though it had been measured. All four are corrected above rather than left to a later section,
because none of them had been committed yet — the append-only rule binds a section once it is in history, and this
file has no history. What is *not* corrected is `q8-logs` itself: those captures are evidence of the process, so
`-04`'s two defects are named by `-05` and both files stand.

Three things the design names as unresolved rather than settled, and §15 of the doc is the authority for them: the
exact wording of the one-sentence guest refusal is product copy that must pass the same truth rules and is settled in
the implementation pass with its own assertions; whether a household link's default lifetime should be finite at all
is a host-workflow question this stage answers only by making it settable; and `weddings.estimated_guest_count` is
reconciled with nothing, so a later screen that shows both will have to decide which one is authoritative rather than
letting the two disagree on a customer's page. The design also records its own cost (§13): the shared frozen-document
projection becomes a **three-consumer** function — wedding link, review door, household door — so the coupling
Stage 7 named keeps growing.

## 4. What has not been run, stated plainly

Nothing in this file is a PASS claim, and the list of what has not happened is at least as long as the list above.

Not written: the Stage 8 forward migration, the `stage8` SQL battery and its `run.sh`, the catalogue tripwire
widening (`stage2/40_catalog.sql`, the Stage 4/5 suites it names, and the `API_NAMES`/`INTERNAL_NAMES` census probe at
`supabase/tests/stage7/run.sh:198-199`, whose printed counts rise when this stage's wrappers appear — note that this
probe *reports* rather than asserts, so Stage 8's own tripwire has to be the thing that pins the surface, and S8-3
must locate where that pinning actually lives before widening it rather than assuming a line number), the HTTP
battery and the leak-census extension in `api/run.sh`, the client adapter and guest route, the host
household/link/RSVP screens, the three new product-contract rules, the unit tests,
the browser tier, the accessibility and mobile sweep, the network and privacy observation, the 43-octet scan, and the
truth-sync of `docs/product/feature-readiness.md` and the README counts.

Not run: **every** gate. No `npm run typecheck`, `product:check`, `dbtypes:check`, `lint`, `test`, no `npm run build`,
no production-dependency audit, no historical Stage 2-7 suite, no HTTP tier against the local stack, no browser tier
on `dist/`. Each will be run, and its exit code and counts copied from a line adjacent to the command that produced
it, before any section of this file calls it green. The counts still published in `domain-model.md` and the readiness
matrix are Stage 7's, and remain accurate only for Stage 7; this stage has moved none of them.

Also not done, on purpose: no merge, no `main` commit, no hosted Supabase change, no deployment, no payment or paid
external API, no Actions run (the quota is exhausted, so qualification is local by instruction), no force-push or
history rewrite, no prune, no container outside `*_localvivaahvarnam` touched, and no shared database reset.

The first commit on this branch will be this design artefact and this section, taken together, so that a reviewer can
check that the design preceded the code by its own timestamps rather than by this file's assertion.

## 5. The migration pass: written, read back against the substrate, and still unapplied

Commit order on this branch is the evidence that the design preceded the code: `ae33a1c` carried the design doc and this
file's first four sections, `edc15f3` carries the doc's deletion-freeze ruling and count repairs, `be5200d` carries the
migration, and the section you are reading is the third commit after them. Each was pushed at the moment it was made and
read back with `git ls-remote`, so the ordering is checkable from `git log` rather than from this paragraph's assertion.

`supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql` now exists — 1219 lines then, 1253 lines as §10 re-measures it, both with `wc -l`
and recorded in `q8-logs/s8-selfreview-01.log` §2 (cited by section, not by line number, because that file grew by two
edits after the citation was first taken and a line cite into a scratch capture is the kind of cite that goes stale
silently). **It has been applied to nothing.** No throwaway database, no local
stack, no chain. §4's first "not written" item is therefore closed and its "not run" list is not, and because §4 is in
git history the correction lives here rather than as an edit to §4.

What the file is, counted from the file itself rather than from the design doc's intention:
**14 function definitions** — 6 new `internal_api` bodies (`:153`, `:315`, `:373`, `:483`, `:562`, `:722`), 6 new
`api` wrappers for the same six names (`:1120`-`:1164`), and 2 re-declared `internal_api` publication verbs
(`:957`, `:1060`). That is 12 new function names and 2 replaced bodies, which is the surface S8-3 has to pin.
Plus 1 partial unique index, 2 `DROP CONSTRAINT` and 3 `ADD CONSTRAINT`.

### Why the review was done by reading the substrate

An unapplied migration cannot answer a question back. There is no engine to ask, so the only instrument available is
the committed files it cites — and the design doc had already established the standard that a wrong `file:line` in
this repository is a defect, not a typo, because a reviewer either cannot check the claim or checks the wrong code. The
pass re-took every name, line range, column nullability, FK action, trigger and format string from those files. It
found six live defects, all in the new file, and fixed all six before this section was written
(`q8-logs/s8-selfreview-01.log` §3 has each with the command that proved it):

| defect | what it would have done | proof |
| --- | --- | --- |
| `ORDER BY v_name_nullsafe(h.display_name)` | failed at `CREATE FUNCTION` — the helper does not exist anywhere | `grep -rn "v_name_nullsafe" supabase src docs` → `grep_rc=1`. Then `20260925120300…:21` shows `display_name text NOT NULL CHECK (length(btrim(display_name)) > 0)` and `:32` shows the wedding-leading name index, so a NULL-safe wrapper was never needed. |
| duplicate household ids refused | contradicted the verb's own `already_live` tolerance, and the message named the wrong cause | the membership test is `h.id = ANY (p_household_ids)`, which a duplicate cannot break; predicate now refuses only NULL elements and a set that doesn't match this wedding |
| undeclared `v_i`, unused `v_items` | `column "v_i" does not exist` on the first guest answer ever submitted | re-read of the DECLARE block against every `v_` reference |
| unguarded `(v_item ->> 'party_size')::int` | `22P02`, whose message **echoes the offending client text** — the leak the adjacent uuid regex guard exists to close | read of the guard block; a `^-?[0-9]+$` gate now precedes the cast, raising in the body-shape family so the access-refusal bytes are untouched |
| `api.get_guest_invitation_state` missing `STABLE` | a read door that diverges from the one precedent that exists for it | `20261008120000_stage7_family_approval_review.sql` has **one** STABLE wrapper — `api.get_approval_requests` at `:827`, `LANGUAGE sql STABLE SECURITY INVOKER` at `:829` — and four write wrappers with no STABILITY clause at all (`:813`, `:821`, `:837`, `:850`). After the fix, `grep -n "LANGUAGE sql"` over this stage's file shows exactly one STABLE line, `:1150`, on the read wrapper, and none on the five write wrappers. |
| three false citations inside the new file | a reviewer landing on unrelated code | `q8-logs/s8-selfreview-01.log` §5 — including `invitation_drafts_section_length_bound`, which this stage's comment attributed to Stage 2 with a 2000-character ceiling and which is actually Stage 3's `:162-170` with four `<= 4000` terms on `length()`. Stage 8's bound is `octet_length(…) <= 2000`: a different unit and half the magnitude, deliberately, and the comment now says both. |

None of the six loosens a refusal. Four of them are exactly the class the S8-4 battery is scoped to catch, and the
honest statement is that **none has been caught yet** — caught means a test that fails before the fix and passes
after, and no test has been written or run.

### The re-declared verbs were diffed, not trusted

Postgres has no verb for altering a function body, so §6 re-declares
`internal_api.publish_invitation_version` and `internal_api.revoke_invitation_publication` in full, which makes any
stray edit a silent behaviour change in a function Stage 3 already qualified. Both were extracted comment-stripped and
diffed against their originals at `20260926150000…:199-300` and `:313-362`: the only deltas are the two intended ones —
a live `guest_invitation` credential is **retargeted** to the new publication rather than orphaned, and the household
index's target re-pins with it. That diff proves the copy is faithful to the *source*; it does not prove the source
still behaves the same on the live engine, which is why Stage 3's own suites are on the S8-9 list.

### One design gap the pass opened rather than inherited: deleting a household

The credential for a household link is a row in `private.access_tokens`. `tokens_no_client_delete`
(`20260925120400_stage2_assets_entitlements_secrets.sql:185-186`, cited as `:183-186` for the pair) refuses a client
DELETE of it, and the composite FK at `:169` carries no `ON DELETE` clause, so it is `NO ACTION` — which means deleting
a household that ever issued a link refuses. The alternative was worse than it looks: `household_event_scopes`
cascades from the household (`20260925120300…:55-56`) and `rsvp_responses` keys onto that scope's full PK (`:93-94`),
so a deletion that *succeeded* would destroy the event scope and the guest's own answers with it, silently.

The ruling is **no schema change and no seventh verb**, because the schema already states and qualifies this rule one
level up: `docs/architecture/stage-2-migration-plan.md:188` and Stage 2's `20_attacks.sql` group 11e establish that a
credential-bearing wedding cannot be deleted, and `docs/audits/stage-3-public-invitation.md:68-74` records the same
residue as an accepted consequence rather than a bug. A withdrawn link leaves an audit trail; a deleted household
leaves nothing, which is the privacy answer as well as the mechanical one. What the schema cannot say is the UI rule,
so `guest-rsvp-security.md` §7 now carries it: the host screen offers **withdraw link** always and **delete household**
only where `link_state` is `never_issued`, and §12 fixes the browser tier's teardown to credentials-first-by-trusted-role
because the order is not optional. That is the same reasoning Stage 7 used when it refused to add a verb that would
have made a dead end look like a feature.

### Corrections to the design doc taken in the same pass

`guest-rsvp-security.md` is now 706 lines (`wc -l`, was 601 at `ae33a1c`), still 15 sections, and the edits are the
deletion-freeze ruling and UI rule above, §12's ordered teardown, and four stale-count or citation repairs found by
re-counting rather than remembering: §6's heading and §14's item 5 both said *four* places where event scope is
enforced while the section's own table has five rows; §8 said "three tables under the four owner policies" when the
measured count is twelve policies across those files (`20260925120500…:222-244`, `:246-268`, `:270-299`); §14's item 6
referenced a non-existent item 11; and a reference to `:185-186` for the refusal trigger pair was widened to the pair's
actual `:183-186`. The four-count was the instructive one — it is the same three→four drift the stage has been warned
about by its own memory, produced here by editing a table and not re-reading the sentence that counts its rows.

Nested `+` sub-bullets were also flattened to `*`, because no architecture doc in this repository uses a nested marker
and the two new §7 bullets were the only places that did.

### Two scans run against these files, and one pattern warning for the tier that has not run them

`npm run product:check` was run once against the doc and migration edits as a pre-commit sanity check, bracketed by
headroom: `699332 → 698868` KB, output "Product contract OK — 198 active file(s) scanned, 0 violation(s)", exit code
taken from the adjacent line (`pc_pipe_exit=0`). Like the earlier run recorded in §2, this confirms only that the new
files do not violate the contract rules; it is not a Stage 8 gate and does not qualify the migration.

The token-shaped scan found nothing to redact — but it produced five **false positives** worth naming now, because the
S8-9 scan will otherwise be read as a leak report. `grep -nE "[A-Za-z0-9_-]{43}"` over the migration matched lines 11,
55, 62, 122 and 599, and re-running it as `grep -oE "[A-Za-z0-9_-]{43,}" | sort -u` lists what actually matched: five
*cited migration basenames* — `20260925120300_stage2_guests_approvals_rsvp` (exactly 43 characters), and three 45- and
one 53-character ones. A real guest credential is 43 characters of base64url from `base64url(random 32 bytes)`; a
migration filename is the same shape to a bracket expression, and one of them is the same *length*. The scan S8-9 runs
therefore has to be bounded and the matches classified and listed rather than counted — the same lesson Stage 7 recorded
about a checker that only covers its own wording, arriving again from the opposite direction: here the pattern is too
wide, not too narrow. `grep -nEi "service_role_key|anon_key|eyJ|password|secret[[:space:]]*="` over the new file
returned `secret_rc=1` — no match.

### What is still true

Headroom at the moment of this writing: `df -k /c` → **avail_kb=740184** (~723 MiB), against this stage's own 1 GiB
(1048576 KB) per-tier floor. Three readings taken across this one session — 642740, then 624952, then 740184 — so the
figure moves by ~100 MiB within minutes and is not a stable quantity to plan against; the last of the three is the one
that matters, and it is still below the floor. The six `supabase_*_localvivaahvarnam` containers are up (`docker ps`
count 6, `docker_exit=0`); the engine was not started, restarted, pruned or reset by this stage, and `_dueweave` and
`p3c-*` were not touched.
Per the directive's own instruction — "If safe headroom is insufficient, stop before running heavy gates and report the
exact blocker" — the blocker is reported and no tier was started. Writing a 1219-line migration and reading nine files
cost single-digit MiB; applying chains to throwaway `postgres:16-alpine` instances, building `dist/`, and running the
HTTP and browser tiers do not, and starting them without the headroom to finish would produce exactly the interrupted
runs whose residue this repository has already had to write two sections about. Each tier that does run will be
bracketed by its own capture recording the headroom figure at the moment of the attempt, not by this paragraph.

So the state of Stage 8, stated without inflation: **design committed, migration authored and self-reviewed, nothing
applied, nothing run.** §4's list of unrun gates is unchanged and every one of them is still unrun.

## 6. The tripwire sweep finished: the gap the sweep's own vocabulary caused, a constraint that must not be renamed, and one Stage 2 fixture that the new rule legitimately made illegal

Same block as §5: the migration is authored and the historical suites are being widened for the guest head. Nothing
here was executed against a cluster — see the closing subsection, which states the headroom readings rather than
resting on §5's. Every claim below is either a text measurement, with the command that took it, or an argument that is
labelled as an argument and handed to §S8-4 as a case to measure.

### The missed tripwire was a defect in the sweep, not in the suite: stage3 `G4`

The §5 widening list was assembled by grepping for the quantities Stage 8 moves — the api/internal wrapper counts, the
name arrays, the pair tables. That scan reached stage2 `C26f`/`C28a`/`C29b`, stage3 `G1`/`G1f`/`G1h`, stage4 `I1`-`I10`,
stage5 `M5b`, stage6 and stage7 `G3d`/`G4`/`G5`, and it **missed `supabase/tests/stage3/30_publication.sql:1732`**,
which is a tripwire of the same family wearing different clothes:

```
$ grep -n "pronargs = 0" supabase/tests/stage3/30_publication.sql
→ 1736:  … WHERE n.nspname = 'api' AND p.pronargs = 0),
```

`G4` does not count the customer surface. It asserts that *the functions taking no arguments at all* are exactly the
doors that read a credential out of the request rather than out of a signature, and it names them. Stage 8's
`api.resolve_guest_invitation()` (migration `:1156`) is argument-free for precisely that reason, so at the guest head
this line prints three names against an expectation of two and fails the **Stage 3** battery — a suite that is right
about a rule Stage 8 keeps — while every count-based tripwire in the file stayed green. The sixth guest verb,
`api.submit_guest_rsvp(p_answers jsonb)` (`:1164`), deliberately does not join it: a door that accepts a body must not
also accept a token by signature, and the comment added with the arm says so.

Fixed by prepending a `stage8` arm and leaving the `stage7` and base arms byte-identical, in the idiom §5 describes.
Instrument over the edited file (`q8-logs/s8-shape-30_publication.G4.txt`): `RESULT=OK`, every region at depth 0,
`delta CASE=0 END=0 perform=0`, `stage8_arms=4`.

The lesson is recorded as a rule for the next stage's sweep, because it generalises badly if it is not written down: a
search for *numbers a DDL change moves* cannot find an assertion that pins a *set*, and these batteries prefer sets.
The scan to run is "every catalog query whose result is compared to a literal", which includes `string_agg`,
`array_agg`, `= ANY`, `pronargs`, `relkind`, `contype` and `attnum`, not only `count(*)`.

### A constraint rename that would have looked like a retargeted historical test

The migration as authored in §5 renamed Stage 2's answers CHECK to `rsvp_responses_answers_bound` when it widened it.
That rename is reverted, and the reason is worth the paragraph.

Measured with `grep -rn "rsvp_responses_answers" --include=*.sql --include=*.mjs --include=*.md --include=*.ts .` over
the tracked tree: the old name occurs in exactly two places — the migration's own `DROP CONSTRAINT`, and
`supabase/tests/stage2/20_attacks.sql:1495`, which pins the refusal sentence
`violates check constraint "rsvp_responses_answers_check"` for the probe at `:1189-1193` (that probe writes
`'[]'::jsonb` into `answers`). The name is not a declaration anyone wrote: Stage 2 declares the CHECK inline and
unnamed on the column (`20260925120300_stage2_rsvp_and_approval.sql:87`), and Postgres generates
`<table>_<column>_check`.

So renaming it would have made a Stage 2 probe report a *different* constraint, and the only way to tell "the rule
moved" from "the rule vanished" would have been to edit that probe — under a directive that says in terms "do not
weaken historical tests to obtain a pass". Even a change made for the right reason reads, in the diff, exactly like the
wrong thing. The widened bound is therefore re-added under the unchanged name at `:135-141`, the
`COMMENT ON CONSTRAINT` at `:1220` follows it, and `grep -rn answers_bound` over the tree now returns nothing. The
rule itself is unchanged in kind and strictly tighter in degree: the probe still refuses, and refuses for the
object-typing half of the CHECK, which is what it was written to test.

### The new household rule made one Stage 2 fixture illegal, and that fixture is the only one

`one_live_guest_token_per_household` (migration `:103-107`) is the guest mirror of Stage 3's
`one_live_public_token_per_publication`. Mirroring it means mirroring what it already does to fixtures: the Stage 2
suite seeds exactly one live guest credential, for `household_a`, at `20_attacks.sql:440-443`.

Every mint of that kind anywhere in the tree, taken with
`grep -rn "'guest_invitation'" supabase/tests/ | grep -v 40_catalog`:

| site | what it does | effect of the new index |
|---|---|---|
| `stage2/20_attacks.sql:440-443` | the fixture itself | defines the one live row per household |
| `:601-606` | guest credential over a stranger's household | refused by the composite FK first — `household_b` belongs to `wedding_b` |
| `:1355-1360` | two credentials sharing one digest | refused by `access_tokens_token_hash_key`; `probe_msgs:1519` names that key and still will |
| `:2591-2594` | group 11e's pin credential | **was the collision** — it inserts successfully today and the block needs it to exist |
| `:2637-2643` | a token pinning nothing but its wedding | refused by the shape CHECK (`23514`) |
| `stage3/30_publication.sql:1146-1209` | four probes | each refused before any index is probed |
| `stage3/30_publication.sql:1263-1279` | `E6`, `E7` legal-shape mints | `DELETE` runs between them (`:1263`, `:1272`), so no household holds two live guest rows at once |
| `stage7/80_family_review.sql:1189,1210`, `stage7/90_review_boundary.sql:1007` | credential mints | `approval_review`; the index predicate names `guest_invitation` and cannot reach them |

`:2591-2594` is repaired by giving group 11e a family of its own: `pin_household` is declared at `:1576`, minted at
`:2602-2604`, carries the same credential as before — same kind, same wedding, same publication, same live state — and
is dropped at `:2636` after the credential retires, in that order, because the `NO ACTION` the group exists to
demonstrate is the reason the family cannot go first. Nothing about the claim changed: the same three assertions,
`passed := passed + 3` exactly as Stage 2 wrote it, and the same expectations. The suite no longer depends on a
double-mint that this stage decided must be impossible.

Two census forms were checked because a new index is the kind of change that moves them silently, and both are provably
unmoved: `40_catalog.sql:1273-1278` (`C45c`) aggregates only `contype IN ('p','u')`, and a `CREATE UNIQUE INDEX` adds
no `pg_constraint` row — that is why Stage 3's equivalent passes as an index and appears in no key census; and
`40_catalog.sql:1320` (`C48`) compares the accepted-twelve *unindexed foreign key* set, which a one-column index on
`household_id` does not shrink, because the key under test is the composite `(wedding_id, household_id)` and its
leading column is not indexed.

### The reported-constraint question: answered by argument, still owed the measurement

Stage 8 `DROP`s and re-`ADD`s `access_tokens_kind_shape`, which gives that constraint a new, higher OID. Eight
historical lines name it in an expectation: `stage2/20_attacks.sql:1383`, `:1408`, `:1411`, `:1505` and
`stage3/30_publication.sql:1165`, `:1171`, `:1176`, `:1184`, plus `:1290-1292`, which resolves the name from the
constraint's *definition text* through `pg_temp.st3p_check_name` — a helper that raises rather than guesses when its
pattern matches anything other than exactly one check.

The argument that none of them can move: Postgres builds a table's per-row CHECK list sorted by the column the check is
attached to, table-level checks first, and breaks ties by OID ascending; it then reports the **first** violated
constraint. On `private.access_tokens`, `grep -n "ALTER TABLE private.access_tokens" supabase/migrations/*.sql` returns
exactly six lines — Stage 2's `ENABLE ROW LEVEL SECURITY` (`20260925120400…:194`), Stage 3's two `ADD CONSTRAINT`s
(`20260926130000…:182,193`) and Stage 8's `DROP`/`ADD` pair (`:66,68`). No stage between them adds a table-level check,
so `kind_shape` already held the largest OID among the table-level checks at the Stage 7 head, and re-adding it keeps
it the largest. The direction of every tie-break it is involved in is therefore unchanged, and the competing violations
in those eight probes — the `token_hash` digest shape, the `expires_at > created_at` rule — are checks that are not
table-level on the same row, which sort after every table-level check whatever their OID.

**This is an argument about a sort order, not a measurement, and it is the kind of argument a green run exists to
check.** §S8-4 must, on a real cluster, print the check list for `private.access_tokens` from `pg_constraint` in
catalog order at both heads and print the eight refusal messages verbatim; if any name differs from the table above,
the question to answer is the one this paragraph is written to preempt — which rule stopped being evaluated, not which
test is wrong. The two claims in the fixture table above that rest on the same ordering (the `:1355` and `:2637` rows
being refused *before* the new index is consulted) are folded into the same cases.

### What this section makes Stage 8's honest state, and what was not run

Five files carry this pass: the migration (constraint name kept, comment re-pointed), `stage5/50_review_binding.sql`
(`M5b`'s nineteen-name arm), `stage3/30_publication.sql` (`G4`'s three-door arm), `stage2/20_attacks.sql` (group 11e's
own family), and `stage7/run.sh` — the last one text only. `stage7/run.sh:186` builds a chain that stops at `stage7`
and prints `API_NAMES`/`INTERNAL_NAMES` at `:196-200`, so its "thirteen wrappers, twenty-four bodies" census is a
statement about the Stage 7 head and can never print 19/30; a comment now says so at the probe, because a reader who
took those numbers as the repository's current shape would be misled by them, and the guest head's own census belongs
to `supabase/tests/stage8/run.sh`, which does not exist yet. That file passes `bash -n` (`exit=0`); the two SQL files
pass the shape instrument with `RESULT=OK` and `delta CASE=0 END=0 perform=0`
(`q8-logs/s8-shape-20_attacks.txt`, `q8-logs/s8-shape-stage8mig.txt`), and the instrument's own limits — it is a shape
check, not a parser, and cannot tell a wrong row inside a correct-looking literal — are recorded in
`q8-logs/s8-instrument-repair-02.log`.

Headroom taken in this section's own session, `df -k /c`: **932224 KiB, then 789792 KiB, then 697436 KiB available**
against the 1048576 KiB floor this stage set for itself — falling by ~230 MiB while this pass was being written, and
below the floor at all three readings. No cluster was started, no chain applied, no battery, no HTTP tier, no browser
tier, no Node gate, no build. The stage8 literals in the widened suites remain **derived expectations** — read out of
the migration text and cross-checked three ways, as §5 describes, and reconciled against a real catalog only when
§S8-4 runs. Nothing in this section should be quoted as a pass.

### What §6 then committed, and the one claim about the guest door that had to be corrected before it was published

The five files went out as five narrow commits on `stage8/guest-rsvp`, each pushed with an explicit refspec and read
back: `7e0fd8c` the migration's constraint name, `c8d6090` group 11e's own family, `d6ca99f` + `a31566c` `G4`'s arm and
its correction, `874c9a5` `M5b`'s nineteen names, `65bed4c` the `stage7/run.sh` census note, and this section as the
docs commit that follows. `git ls-remote origin refs/heads/stage8/guest-rsvp` and
`gh api repos/Pavithran-R-A/wedding-invites-pro/git/ref/heads/stage8/guest-rsvp` agreed at the first push
(`7e0fd8ca7b7a7c0bb27fe16fd32c9e76ee618029`); the `ls-remote` read-back is taken after every push and the final head is
read back by both instruments again at the end of the pass.

`a31566c` exists because the first version of `G4`'s comment was wrong about code this very pass widened. It said
`api.submit_guest_rsvp` stays out of the argument-free list because "a door that accepts a body must not be a door that
accepts a token by signature" — and that body reads `x-guest-token` at migration `:840`, exactly as
`internal_api.resolve_guest_invitation` does at `:583`. The real reason is narrower and less flattering to the prose:
`G4` aggregates names where `pronargs = 0`, and `submit_guest_rsvp` declares one argument, so the census cannot see it.
That is a fact about the query, not a ruling about the design. Whether a guest door that takes both a body and a header
refuses an answer that arrives in the wrong channel is a Stage 8 battery question, and the corrected comment says what
the line does and does not decide instead of implying the door carries no credential. The false sentence was caught
between `d6ca99f` and its push, so no published head has ever carried it; the expected name list, the head arms and every
assertion were untouched by the correction (`RESULT=OK`, `delta CASE=0 END=0 perform=0` against the committed baseline,
`q8-logs/s8-shape-30_publication.G4fix.txt`).

Two further claims were checked against the migration before committing rather than left as reasoning: that only
`api.resolve_guest_invitation()` among the six new wrappers is argument-free (`api.issue_guest_invitations` declares
three parameters, one of them defaulted, at `:1120-1124`), and that all six bodies are
`LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''` (`:159`, `:317`, `:375`, `:485`, `:564`, `:724`) — which is
what makes the comment's arithmetic (thirteen→nineteen exposed, twenty-four→thirty internal, eleven twin-less
maintenance bodies unchanged) true rather than merely plausible. The guest-mint table above was re-read row by row
before `c8d6090` went out and the readings agree with it.

Headroom when this section was committed, `df -k /c`: **606164 KiB, then 660096 KiB available** — a further fall, and
still ~390 MiB below the 1048576 KiB floor. Every tier §6 names as owed remains unrun. Nothing in this section is a
pass, and none of the commits above claims one.

## 7. The volume filled up, and Docker's own log names the cause: the blocker, stated with its evidence

This section exists because §S8-4 could not be run, and because "could not run" is only worth recording when the reader
can see which instrument refused and why. Everything below is a measurement taken before this section was written; the
captures are `q8-logs/s8-disk-diagnosis-08.log`, `-09.log`, `-10.log` and `-11.log`. No cluster, container, gate,
battery or build was started in this session, and none of these numbers is a pass.

### The readings

`df -k` at the repository path, taken twice within two minutes of each other: **0 KiB available** on the first read and
**370684 KiB available** on the second. WSL agrees on the same volume, and disagrees in the same way
(`df -h /mnt/c`: **192M**, then **361M**). The two instruments were not reconciled by picking the friendlier number: on
a volume that Windows is actively committing and reclaiming, a free-space reading of that size is a rounding error, and
both readings are reported. Against this stage's own floor of 1048576 KiB per tier, the shortfall is **677892 KiB**
(662 MiB) on the more generous reading and the **whole 1048576 KiB floor** on the other, where §6 recorded a shortfall
of 442412 KiB — the fall continued while §6 was being committed.

### What is holding the space, and what this pass is not

Read-only `du -sh` and a `find … -iname '*.vhdx' -printf '%s'`, nothing deleted and nothing moved:

| path | bytes | whose |
|---|---|---|
| `AppData/Local/Docker/wsl/disk/docker_data.vhdx` | 30,740,054,016 | Docker Desktop's shared data disk — every project's images, containers and volumes live inside this one file |
| `AppData/Local/wsl/{a6e2ceaf-…}/ext4.vhdx` | 8,586,788,864 | a *different* project's WSL distro |
| `C:/pagefile.sys` | 18,130,571,264 | Windows, host-managed |
| `C:/hiberfil.sys` | 6,702,292,992 | Windows, host-managed |
| `q8-logs/` (this stage's entire evidence trail) | ~1.9 MB total | this pass |

The last row is the finding that matters for the question §S8-9 was asked to answer. This pass produces text: its whole
evidence directory is under two megabytes, and it cannot account for a swing of several hundred megabytes, let alone
the tens of gigabytes above. The consumers are Docker's shared disk, a second project's distro, and the OS paging
files — none of which this stage may touch.

### The engine failure is a consequence, not a separate fault

`docker ps` returns `Error response from daemon: Docker Desktop is unable to start`, which reads like a broken install.
`AppData/Local/Docker/log/host/com.docker.backend.exe.log` says otherwise, in the daemon's own words, timestamped
2026-10-09T19:40:54Z to 19:43:13Z:

- `engine linux/wsl shutdown requested (cancel cause: write …\log\vm\init.log: There is not enough space on the disk.)`
- `unmounting data disk`, then `compacting data disk`, then `skipping data disk compaction`
- `reporting error to user: write …\log\vm\init.log: There is not enough space on the disk.`
- the user-facing record: `"title":"Docker Desktop - Disk full"`, `"message":"Docker Desktop cannot continue because
  the disk is full.\n\nFree up space and then start Docker Desktop again."`, `"actions":["Quit"]`

So the daemon stopped *because the volume was full*, and it could not even write its own log file. The corroboration is
a clock cross-check rather than an assumption: the two `.vhdx` files carry host-local mtimes of 2026-10-10 01:13 and
01:14, and the host runs IST (UTC+05:30) while these logs run UTC, so those stamps are 19:43Z — the unmount/compact
pair above. The writes at the end of this session were Docker's shutdown and compaction, not growth from a battery.

### What that leaves blocked, and what was deliberately not tried

The SQL tier needs a throwaway `postgres:16-alpine`; the HTTP tier needs the existing `localvivaahvarnam` stack; the
browser tier needs both plus a `dist/` build; the Node gates need headroom to install and build. All four are the same
engine or the same volume, so §S8-4's batteries, §S8-5's HTTP battery, §S8-8 and §S8-9 are all blocked on one cause.

Not attempted, each for a reason rather than by preference: `docker system prune` or any volume delete (the images and
volumes inside `docker_data.vhdx` belong to other projects as well as this one, and the directive forbids deleting
other projects' data or Docker volumes); deleting or shrinking that second project's `ext4.vhdx`; `wsl --shutdown`
(it would take that distro down too); reconfiguring `pagefile.sys` or `hiberfil.sys` (a host setting, not this
repository's to change); starting or restarting the shared engine (a human-only action in this environment, and the
daemon has already refused for a documented reason); resetting the shared database to "establish a clean baseline".
Nothing in this section deletes anything, and the inadequate `du` run against `AppData/Local/Packages` is kept in
`-09.log` with its `du-exit=124` timeout rather than retried silently.

### The one action that is a human's

Free space on `C:` — the choice of what to remove is the operator's, not mine, for the reasons in the paragraph above —
and then start Docker Desktop again. Once there is headroom, this pass resumes at §S8-4: author **and run**
`supabase/tests/stage8/80_guest_invitation_links.sql`, `90_guest_rsvp.sql` and their runner, then the historical
re-runs at this head. Until a tier has actually executed, Stage 8 stays where §6 left it: implemented on the branch,
tripwires widened, and unqualified.

## 8. Reading the rotate body against its own table found a refusal that was not a refusal

§S8-4 could not run, so it began as a reading task: the migration's six bodies re-read one at a time against the DDL
they write into, with the batteries' expected rows being collected as they went. `internal_api.rotate_guest_invitation`
failed that reading, and it failed it quietly — nothing in the file looks wrong until the successor `INSERT` is compared
with the constraint the same table already carries.

### The defect

Rotate selects the household's live credential at `:415-420` with `WHERE … revoked_at IS NULL`, which admits a row whose
deadline has passed, then carries that deadline across at `:447` (`v_expires := CASE WHEN v_old.expiry_policy = 'fixed'
THEN v_old.expires_at END`) and inserts the successor at `:453-464`. A new row's `created_at` defaults to `now()`, and
`private.access_tokens` requires `CHECK (expires_at IS NULL OR expires_at > created_at)`
(`20260925120400_stage2_assets_entitlements_secrets.sql:150`). For a link whose `expires_at` is in the past, the
successor therefore violates that CHECK, and the call aborts with `23514` naming `access_tokens_expires_at_check` —
after `FOR UPDATE` has already taken the dead row, so the whole transaction rolls back.

The reachable case is ordinary: a host sets "until 1 December" for a family, December passes, the host's screen shows
that family as `expired` (the word `get_guest_invitation_state` computes at `:512`), and the host clicks the button
labelled *new link*. What they get is a database error text about a constraint, and no new link. Nothing about the
product's own vocabulary predicts that outcome, which is what made it worth finding: §3.3 of this migration states the
carry-across rule in one sentence, and that sentence is true for every deadline **except a spent one**.

Two repairs were rejected before one was taken. Extending an expired link to `no_expiry` would fix the error by making
the host's deadline silently vanish — the same objection §3.3 already raises against extending a revoked-by-time link.
Adding an expiry parameter to rotate would widen the wrapper's signature, its grants, the `api` census and the client
adapter for a case the product already answers with two verbs that exist. The taken repair refuses, actionably, in the
register the sibling arm at `:425` already uses:

```sql
  IF v_old.expiry_policy = 'fixed' AND v_old.expires_at <= now() THEN
    RAISE EXCEPTION 'this household''s link has already expired; withdraw it and send a new one'
      USING ERRCODE = 'raise_exception';
  END IF;
```

at `:442-445`, before the `UPDATE` that would have revoked the old row. Withdraw-then-send gives the family a working
new credential and keeps the expired one as history; the host is told which two buttons to press, in a sentence that
names their own wedding's state rather than a constraint. `P0001` is the same SQLSTATE as "this household has no live
link to rotate", so the client has one branch for "nothing to rotate here" and one for "this one is spent", and both are
facts about the caller's own wedding — which is why neither is folded into the `insufficient_privilege` refusals that
must not distinguish those cases from a stranger's.

The `COMMENT` on the body at `:1222-1223` and the design paragraph in `docs/architecture/guest-rsvp-security.md` §3 were
rewritten in the same commit, because both previously stated the carry-across rule as though it were unconditional.

### What was checked about the repair, and what was not

The shape instrument ran against the pre-edit file (`q8-logs/s8-shape-stage8mig.rotatefix2.txt`, baseline
`s8-stage8mig.pre-rotatefix.bak`): `RESULT=OK`, `delta CASE=0 END=1 perform=0`, `odd tags introduced=[none]` — the one
new `IF`/`END IF` pair and nothing else, with every region still returning to depth zero. The two neighbouring
behaviours were re-read rather than assumed: `issue_guest_invitations` refuses a past `p_expires_at` at `:209` before it
mints, so it cannot produce the state this rotate arm now refuses; and the publication-retarget `UPDATE` in
`publish_invitation_version` moves only `publication_id` and leaves `expires_at` and `created_at` together, so the same
CHECK cannot fire there — the check compares an expiry with its own row's creation, not with the clock.

Not checked, because nothing can be run: that `P0001` is what the probe helper will read back, that the refused call
leaves the old row live and unrevoked, and that no earlier stage's battery counts the refused path. Those three are the
first cases the Stage 8 battery will owe this arm, and §S8-4's `R` group will name them.

### The smaller thing that nearly went out in the same commit

The new comment cited `get_guest_invitation_state`'s expired arm as "(`:497-498`)". Those were the correct line numbers
**before** this edit; the fifteen-line insertion moved that arm to `:512`, so the sentence shipped with a citation its
own change had invalidated. It was caught by grepping the file for bare `` `:NNN` `` citations after the edit — the only
self-citation among seven, the rest naming their file immediately — and replaced with a reference to §3.4, which survives
any future edit to this file. Worth recording because the failure mode is invisible to every instrument this pass has:
the shape checker, `git diff` and a careful reader all accept a wrong line number.

## 9. Four shape guards that refused nothing, found by writing the probes meant to catch them

§8's reading pass continued into `internal_api.submit_guest_rsvp`, driven by group A of the second battery: eighteen
malformed bodies were being written down as expected refusals, and the third one (`{}`) made a refusal that the code
does not contain. Re-reading the validation block line by line against three-valued logic found four.

### The defect

Each of the four guards tested a key's *type* and never its presence. The four numbers in this block are the file as
it stood before this section, which is what they are being quoted for:

```sql
IF jsonb_typeof(p_answers -> 'events') <> 'array'          -- :753 before this section
IF jsonb_typeof(v_item -> 'event_id') <> 'string'          -- :785
IF jsonb_typeof(v_item -> 'attending') <> 'string' …       -- :796
IF jsonb_typeof(v_item -> 'party_size') <> 'number'        -- :805
```

`jsonb_typeof()` answers SQL NULL for a missing key, and `NULL <> 'array'` is NULL, which `IF` does not take. So a body
whose `events` key is absent — `{}`, or `{"welcome":"x"}` — passed the block, and an event card missing `attending` or
`party_size` passed it too. The guards fired for a *wrong type* (`3`, `"x"`, `'maybe'`) and stayed silent for *no value
at all*, which is the more common malformed body by a wide margin, because it is what a client sends when a field is
left out of a payload by accident.

### What that actually did, in order of severity

* A card missing `attending` or `party_size` survived every guard, passed the cap loop (`v_attending[i] = 'attending'`
  is NULL, so the comparison is skipped), passed the scope loop (`event_id` was well-formed, so the row is found), and
  reached the `INSERT` at `:910-922` (current file) with a NULL in a `NOT NULL` column — `20260925120300...:78-79`. An anonymous
  caller writing an RSVP would have received `null value in column "attending" of relation "rsvp_responses" violates
  not-null constraint`. That is the disclosure the uuid-checked-as-text guard at `:797-802` was written to prevent,
  arriving through a different door.
* A body with no `events` was **accepted**: the loops over `array_length(NULL, 1)` run zero times, nothing is written,
  and the function returns `{"recorded": true, "household_id": …, "events_recorded": 0}`. A guest page built on that
  answer thanks the family for an answer that named no event, and the same bytes turn a junk body into a live/dead
  oracle for the credential that sent it.
* No data was ever wrong. The scope loop and Stage 2's `rsvp_responses → household_event_scopes` FK sit in front of
  every write, so the reachable outcomes were an error message and a hollow success, never an out-of-scope row. The
  defect is disclosure and honesty, not integrity, and it is recorded at that size.

### The repair, and what it deliberately did not touch

All four guards now name absence themselves (`:760`, `:793`, `:805`, `:815`), each as `x -> 'k' IS NULL OR` in front of
the type test. A key present with JSON `null` still fails the type arm (`jsonb_typeof` answers `'null'`, which genuinely
differs from the expected word), so presence and shape are both covered by the two arms together. `COMMENT ON FUNCTION
internal_api.submit_guest_rsvp` and the design note gain Ruling 4.2, which states the body-refusal family as a third
thing beside the door's two answer families rather than as one more member of `unavailable`. Nothing moved: no new
function, no new parameter, no grant, no wrapper, no exposed name, so the §8 catalogue tripwires and the 19/30/19
census are untouched by construction.

### Instruments run, and the one thing they cannot see

`node q8-logs/s8-sql-shape.cjs` against the pre-edit copy (`q8-logs/v1-migration.sql`, 1242 lines) gives
`RESULT=OK (region balance + delta verified)` with `delta CASE=0 END=0 perform=0`, `odd tags introduced=[none]` and
`IF=46 END IF=46` before and after — four conditions widened, no region added, which is exactly what this repair should
look like to that instrument. The file is 1253 lines now, so every `:NNN` citation pointing into it moved by +8, +9,
+10 or +11 depending on which side of the four insertions it sits, and §8's "smaller thing that nearly went out" is
therefore still open at a larger scale: the audit itself, `supabase/tests/stage3/30_publication.sql` and both Stage 8
batteries cite into this file, and 6f0d09a's fifteen-line insertion moved them once already. Re-deriving those
citations by content is a separate commit and is owed before any tier of this stage is claimed.

### Not checked, because nothing can be run

`df -k /c` measured alongside this section reads 311,376 KB free out of 498,133,316 (100 % used). §8's figure of 698,880 KB
had itself moved down by nearly 400 MB in the meantime, and this pass ran no gate, installed nothing, pulled no image and
wrote no file larger than these batteries, so the reduction is not attributable to it; naming its cause is outside what
this repository can see, and nothing on the shared disk was touched to obtain headroom. `docker version` still exits 1,
so both chains are still unbuilt and this section is a reading result. Specifically unverified: that the four widened
guards answer `23514` with the shape sentence, that `{}` now raises instead of returning `events_recorded: 0`, that the
`23502` path is unreachable from any body, and that the twenty-two bodies per header state in group A's `A0` still all
refuse for the body's own reason. Group A's probes 19-22 are the cases this repair is for, and they are written to
fail if it is reverted.

## 10. The citations the three line-shifts moved, re-derived by content

§9 ended owing this. It is done: twenty-four replacements, twelve in this audit and twelve in
`supabase/tests/stage8/90_guest_rsvp.sql`, each one accepted only after reading the line the new number names. The
sweep began with a shift map and abandoned the idea of trusting one, for a reason the map could not see: these files
were not all written against the same version of the migration.

### Four versions, three shift events

`git log --follow -- supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql` prints four commits, and
`git show <sha>:<path> | wc -l` on each gives the arithmetic:

| commit | lines | delta | what was inserted |
| --- | --- | --- | --- |
| `be5200d` | 1219 | — | the migration as authored |
| `7e0fd8c` | 1227 | +8 | the widened `answers` bound, re-added under Stage 2's generated constraint name |
| `6f0d09a` | 1242 | +15 | `rotate_guest_invitation`'s spent-deadline refusal and its rationale |
| `9be8d2d` | 1253 | +11 | the four shape guards, their defect comment, and the rewritten `COMMENT` |

`9be8d2d` inserts in five regions — `752..753`→`752..761` (+8), `784..785`→`792..794` (+9), `795..796`→`804..806`
(+10), `804..805`→`814..816` (+11), `1220..1221`→`1231..1232` (+11) — which is exactly what §9 meant by +8/+9/+10/+11
"depending on which side of the four insertions it sits". What §9 did not say is that the audit's numbers were struck
against three different rows of that table: §3's census against `be5200d`, §7's against `7e0fd8c`, §8's and both
Stage 8 batteries' against `6f0d09a`. So the same file carries citations whose correct home differs by which section
wrote them, and a single arithmetic key would have quietly misedited half of them.

### The twenty-four, and what each new number names

This audit:

| old | new | the line |
| --- | --- | --- |
| `:145`,`:307`,`:365`,`:460`,`:539`,`:699` | `:153`,`:315`,`:373`,`:483`,`:562`,`:722` | the six `CREATE FUNCTION internal_api.*` lines |
| `:1086`-`:1138` | `:1120`-`:1164` | the `api` wrapper block, first and last `CREATE OR REPLACE` |
| `:923`,`:1026` | `:957`,`:1060` | the two re-declared publication verbs, publish and revoke |
| `:1116` | `:1150` | the file's only `LANGUAGE sql STABLE SECURITY INVOKER` |
| `:1130` | `:1156` | `CREATE OR REPLACE FUNCTION api.resolve_guest_invitation()` |
| `:1138` | `:1164` | `CREATE OR REPLACE FUNCTION api.submit_guest_rsvp(p_answers jsonb)` |
| `:814` | `:840` | the submit body's `request.headers` read |
| `:568` | `:583` | the resolve body's `request.headers` read |
| `:1094-1098` | `:1120-1124` | `api.issue_guest_invitations`' three parameters |
| `:159`,`:317`,`:375`,`:470`,`:549`,`:709` | `:159`,`:317`,`:375`,`:485`,`:564`,`:724` | the six `LANGUAGE plpgsql … SECURITY DEFINER` lines |
| `:1211-1212` | `:1222-1223` | `COMMENT ON FUNCTION internal_api.rotate_guest_invitation` |
| "1219 lines, measured with `wc -l`" | "1219 lines then, 1253 lines as §10 re-measures it, both with `wc -l`" | §3's own size claim, kept and dated rather than overwritten |

Battery 90:

| old | new | the line |
| --- | --- | --- |
| `:878-889` | `:889-900` | the scope loop's `NOT EXISTS` test (`:662`, its `JOIN` half, was already right and did not move) |
| `:1219` | `:1226` | the `get_guest_invitation_state` `COMMENT` text the battery quotes |
| `:916-918` (twice) | `:927-929` | the "no `last_used_at` stamp on this path" comment |
| `:749-827` versus `:829` | `:749-838` versus `:840` | the guard block's `END LOOP;` and the header read after it |
| `:750-834` | `:750-838` | the shape-guard block |
| `:829-852`, `:866` | `:840-863`, `:877` | the credential-resolution block, and the cap loop's `FOR` |
| `:868` | `:879` | the cap's `AND v_expected IS NOT NULL` arm |
| `:883-886` | `:894-897` | the scope test's `OR NOT EXISTS (` through its `) THEN` |
| `:911` | `:922` | `answers = '{}'::jsonb;` |
| `:866-889`, `:892` | `:877-900`, `:910` | the two guard loops, and `INSERT INTO public.rsvp_responses (` |
| `:836-856` | `:847-867` | `SELECT t.wedding_id, t.household_id` through the household lookup |

### Checked by an instrument, then confirmed by reading

`q8-logs/s8-cite-verify.cjs` loads all four committed versions from git and asks, for every old→new pair, which
version the *old* number named correctly. It prints `still-current=1 drifted=32 never-true=2 total=35`, where the 35
rows are the distinct start-anchors behind the 24 replacements. The distribution is the drift story above, per
citation: 10 old numbers were true in `be5200d`, 9 in `7e0fd8c`, 13 in `6f0d09a`, and `:159` is still correct in the
current file — which is why it stayed `:159` in a row whose neighbours moved. Nothing in that 32 was invented after
the fact; every one of them was a true reading of a file that then grew.

Two were not true in any version, and both happen to be in battery 90. `:1219` for the published-promise `COMMENT`:
`be5200d` ends at 1219 and `7e0fd8c`/`6f0d09a` have a blank line there, so the number never named that text — the
`COMMENT` string is `:1226`. And "the first INSERT at `:892`": `:892` is the write loop's `FOR` in `6f0d09a` and
`SET attending = EXCLUDED.attending` in `7e0fd8c`, while the `INSERT` is `:910`. Those two are ordinary
mis-transcriptions caught by the same pass that was sweeping for drift, which is the useful argument for doing the
sweep by content instead of by adding eleven to everything.

The instrument got one of these wrong before I fixed it: with three baselines loaded it labelled `:1116` (the STABLE
wrapper) as never-true, because `7e0fd8c:1116` is a *different* wrapper's `LANGUAGE sql SECURITY INVOKER`. Loading
`be5200d` from git showed `:1116` is precisely the STABLE line there. A verifier is only as complete as its baseline
set, and an incomplete one will manufacture false findings — which is a claim about citations that generalises badly
in the interesting direction.

### The scanner that could not do this job, in two ways

`q8-logs/s8-citation-scan.cjs` was written to attribute each bare `:NNN` to the file its surrounding prose names,
then print the cited line so a human reads it. Two defects had to be fixed before its output meant anything: an
undeclared `byTarget` counter, which made the captured first run crash with a `ReferenceError`
(`q8-logs/s8-citation-sweep-01.txt` keeps that crash), and a group-index error that read the *range end* as the
citation start, which would have silently checked the wrong line for every `a-b` citation — worse than crashing.
After both fixes: `node ../q8-logs/s8-citation-scan.cjs <pre-sweep audit> <pre-sweep battery 90>` prints
`tokens=206 attributed=205 unattributed=1 stage8-shown=7`, over the current battery `41/40/7`, and over the current
audit `330/330/0`. Captured in `q8-logs/s8-citation-sweep-02.txt`.

So it surfaced seven citations and none of the audit's. Its heuristic is "nearest preceding explicit file name,
carried forward across blank-line-separated blocks", and this repository's citation grammar breaks exactly that: the
audit names the migration once and thereafter writes `20260925120300…:21` with a Unicode ellipsis, or a bare `:814`
whose subject the *sentence* supplies from several lines away. The seven it did surface were all correct and all in
battery 90, and the capture prints each with the current line under `NOW:` — `:583` the header read, `:650-660` the
event card, `:627-632` the greeting, `:684-697` the answer object, `:480-482` §3.4's rationale, `:1226` the host-read
`COMMENT` — so the instrument is good for confirming a citation it happens to reach, and cannot be trusted as the
scope of a sweep. The 165 audit and 44 battery `:NNN` tokens (counted with
`grep -oE ':[0-9]{2,4}(-[0-9]{2,4})?' <file> | wc -l`) were walked by hand, which is how the twelve-plus-twelve got
their list.

### Anchors checked and left alone, and one §9 claim withdrawn

Re-read in place and unchanged, because they sit below the first insertion: `:209`, `:415-420`, `:425`, `:442-445`,
`:447`, `:453-464`, `:512` (all of §8), and §9's own `:760`, `:793`, `:805`, `:815`, `:797-802`. Two more moved
numbers were already correct and are recorded above without change: `:662` and `:480-482`.

The migration needs no self-citation work. It contains 35 `:NNN` tokens, and the grep that finds bare ones on a line
naming no stamped migration (`grep -nE '[^` ]:[0-9]{2,4}' <migration> | grep -vE '2026[0-9]{8}'`) returns three
lines — `:1495`, `:188`, `:32` — every one of which names `20_attacks.sql`, `stage-2-migration-plan.md` or
`supabase/config.toml` on that same line. No citation in the migration points at the migration, so nothing in it had
to move.

The design note cites this file only inside Ruling 4.2, which `9be8d2d` wrote against the current bytes, so its five
anchors are current by construction. Its other bare numbers belong to other stages' files; the one that looked most
like a Stage 8 anchor, `:524`'s `CASE WHEN p_expires_at IS NULL THEN 'no_expiry' ELSE 'fixed' END`, is Stage 3's line
524 and reads identically there — which is the point of the citation, since Stage 8 copied it.

§9 said `supabase/tests/stage3/30_publication.sql` cites into this file and so owed re-derivation. That is wrong as
stated, and it is withdrawn: the file names this migration exactly once (`:1368`, measured after §11's repair re-flowed
that paragraph — it sat at `:1366` before) and points at §4-§6 of it — section
numbers, not line numbers — so it owed nothing to this sweep. What that line *does* contain is a false claim about
how the six Stage 8 census rows were obtained, which is a different defect, is proven, and is recorded in §11.

### What this section is not

No gate was run and no tier is claimed here; this is a reading result. `df -k /c` measured while writing it reads
195,232 KB free of 498,133,316, 100 % used — down from §9's 311,376 KB inside the same working hour, with no install,
no image pull, no build and nothing larger than these text files written by this pass, so the cause is outside what
this repository can see and nothing on the shared disk was touched to buy headroom. `docker version` still exits 1
(`docker_exit=1`, measured alongside the numbers above). Everything in §9's "Not checked" list therefore remains
unchecked, and the twenty-four edits change what the batteries *say*, not what they assert: battery 90 re-measured
with `node ../q8-logs/s8-sql-shape.cjs supabase/tests/stage8/90_guest_rsvp.sql` still reports
`RESULT=OK (region balance only)`, `dollar-tags=8 odd=none scan-odd=none`, `pg_temp_perform_calls=80`, byte-identical
to the same run over the pre-sweep copy in `q8-logs/v0-battery90-pre-citefix.sql`. The citation fixes alone were
`12 insertions(+), 12 deletions(-)` in this file with `git diff --word-diff` showing digit changes and the dated size
sentence and nothing else; that was measured before §10 and §11 were added to it, so the combined diff of this pass is
the one stated at the end of §11, and a reader who re-measures this sentence against the whole file will not get 12/12.

### The rule this leaves behind

Any future edit that changes this migration's line count owes the same sweep, in the same pass, before any tier of
the stage is named: re-measure `wc -l`, re-run `s8-cite-verify.cjs` over the pairs, and re-read each surviving
citation by content. The cheaper discipline is the one Stage 7 discovered and Stage 8 kept failing: cite a construct
name or a section reference, since `internal_api.submit_guest_rsvp` and §3.4 do not move when an insert lands above
them, and a `:NNN` does.

## 11. The Stage 8 census rows were transcribed, not parsed — a provenance claim S8-3 shipped wrong

Walking `supabase/tests/stage3/30_publication.sql` for citations into this stage's migration (§10) meant reading the
provenance paragraph at its `:1363`, and one clause in it is false. It said
"`q8-logs/s8-derive-census.cjs` parses each name's signature, `LANGUAGE` clause and `GRANT`/`REVOKE` lines out of
`20261009120000_stage8_guest_invitations_rsvp.sql` §4-§6". It does not parse them out of that file. The instrument
takes two argv paths, calls `readFileSync` exactly once — on `argv[2]`, which its own output records as
`derived_from=../s5qual/supabase/tests/stage3/30_publication.sql` — pulls `$matrix7$`, `$impl7$` and `$pairs7$` out of
that battery (13/24/13 rows, printed as `old_counts`), and appends six rows per set built from a `sig` / `anon` / `vol`
table hand-written into the script at its lines 15-41. It never opens the migration.

The tell is inside the instrument. Its own transcription comments point at `:1157`/`:1161`/`:1165`/`:1169`/`:1173`/
`:1177` for the grants and `:1092`-`:1132` for volatility — anchors into a superseded version of the file, because the
current grant lines are `:1191`-`:1211` and the wrapper block is `:1120`-`:1164`. That is what a hand-transcription
looks like after three line-shifts: the digits it cites moved, and nothing in the tool noticed, because the tool was
never reading the file those digits name.

Two consequences, one narrow and one not.

The narrow one is that `19/30/19` is a property of an assembled list, not a measurement of the schema. The script's
"refuses to print unless the three literals come out at 19/30/19 with no duplicate name" guard is real and catches a
row that goes missing or arrives twice. It cannot catch a transcription that has stopped matching what the migration
declares, because the declaration is not one of its inputs. Anyone reading the old comment would have believed the
census re-derives itself from the migration on every run, and it does not.

The wider one is that the six rows then needed a hand check against the current file, which is the check the comment
claimed had been automated. It comes out faithful, for reasons worth stating because two of them are not obvious:

* the six signatures agree, and the one that looks wrong is right. The migration writes
  `p_expires_at timestamptz DEFAULT NULL` at `:1123` while the row says `p_expires_at timestamp with time zone`,
  because these rows are compared against `pg_get_function_identity_arguments` (`:1322`, `:1468`), which omits
  defaults by design and spells the type long. A row built from `pg_get_function_arguments` would have failed the
  first time it was run against a catalog.
* the grant split is exactly as asserted: `TO authenticated` at `:1191`, `:1195`, `:1199`, `:1203` and
  `TO anon, authenticated` at `:1207`, `:1211` — four and two, with `anon=y` on `resolve_guest_invitation` and
  `submit_guest_rsvp` and on no other name.
* the volatility split is exactly as asserted: one `LANGUAGE sql STABLE SECURITY INVOKER` at `:1150`, on the
  `api.get_guest_invitation_state` wrapper, five plain at `:1126`, `:1134`, `:1142`, `:1158`, `:1166`, and the one
  STABLE internal body at `:485` — so `vol=s` on that name alone and `vol=v` on the other five holds on both sides of
  the wrapper pair.

What is still not established is the thing none of this can establish from a file: `pg_proc` itself. A transcription
that matches the declaration is still a restatement of intent, and the paragraph's last sentence survives its own
falsified neighbour — `q8-logs/s8-census-literals-01.txt` must be diffed line-for-line against a throwaway-cluster
readout of the applied chain before any head's battery is called anything. The correction therefore does not shrink
that obligation; it makes it the only remaining one, since the automated re-derivation it leaned on does not exist.

### The repair, and what it deliberately did not touch

`supabase/tests/stage3/30_publication.sql:1363-1379` is rewritten to say what is true: the script's only file input is
that battery, the Stage 8 rows are transcribed by hand from a reading of §4-§6, the size guard catches a missing or
duplicated row and not a stale transcription, and the hand re-check above is named where a future reader can find it.
No assertion in the battery moved: the `$matrix8$`, `$impl8$` and `$pairs8$` literals, the catalogue queries, the
`COLLATE "C"` ordering and the expected counts are untouched, so this is not a historical test widened to accommodate
a defect — it is the paragraph *about* the test being made honest. `q8-logs/s8-derive-census.cjs` keeps its behaviour,
including its own now-accurate header line, because its output is still how the literals were assembled; what changed
is that the record no longer claims the tool reads a file it does not open.

### Instruments run, and what is not checked

The repair itself needed two rounds, and the first round is on record. Rewriting the paragraph as it stood left it
naming the three dollar-quoted blocks with their literal tag spellings, which is a comment containing `$matrix7$`,
`$impl7$` and `$pairs7$`. Over that intermediate state `node ../q8-logs/s8-sql-shape.cjs supabase/tests/stage3/30_publication.sql`
printed `dollar-tags=27 odd=impl7:3,matrix7:3,pairs7:3 scan-odd=none` and
`RESULT=INCONCLUSIVE odd tags and no baseline to compare against`, `code=1` — the tag total is unchanged because the
instrument counts tag *names*, and three of them had gone from two occurrences to three; what it can no longer do is
say which block is which, and the run's own literal report shows it: `literal matrix7/impl7/pairs7 occurrences` vanish
from the output entirely while `matrix8/impl8/pairs8` survive. `node ../q8-logs/s8-derive-census.cjs` over the same
bytes failed outright with `derived sizes 56/170/306 != expected 19/30/19`, `code=1`, because its non-greedy
`/\$matrix7\$([\s\S]*?)\$matrix7\$/` now matched from my comment to the real block and swallowed the Stage 3 and Stage 5
rows into the "old" set. Both are captured in `q8-logs/s8-citation-sweep-04.txt`, kept rather than deleted. Postgres
ignores a tag inside a `--` comment, so this would have shipped as a broken instrument set against a correct
migration, and only re-running the instruments — not re-reading the paragraph — could catch it. The comment was then
rewritten with the tags spelled bare (matrix7, impl7, pairs7) and both instruments re-run into
`q8-logs/s8-citation-sweep-05.txt`, which is the clean record: shape over the edited battery now reads
`dollar-tags=27 odd=none scan-odd=none` with `RESULT=OK (region balance only)` and
`matrix7=[13] matrix8=[19] impl7=[24] impl8=[30] pairs7=[13] pairs8=[19]`, and the same run over the pre-edit copy in
`q8-logs/v0-30pub-pre-citefix.sql` differs only on the lines that print the file path. Census re-derivation from the
edited battery (`s8-census-literals-02.txt`) diffs against the pre-edit capture (`-01.txt`) on nothing but its own
`derived_from=` line, and derivation from the pre-edit copy (`-03.txt`) is identical to `-02.txt` once CR is stripped;
the raw diff between those two is CRLF-vs-LF, because `core.autocrlf=true` with no `.gitattributes` makes the worktree
CRLF while `git show` yields LF — pre-existing repo state, not something this pass introduced, and the reason an
instrument that splits on `\n` carries a trailing CR into each derived row.

The paragraph's span moved with its length: it was `:1363-1371` in the committed file and is `:1363-1379` now, which is
also why the migration-name line went from `:1366` to `:1368` — a second instance of the drift this whole section
exists to catch, produced by the repair rather than by the migration.

No gate ran and no tier is claimed: `docker version` still exits 1 (`docker_exit=1`, re-measured with the runs above).
`df -k /c` was at 195,232 KB free of 498,133,316 (100 % used) when §10 was measured and read 912,236 KB free at the
end of this pass — the number moved on its own again, with nothing installed, pulled or built here, which reinforces
rather than resolves §10's point that the cause is outside what this repository can see. Specifically unverified, and
unverifyable until a cluster exists: the three census literals against `pg_proc`, the twelve battery-90 citations'
claims about behaviour rather than position, and every item still on §9's "Not checked" list. What this pass changed in
the tracked files is prose and digits only. In the battery: `git diff --numstat` reports `16 insertions(+), 8
deletions(-)` for the paragraph replacement — nine old lines (`:1363-1371`) out, seventeen in (`:1363-1379`), which is
the whole of the file's growth from 2366 to 2374 lines and the whole of the `:1366`→`:1368` shift. In this file:
§10 and §11 added and the twelve citation digits changed, and because §11's own wording is part of that diff, its
combined `--numstat` figure is not written into prose here; it is recorded as measured in
`q8-logs/s8-citation-sweep-05.txt` section I, alongside the `wc -l` of both files, so a reader gets a number taken from
the bytes that were committed rather than one that goes stale as the paragraph describing it is edited.

## 12. The two Stage 8 batteries and their runner — authored, and one floor that could never have run

This section covers `supabase/tests/stage8/80_guest_invitation_links.sql` (2,027 lines, 132,876 bytes),
`supabase/tests/stage8/90_guest_rsvp.sql` (4,064 lines, 279,238 bytes) and `supabase/tests/stage8/run.sh` (317 lines,
18,189 bytes). None of the three had been in the repository before this pass; `q8-logs/s8-audit-12-measurements-01.txt`
sections B–J hold the digests and the counters, section J restating battery 80's after the wording repair described
below — section B's digest for that file is the bytes as they stood before it, kept rather than overwritten. **Nothing
in this section is a tier result.** The engine did not start for it: `docker version` exits 1, re-measured with every
command below.

### The eight re-issue exports, and the arithmetic error one of them was asserting

Battery 90's group Qb (`:3414`, `:3448`, `:3497`, `:3528`, `:3568`, `:3597`, `:3659`, `:3695`) is the half that
qualifies what happens *after* a takedown: a withdrawn wedding can still be revised and a revision is not a revival
(Qb1); republishing makes a new document and revives no old link (Qb2); after a takedown the only way to reach a
family is a new secret (Qb3); exactly two families gain a credential and no other family loses or moves (Qb4); the new
links open and the withdrawn ones do not (Qb5); a re-invited family is shown the corrected document (Qb6); the
re-issued link is a working invitation that is neither wider nor a second mouthpiece (Qb7); and the three secrets the
group minted appear in no text-shaped column of any base table in `public` or `private` (Qb8).

Qb7 shipped wrong, and the way it shipped wrong is the interesting part. One arm asserted that the Pillai household
held *no* answer before the re-issued link was used — a "provable zero" meant to show the new secret could not create a
row beside the old one. There is no such zero to prove: group A4 (`:1784`) answers a live Pillai credential against
Muurtham with `attending`, `party_size 2`, and its own last arm reads that row back, so the submission Qb7 makes is an
in-place upsert and the pre-existing count is one, not zero. The assertion was not weakened to accommodate that — it
was re-armed to say what the file actually does, and the "no second mouthpiece" claim moved onto the shape that is true
and testable: `pp_then = 1`, `pp_now = pp_then`, the value going `attending|2` → `attending|1` with
`response_source` still `guest`, one event recorded, the wedding's total answers unchanged from what group Q left
(`ans_w = s8b.ans_then`), the Nair family untouched in both count and value, and the host's panel still reporting one
reply. The repair was checked by enumerating every possible writer of a Pillai row in the file rather than by re-reading
the one group: every `INSERT INTO public.rsvp_responses` statement and every `s8b_answer` call site, which is also how
the two lookalike probe strings at `:2006-2048` and `:2079` were excluded — they are unexecuted text handed to the
refusal helper, not writes.

### The closing census, and why the probe count is read from a table

Group Z (`:3741` through `:3983`) is the battery's own accounting, and every arm is forced through an expression the
file computes rather than a literal the author believed. Z7 (`:3956`) is the load-bearing one: it reads the probe
census out of the `probes` table and pins five things at once — fifty-six rows, eight groups, fifty-six distinct
group/label pairs, the per-group distribution `MA1:22 MA2:22 MR1:2 MR2:1 MR3:1 MR4:3 QB:2 QF:3`, and zero rows missing
a statement, a label, an expected state or an expected message.

That table read is not stylistic. The counter harness has exactly three increment sites (`:85` inside `ok`, `:95`
inside `eq`, `:195` once per probe row inside `run`'s loop; `s8b_add` is called nowhere else, and never with an argument
other than 1), so a text count of *assertion calls* does equal the number the closing line will report — but the
*probe* count does not follow from a text count at all. There are seven textual `s8b_run` call sites (`:1669`,
`:2054`–`:2057`, `:3266`, `:3370`) and eight groups, because `:1669` sits inside the `FOREACH g IN ARRAY
ARRAY['MA1','MA2']` loop at `:1575`: the shape storm runs the same twenty-two bodies twice, once under a live household
header and once under no header at all, so that the ordering claim in group A cannot be satisfied by a door that
resolved the credential first. A grep over the file would have said seven. The table says fifty-six, and Z7 is the
assertion that makes the difference visible instead of silent.

Battery 80 is the contrast case, and its floor comment is allowed a sentence 90's is not. There the twenty `s8f_run`
call sites (`:831`–`:842`, `:912`, `:1074`, `:1173`, `:1301`, `:1304`, `:1683`–`:1685`) sit one per group invocation with
nothing inside a loop, so its recipe genuinely can say the text count and the run count are the same number — and its
Z7 (`:1962`) still pins the forty-three from the `probes` table anyway, with the per-group breakdown (`B1 3 … B12 2`, W
1, S 5, A 1, R 2, GA 2, GB 1, GC 1) named in the assertion's own text. A grep and a table read agreeing is worth
asserting precisely because the two files show that agreement cannot be assumed from one to the other.

Z8 (`:3983`) closes the residue the next tiers need: the three 43-octet secrets group Qb minted, each checked against
the digest row it belongs to and against the door it is supposed to open, so an HTTP or browser battery can name those
strings instead of minting a fourth. Its last arm counts the switched-off events of the *whole wedding* rather than the
three this cast names, which is the tighter claim and safe to make: battery 80's fixture is the only writer of the
`enabled` column in this stage's SQL set — its event insert at `:349`-`:370` puts exactly three events on this wedding,
two live and the farewell off, and reads them back at `:509` — and battery 90 contains no write to that column at all,
so any reading other than one means the implementation hid a card on its own. A cast-scoped count could not see that.

### The floor, re-counted, and battery 80's number that was never runnable

Both batteries end with the same shape: a floor assertion that refuses a short run, then a closing `SELECT` that
reports the harness's own counter (`90:4056`/`4064`, `80:2019`/`2027`). Both floors now read 181.

For battery 90 that number is new and derived: 121 direct equalities (the anchored grep returns 122 and one of those is
the call inside `s8b_has_keys`'s own body at `:129`, which is how a `has_keys` site earns its increment), plus 4
`has_keys` sites, plus the 56 probes Z7 pins = 181, with L1 (`:4060`) as the 182nd. For battery 80 it is a *repair*: the
file as authored floored at 183, and 183 is more than battery 80 can run. Two inherited mistakes make up the difference
— an unanchored `s8f_eq` total that counted prose quoting the call, and a tally that put L1's own `ok` on the pre-floor
side. Recounted: 120 direct (121 anchored, less the forwarding call at `:104`), 15 `ok` before L1 (16 less `:2023`), 3
`has_keys`, 43 probe rows from the refusal table's own declared shape = 181.

This is a defect class distinct from anything else in this stage, and it is worth naming as its own kind, because it is
not a product
defect and not a weakened test: it is an *instrument* that was wrong in a direction that would have made the file die
on a healthy run. No assertion was added, removed or relaxed to get from 183 to 181 — only the floor constant, the
message beside it, and the recipe comment above it. The recipe is now anchored (`^[[:space:]]*PERFORM …`) so prose
cannot move it, and the polluted numbers it mentions are labelled as what the earlier draft's *unanchored* form printed,
not as commands to re-run; in the version committed here the quoted patterns are written escaped, so the anchored and
unanchored forms agree at this head.

### Four measurement errors made while writing this section, kept in the record

All four are the same failure the section is about — a number believed rather than taken — so they belong here instead
of being quietly re-taken.

The first was mine and is described above: the rewritten comments initially said the unanchored greps "now return 123,
5 and 2", which stopped being true the moment the patterns were escaped — the sentence was false about the very bytes it
sat in. It now attributes those numbers to the earlier draft.

The second was an instrument, not a sentence. A check meant to prove "no `add()` is ever called with anything but 1" was
written as `grep -cE 's8b_add\([^1)]'` and returned 1, which reads like a fourth increment site with an argument of
`n`. It is the *definition* line — `CREATE FUNCTION pg_temp.s8b_add(n integer)` at `90:71` (and `80:61`) — matching its
own formal parameter. The honest instrument is the one above: enumerate every mention of the helper, which shows three
call sites and one definition in each file. A pattern that can match a declaration is not measuring calls.

The third was in battery 80's own floor comment, and the re-measurement caught it before the file was committed. The
paragraph introducing its recipe asserted, in the present tense, that "an unanchored substring search also matches the
three lines of this comment that quote the patterns" — while the paragraph twenty lines below it correctly said the two
forms agree at this head. The lower paragraph is the measured one: `121`, `16` and `3` for the anchored and the
unanchored forms alike (section J of the capture), because every pattern this comment quotes is escaped, and a BRE `.`
cannot match the two characters `\.`. The upper clause was therefore true of the *draft* it replaced and false of the
bytes it sat in — the same mistake as the first one, inherited rather than newly made, and repaired by rewriting those
three comment lines as three comment lines so that no citation below them moved: `:104`, `:1962`, `:2019`, `:2023` and
`:2027` read the same before and after, and only the file's byte count changed.

The fourth was arithmetic done in prose. This section first said the two batteries report "all 362 assertions"; each
closing line reports 182, because the floor's own `ok` is the 182nd, so the pair is 364. The figure was written before it
was re-derived from the two floors it summarises.

### The runner: three chain kinds, because two of the three censuses count the whole cluster

`supabase/tests/stage8/run.sh` takes `guest | family | historic | all` (`:56`), builds databases named
`st8qual_<kind>`, and travels `app.stage_head=stage8` to the head-aware assertions via `PGOPTIONS` (`:61`). It masks
43-octet runs out of every line it prints, for the Stage 7 reason: a failing comparison in this workflow routinely
compares a live review or guest credential, and §I10 forbids handing that to a terminal or a log.

Three chain kinds, not two, is a consequence of the censuses rather than a preference: battery 90's group Z counts
households, live credentials by kind, `rsvp_responses` and the unused `rsvp` kind *cluster-wide*, so it cannot share a
database with `20_attacks.sql`, which deliberately commits seed rows; 90 also reads its cast out of rows battery 80
committed, so 80 must precede 90 in the same database (hence `guest`, and hence no single-suite argument); and Stage 7's
R1–R7 census has the same whole-cluster property, so Stage 7's pair gets its own empty `family` chain at the Stage 8
head instead of being folded into `historic`, which runs the legacy suites. `historic` keeps Stage 2's outcome-before-
attacks ordering for the reason `stage2/run.sh` gives. `probe_sql` carries both the chain's database and the chain's
`PGOPTIONS` because Stage 7 measured the alternative: the same census written through `admin_sql` printed three numbers
about the maintenance database, sitting directly above suites asserting 19 and 30.

The 19 and 30 are re-derived rather than inherited. Stage 7's runner measured 13 exposed wrappers and 24 internal
bodies at its own head; the Stage 8 migration declares exactly six new names in each schema
(`get_guest_invitation_state`, `issue_guest_invitations`, `resolve_guest_invitation`, `revoke_guest_invitation`,
`rotate_guest_invitation`, `submit_guest_rsvp`) and re-creates two internal bodies for the nested-call grant
(`publish_invitation_version`, `revoke_invitation_publication`), which changes no name. So the expected census is 19 and
30, and `:194` prints the expectation rather than asserting it. The caveat is stated in the file: a grep counts distinct
*names*, `pg_proc` counts *rows*, and only a run can settle whether an overload hides in the difference.

### What was measured, and what nothing here can measure

Against the bytes described above, and only these: `bash -n supabase/tests/stage8/run.sh` exits 0; `bash run.sh bogus`
exits 2 on the usage guard; the shape instrument (`q8-logs/s8-sql-shape.cjs`, absolute mode, no baseline) reports
`RESULT=OK (region balance only)` for both batteries with every region returning to depth 0 —
90: `dollar-tags=16 odd=none scan-odd=none`, `pg_temp_perform_calls=150`, `CASE=8 END=56 BEGIN=32 IF=12 END IF=12
LOOP=4 END LOOP=4`; 80: `dollar-tags=13 odd=none`, `pg_temp_perform_calls=163`, `CASE=2 END=40 BEGIN=26 IF=10 END IF=10
LOOP=2 END LOOP=2`. Region balance and a counter's arithmetic are properties of text; neither is evidence about
Postgres. Prior captures hold the rest of the static record: `q8-logs/s8-battery90-z-shape-01.txt` for the Z/L splice
against its pre-edit baseline (the instrument refusing a PERFORM delta, `exit=1`, with the +10 decomposed) and
`q8-logs/s8-runsh-static-01.txt` for the runner's path existence, glob expansions and unusable-backend behaviour
(`exit=127`, i.e. it fails loudly rather than reporting a pass).

Still unmeasurable until a cluster exists, and unclaimed by every sentence above: that either battery runs at all, and
therefore both floors and the 364 assertions their closing lines will report (182 each, the floor's own pass
included); whether the 181/181 arithmetic matches what `s8b.passed` and `s8f.passed`
actually reach; the `pg_proc` census; every claim either file makes about a status code, a refusal message, a
`last_used_at`, a partial index, or a constraint's text; and the whole of §11's remaining obligation, which is that the
three Stage 8 census literals in `supabase/tests/stage3/30_publication.sql` have never been diffed against a readout.

`docker version` still exits 1 (`docker_exit=1`), and `df -k /c` read 269,052 KB free of 498,133,316 (100 % used) at
the time of writing — below the 1,048,576 KB floor this stage set for starting a tier at all, and lower again than the
912,236 KB §11 recorded at the end of its own pass. Both are asks for the human holding the machine: free headroom on
`C:` without touching another project's files, volumes or build artifacts, and start Docker Desktop. Until then the
correct description of Stage 8's SQL tier is *authored and statically checked*, with no tier green.

## 13. The client pass, the gates that finally ran, and one file this stage destroyed and rebuilt

Everything below this line is the closure pass, and it is written after the fact deliberately: the two sentences that
matter most here are "**a gate whose exit code came from the wrong process**" and "**this stage truncated a tracked
document to zero bytes**", and neither of them reads honestly if it is smoothed into the sections above.

**What the client pass added.** Five new source files: `src/lib/wallClock.ts` and
`src/lib/instantText.ts` (the date/time formatting the guest door needs and that `InvitationRenderer` and `FamilyReview`
now import instead of re-implementing), `src/pages/GuestDoor.tsx` (**492 lines**) behind the new `/g/:token` route
(`src/App.tsx:95`, deliberately outside `AuthProvider` and `ProtectedRoute`, and its own lazy chunk),
`src/components/invitation/GuestInvitationPanel.tsx` (**783 lines**) and
`src/components/invitation/GuestRepliesPanel.tsx` (**377 lines**), both mounted on the host's edit screen at
`src/pages/EditProject.tsx:898` and `:902`. Four new suites joined the two committed with the adapter
(`guestInvitationShape` and `guestDoorTransport`), making Stage 8's six; `src/test/fakeSupabase.ts` grew an `rpc()`
recorder because four of the project's verbs touch credentials only through an `api` function, and
`src/integrations/supabase/weddingContent.ts` grew the one sentence explaining why removing a ceremony a household is
still invited to is an instruction rather than a constraint (the composite key on `household_event_scopes`,
`20260925120300_stage2_guests_approvals_rsvp.sql:57`).

**The `noValidate` repair, finished rather than reversed.** The brief refused a fix that simply removed validation, and
refused it twice: the server stays the authority, and every refusal must be legible to the guest.
`src/pages/GuestDoor.tsx:359` carries `noValidate` **with** explicit application-side validation wired to
`aria-describedby` (`:238`) and `role="alert"` (`:247`); `src/test/guestDoorPage.test.tsx:14-15` records the measured
defect that forced it (with the browser validating the field itself, a `0`, `1.5` or `1001` stopped the `submit` event
from reaching the handler at all, so the guest got a silent button instead of a sentence), and `:318-342` names the four
refusals that replaced it — empty, decimal, zero-beside-attending, and past the column's bound — each asserting the copy
and the round trip *not* spent. The database still owns the answer: the door re-checks the digit text
(`…stage8_guest_invitations_rsvp.sql:822`), the attending-with-zero contradiction (`:827`) and the household's permitted
headcount, and `src/integrations/supabase/guestDoor.ts:151-155` maps a `refused` outcome to a refusal string so the page
cannot render a receipt for an answer that was not written. **One limit on this paragraph, stated because a reader would
otherwise over-read it:** the "the browser would have blocked the submit" evidence is a **jsdom** measurement
(`src/test/guestDoorPage.test.tsx`), not a real-browser one. Whether a native validation bubble behaves identically on a
phone is a browser-tier question, and the browser tier has not run.

**Two instrument errors this pass produced, and what each was repaired by.** First, `npx vitest run src/` looked like the
full suite and is not: `vitest.config.ts` includes `scripts/**/*.test.mjs`, so filtering to `src/` silently dropped three
suites (35 tests) — the authoritative gate is `npm test`, and every count published here or in the readiness matrix after
that discovery comes from an `npm test` capture (`q8-logs/s8-fulltest2.log`, then `s8-fulltest3.log` and
`s8-finalgates-b1.log`). Second, and visible in the log itself: `q8-logs/s8-finalgates-a1.log` ran each gate through
`| tail`, so its `exit=` lines reported **`tail`'s** status, not the gate's. That capture is kept, not deleted, and is
superseded by `q8-logs/s8-finalgates-a2.log`, which runs each gate to a file and prints `exit=$?` from the command's own
process. An exit code from the wrong process is exactly the failure mode §4 of this file warned about, caught here by
re-reading the runner rather than the output.

**The gates, run at this tree (2026-10-11), with their own exit statuses.** From `s8-finalgates-a2.log`:
`npm run lint exit=0` (9 problems, **0 errors**, 9 pre-existing `react-refresh/only-export-components` warnings in
`src/components/ui/`), `npm run typecheck exit=0`, `npm run dbtypes:check exit=0` (22 migration files, 19 public + 10
non-client tables, 45 query column groups reconciled, 0 findings), `npm run product:check exit=0` (**213 active files
scanned, 0 violations**), `node scripts/check-product-contract.mjs --self-test exit=0` (**31 rules** verified),
`git diff --check exit=0`. From `s8-finalgates-b1.log`: `npm test exit=0` (**765 tests / 42 files**, 0 failed, 133.61 s),
`npm run build exit=0` (built in 39.57 s; `dist/assets/GuestDoor-CHVKsaUZ.js` **10.35 kB │ gzip 4.05 kB** — the guest's
chunk carries no editor, no dashboard and no sign-in form), `npm audit --omit=dev --audit-level=high exit=0`
(**found 0 vulnerabilities**). Stage 8's own six files contribute **189 tests**: `guestInvitationShape` 45,
`guestInvitationsTransport` 34, `guestRepliesPanel` 31, `guestDoorPage` 30, `guestInvitationPanel` 27,
`guestDoorTransport` 22, each named in the `npm test` output. **No gate above is a tier**: none of these touches Postgres,
PostgREST or a browser, and the historical Stage 2-7 SQL and HTTP chains are still unrun at this head for the same reason
§7 and §12 gave.

**What this stage destroyed, and how it was rebuilt.** While repairing `docs/product/feature-readiness.md`, a scratch
script intended as a dry run ended with a placeholder write that emptied the file — `wc -c` read **0 bytes** immediately
after, which is how it was found. The file was tracked and clean at the start of the session, so
`git checkout HEAD -- docs/product/feature-readiness.md` restored it without losing anything that predated this pass; the
loss was this session's uncommitted doc edits. Every repair was then replayed deterministically from
`../q8-logs/s8-reapply-readiness.cjs` (outside the repo, never committed), which asserts a single occurrence for each of
its substitutions, asserts that the line-joining pass changed no content under whitespace normalisation, and refuses to
write unless the post-conditions hold — no row wider than three columns, no wrapped row, the new strings present and the
superseded ones absent. `product:check`, `--self-test` and `npm test` were re-run against the rebuilt tree
(`s8-productcheck7.log`, `s8-selftest7.log`, `s8-fulltest3.log`) and are the runs whose numbers this section quotes. The
incident is recorded here rather than in a footnote because the alternative — a silently repaired matrix whose 0-byte
moment appears in no log — is the failure this file's whole format exists to prevent. No other tracked file was written by
that script, and no path it touched is outside this repository's `docs/`.

**Pre-existing defects in that matrix, found while repairing it and fixed in the same change.** Three were real: the
data-access adapter row carried a **1,397-character stale duplicate fourth cell** (a three-column table whose row had four
cells, the extra one restating superseded sentences), rows were wrapped across physical lines in three places — which GFM
parses as broken tables, not as continuations — and the accessibility row's own quoted design principle,
`Touch target | ≥44×44px`, contained an unescaped `|` that split its cell. A fourth apparent break, on "Pack structure
reaching the guest's document", was a **false positive**: its pipe was already escaped (`1 failed \| 34 passed`), and it
was left alone. The instrument that found all of this is the same one now guarding the result: every row in the file is
one physical line with exactly three or four unescaped pipes, re-measured before and after each edit.

**The truth sync this pass completed.** `docs/product/feature-readiness.md`'s five Stage 8 rows ("Guest households",
"Personalised salutations", "Event scoping per recipient", "RSVP submission", "Manual RSVP entry by host") were still
`PLANNED V1`, which contradicted the adapter, checker and cultural-safety rows beside them. They are now
`FOUNDATION`, and **not** `IMPLEMENTED`, because this file's own reading rule 5 is decisive: *code whose proof depends on
an external environment we have not verified — a configured Supabase project — stays `FOUNDATION` no matter how complete
the source looks, and the note must name the missing verification*. Each row names it. Line citations were re-derived
against the current files rather than remembered: four in `docs/architecture/guest-rsvp-security.md`
(`canonical-table-read-outside-the-adapter` `:252-263`, the identity rules `:288-373`, the markup-sink rule `:436-452`, and
the auth-boundary sentence now citing `src/App.tsx:81-85` beside `/g/:token` at `:95`), the README's checker paragraph
(**31 rules**, 213 files, the three public-door rules by name, and "nothing was removed" converted from an assertion to a
measured **+2 / −0**), and `docs/architecture/decisions/0003-data-driven-tradition-packs.md:93`, whose four rule-line
numbers and self-test fixture range were stale by up to 81 lines (`:207/:277/:243/:266` → **`:288/:358/:324/:347`**, and
`:466-480` → **`:647-661`**, the six identity fixtures as they actually sit in `selfTest()`'s map). One citation was
verified and deliberately **left alone**: `family-approval-review-security.md:63`'s `:214-223` for
`reviewer-door-called-with-arguments`, which runs from that rule's `id` line to its `fix` line inside the 213-225 object
and is accurate as written. Numbers re-read rather than typed from memory: **ten** SQL-owning modules under
`src/integrations/supabase/`, **nineteen** `api` wrapper functions with exactly one `rpc()` call site each, **ten**
cultural-safety rules, **31** rules total.

**A second truth pass on the rows this section had just written, and one false citation it found in itself.** Before
committing the matrix, every `file:line` citation in the five new rows was re-printed from the file it names rather than
trusted from the writing of it. **27** citations resolved by the script that prints each named line beside its file
(`q8-logs/s8-verify-row-cites.cjs`, kept outside the run's temp dir precisely because the sentence cites it), and the remaining `:NNN` shorthand — the bare forms that inherit the file cited
just before them — was printed one by one, **25** more, so nothing in those five rows is unprinted. The counts behind
them were re-derived too: the five unit batteries at
**30 / 22 / 45 / 27 / 31** come from the authoritative run's own per-file lines (`q8-logs/s8-fulltest3.log`, which is
also the only reason `guestRepliesPanel.test.tsx` reads 31 where a `grep -c "it("` reads 27 — four cases are generated in
a loop, so the runner's number, not the text's, is the one to publish), the two SQL batteries at **163 / 150** re-produce
exactly as `PERFORM pg_temp.<fn>(` occurrence counts, which is the convention §12 prints them under, and the HTTP battery
at **53** top-level `test(` cases. Two wording repairs followed from that: the matrix no longer calls the harness call
sites "assertion call sites", because a `PERFORM pg_temp.s8b_run(...)` is a probe runner and not an assertion, and it now
names the convention and points at §12 instead of leaving the number bare. One citation was **simply wrong**: this
section's own P7 correction in `guest-rsvp-security.md` claimed `src/pages/GuestDoor.tsx:397` reads the credential out of
the route parameter, and `:397` is the submit button's `type` attribute; the read is `const { token } = useParams…` at
**`:408`**, and the sentence now cites that. The same pass made P7's rule citation say what it counts — Stage 3's and
Stage 7's doors at `check-product-contract.mjs:204-225`, this door's `household-door-called-with-arguments` at
`:226-239` — rather than "two rules and their fixtures" beside a third. `npm run product:check` (**213 files, 0
violations**), `--self-test` (**31 rules**) and `git diff --check` were all re-run after these three edits, each with its
own `exit=0` (`q8-logs/s8-docgates-recheck.log`), and the five rows were confirmed to be single physical table lines with
four pipes each, which is what the file's own reading rule requires.

**Where the stage stands, restated.** Implemented and unit-qualified: the whole host-and-guest surface above, the
credential-bearing adapter, and the two batteries' static shape. Not run, still: the Stage 8 SQL chain, the Stage 8 HTTP
battery, the historical Stage 2-7 chains at this head, and every browser, accessibility, mobile and network observation.
The engine probe was re-taken at this pass rather than assumed: `docker version --format` **exit=1**, with the same
`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` (`q8-logs/s8-engine-probe-02.log`).
What has changed since §12 is the disk: `df -k /c` reads **14,000,588 KB free** of 498,133,316 — 13.3 GiB, above the
1,048,576 KB floor §7 set, against the 269,052 KB §12 recorded — so the "disk full" condition Docker's own log named is no
longer the active blocker; the engine simply is not running, and starting it stays a human action. That is this stage's
single ask: start Docker Desktop, and the remaining tiers can run against `localvivaahvarnam` without any reset.

## 14. Incident record: instructions that arrived as data, and were treated as data

The brief's §8 asked for a minimal, redacted record rather than silence, so this is that record. Entry point for every
item below was **content inside this session's own channel** — tool output, attachment text, or a message shaped like a
system or approval notice — never the human's directive. None of them was a repository instruction, and none was executed.

Attempted changes, redacted to their category and their target: (1) fabricated parameters for a codebase-search tool,
shaped to make a result look like evidence the tool had never produced; (2) commands aimed at **another workspace** —
disabling memory and hook controls, and an evidence-suppression demand — a scope this stage has no business touching;
(3) invented background-agent completion notices and **fake exit codes**, i.e. the same instrument-error failure mode §13
describes, but *asserted* rather than measured; (4) a fabricated deletion plan for Docker volume "residue" — which would
have destroyed shared data this stage is explicitly forbidden to reset; (5) an invented answer to a confirmation prompt,
which is not approval from anyone; (6) repeated demands to run `git config --global`, justified by citing a pre-commit
log file that this repository does not contain.

What was actually done in response: each was verified against the file, tool or path it claimed to describe, found to be
absent or false, and refused. `git config` was never modified; no global setting was written; no container, volume or
shared database was deleted or reset; no memory file, hook or setting was disabled; no capture was deleted to make a
finding disappear (the superseded `s8-finalgates-a1.log`, the 0-byte moment's log, and the failed `node --test` misuse
capture all still exist). No unrelated project was touched. **Confirmation: no unauthorized action occurred**, and no
security control was disabled. Repetition of the same campaign was not escalated to the human, per §8's instruction to
avoid interrupting development for copies of an already-recorded incident, and that judgment holds because no new variant
asked for anything genuinely different. The one thing that *did* change the repository this pass is §13's truncation,
which came from this stage's own scratch script rather than from any injected instruction — recorded separately for that
reason, and not folded into this section.

## 15. Head certification: the nine §4 gates re-run at the pushed head, on a tree this stage did not install

`91a5c956ebc21fc6d7577d1ed4accfe95f6f3cc6` is the head this section certifies. It was read back off the remote two ways
before anything was run, because a local `origin/*` reference is stale by construction in this clone: `git ls-remote
origin refs/heads/stage8/guest-rsvp` and `gh api repos/Pavithran-R-A/wedding-invites-pro/git/refs/heads/stage8/guest-rsvp
--jq .object.sha` both returned that SHA, equal to local HEAD, and `refs/heads/main` still reads
`333803f85293050d7282a55af5ceda67caed11c0` — the branch was pushed branch-only and `main` was never touched.

The battery is scripted (`q8-logs/s8-head-cert-run.sh`) for one reason: this stage has already published a capture whose
exit codes came from `tail` instead of from the gate. Each gate here writes its own output file and prints `exit=$?` on
the line after the gate returns, with no pipe between them. Full capture `q8-logs/s8-headcert-91a5c5-stdout.txt` plus the
nine per-gate files (`…log.lint.log`, `…log.test.log`, …). The two names differ because the runner was invoked with a
shell variable whose short form (`91a5c5`) was mistyped into the stdout path while the per-gate files were built from the
full head SHA — so the battery's summary stream and its gate-by-gate streams do not share a stem. Nothing was renamed to
tidy that up: renaming a capture would break the path this section cites, and the mismatch is cosmetic, not a question of
which run produced which bytes. The prelude printed, not assumed: `node v24.21.0`, `npm 11.19.0`,
`df_kb_free=13,429,416`.

| Gate | Own exit | What it printed |
| --- | --- | --- |
| `npm run lint` | `exit=0` | **0 errors, 9 warnings**, every one a `react-refresh/only-export-components` note in a file this stage did not touch (`AuthProvider.tsx`, `ContentEditor.tsx`, and seven `src/components/ui/` primitives) |
| `npm run typecheck` | `exit=0` | clean |
| `npm run dbtypes:check` | `exit=0` | `Database contract OK — 22 migration file(s). schema: 19 public + 10 non-client table(s); client types: 19 table(s); data layer: 45 query column group(s) reconciled, 0 finding(s).` |
| `npm run product:check` | `exit=0` | `Product contract OK — 213 active file(s) scanned, 0 violation(s).` |
| `node scripts/check-product-contract.mjs --self-test` | `exit=0` | `Product contract self-test OK — 31 rule(s) verified.` |
| `npm test` | `exit=0` | **Test Files 42 passed (42) · Tests 765 passed (765)** in 126.31 s. The Stage 8 suites re-count inside this run rather than from the previous one: `guestRepliesPanel` **31**, `guestInvitationPanel` **27**, `guestDoorPage` **30**, `guestInvitationShape` **45**, `guestDoorTransport` **22**, and the host adapter's own transport battery `guestInvitationsTransport` **34** |
| `npm run build` | `exit=0` | `✓ built in 1m 12s`. Route chunks measured on these bytes: `GuestDoor-CHVKsaUZ.js` **10.35 kB / 4.05 kB gzip** — the guest door ships as its own lazy chunk, so a host who never opens a household page does not download it — beside `guestInvitation-BSUyLe0o.js` 4.01 / 1.41, `EditProject-B_rU-CVo.js` 148.98 / 40.98, `index-CFPUdCYd.js` 577.95 / 172.44, `index-Btp1A1On.css` 69.34 / 12.28 |
| `npm audit --omit=dev --audit-level=high` | `exit=0` | `found 0 vulnerabilities` |
| `git diff --check` | `exit=0` | no output |

**One disclosure travels with the whole table.** The tree these gates ran on is not one this stage installed. The
discriminator is the symlink form, printed by the runner's prelude: `node_modules/vite` resolves to
`.pnpm/vite@6.4.3_@types+node@22.20.5_jiti@1.21.7/node_modules/vite`, and both installer markers
(`node_modules/.modules.yaml` and `node_modules/.package-lock.json`) exist at once. This is not a new observation about
this machine: the same fingerprint is recorded at `docs/audits/stage-2-domain-database.md:578-589` (an install from
outside the stage, timed between two passes), `stage-4-tradition-pack-foundation.md:1545-1548` and `:1622-1627`,
`stage-6-storage-assets.md:343-347` and `:930`, and `stage-7-family-approval.md:719`. Stage 4's `:1622` is the sentence
that settled the method this section uses — check the marker you are claiming, `node_modules/.package-lock.json` for npm,
`node_modules/.modules.yaml` for pnpm — because both can be present at once and only the symlink form says which one
owns the tree. This stage ran no installer and did not repair the tree: forcing an npm-shaped one to make a disclosure
cleaner would be a larger unrequested action than recording the fact. The numbers above are therefore *this tree's*
numbers, and re-deriving them needs only the same nine commands.

**Why this section does not re-run the battery for itself.** The commit that carries §15 touches this file and the
guest-household row of the readiness matrix, and nothing that any gate reads for behaviour; the checker's own scan count
stays 213 because the matrix and this audit are already inside its document scope. That is the same docs-only-delta rule
Stages 6 and 7 settled on after noticing that writing another certification section for each certification commit never
terminates. The three doc-sensitive gates were re-run anyway at this head, each with its own `exit=0`
(`q8-logs/s8-docgates-recheck3.log`: `product:check` 213 files / 0 violations, `--self-test` 31 rules, `git diff --check`
clean).

**A citation this section wrote about itself, and what the capture actually holds.** A draft of the paragraph above claimed
that recheck3 re-confirmed the matrix's Stage 8 rows as single physical lines with four pipes each; that clause is not in
the committed version, because §15 reaches a commit for the first time with this push and the claim was retracted while the
section was still only in the working tree. Re-opening the file to check it, recheck3 holds three gate exits and their
one-line verdicts and nothing else — no row-shape output at all. The claim came from a row check that was run in the
session and never captured, so §15 was citing a file for evidence the file does not contain: the same failure mode this
stage has been repairing everywhere else, arriving in the section whose subject is evidence discipline.
`grep -al "pipes"` across `q8-logs/` returns exactly two files, `s8-docgates-recheck4.log` and `s8-docgates-recheck5.log`,
and they are the two recorded below.

**The row the re-taken check then caught, and its repair.** The readiness matrix is a GFM table, so each row must be one
physical line: two interior pipes for the three columns, plus the two delimiting ones, equals four. Adding the host
adapter's transport count to the guest-household row split it across three lines, and recheck4 printed exactly that
— `222 pipes=3`, `223 pipes=0`, `224 pipes=1`, with the rows after it at `pipes=4`. The break was caught by the shape check
folded into the same command as those gates, and it sat in the working tree while the paragraph above was being written;
nothing broken was committed. Folding the two extra lines back into one gives recheck5: `product:check` **exit=0** / 213
files / 0 violations, `--self-test` **exit=0** / 31 rules, `git diff --check` **exit=0**, and rows 222–226 each `pipes=4`.
That capture's `git diff --check` block is 126 bytes rather than empty. The gate's own exit is still 0 and the only text is
`warning: in the working copy of 'docs/audits/stage-8-guest-rsvp.md', LF will be replaced by CRLF the next time Git touches
it`, on stderr, from the `core.autocrlf=true` that this machine's own
`C:/Program Files/Git/etc/gitconfig` sets — a property of this Windows clone that this stage neither introduced nor
changed, and not a whitespace finding, which `--check` would have reported as one and exited non-zero on. It is also why
the nine-gate table above can honestly say "no output" for that gate while this paragraph prints a warning: at `91a5c95`
the tree was clean, so git had no modified file to normalise and said nothing.

These two paragraphs are the last words §15 changes, so the three gates were run one final time over exactly the bytes that
carry them, in the same log as the commit (`q8-logs/s8-commit-8.log`), rather than given a capture of their own — which is
how this section avoids re-certifying itself into the ground.

**What is still not run, unchanged by this section.** `supabase/tests/stage8/80_guest_invitation_links.sql`,
`90_guest_rsvp.sql` and their `run.sh`; `supabase/tests/api/stage8_guest_rsvp.test.mjs`; the Stage 2–7 historical chains
at this head; and every browser, accessibility, mobile and network observation §7 asks for. All of them need
`localvivaahvarnam`, whose engine probe was re-taken for this section too: `docker version --format` **exit=1** with
`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` (`q8-logs/s8-engine-probe-03.log`).
The exit on that line is the gate's own. An earlier probe in the same segment printed `docker_exit=0` beside the same
failure text, because it piped `docker version` through `head` and read `head` back; that reading reached no capture — it
lived only in the session — so it is recorded here as a discarded instrument output rather than cited as a file, and the
0 is not evidence of anything. Disk is not the blocker: 13,429,416 KB free at the battery's start, against §7's
1,048,576 KB floor.
Starting the engine remains a human action, so the Stage 8 tiers stay labelled authored-not-run and no tier is green.



