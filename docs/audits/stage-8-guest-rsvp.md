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

`supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql` now exists — 1219 lines, measured with `wc -l`
and recorded in `q8-logs/s8-selfreview-01.log` §2 (cited by section, not by line number, because that file grew by two
edits after the citation was first taken and a line cite into a scratch capture is the kind of cite that goes stale
silently). **It has been applied to nothing.** No throwaway database, no local
stack, no chain. §4's first "not written" item is therefore closed and its "not run" list is not, and because §4 is in
git history the correction lives here rather than as an edit to §4.

What the file is, counted from the file itself rather than from the design doc's intention:
**14 function definitions** — 6 new `internal_api` bodies (`:145`, `:307`, `:365`, `:460`, `:539`, `:699`), 6 new
`api` wrappers for the same six names (`:1086`-`:1138`), and 2 re-declared `internal_api` publication verbs
(`:923`, `:1026`). That is 12 new function names and 2 replaced bodies, which is the surface S8-3 has to pin.
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
| `api.get_guest_invitation_state` missing `STABLE` | a read door that diverges from the one precedent that exists for it | `20261008120000_stage7_family_approval_review.sql` has **one** STABLE wrapper — `api.get_approval_requests` at `:827`, `LANGUAGE sql STABLE SECURITY INVOKER` at `:829` — and four write wrappers with no STABILITY clause at all (`:813`, `:821`, `:837`, `:850`). After the fix, `grep -n "LANGUAGE sql"` over this stage's file shows exactly one STABLE line, `:1116`, on the read wrapper, and none on the five write wrappers. |
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
