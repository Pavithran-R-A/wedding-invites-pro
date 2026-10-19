# Stage 10 — Commerce foundations: what ran, and what each run measured

Branch `stage10/commerce-entitlements`. The stage opened on `main` at `6ac1a6765…` plus ChatGPT's
`e94c53e docs(stage10): pin commerce threat model and provider-neutral kickoff`; **20 commits** join
`6ac1a67` and `b81c441` (`git rev-list --count 6ac1a67..b81c441`), 19 of them after the kickoff commit, and
**21** join it to the first docs head `1f3cf3e` — §13's ledger is what keeps those two numbers traceable to
the slices. The code head every tier below was driven from is
`b81c441d969f620bff0fbd036672026b12e8e72d`; the docs slices that follow it change prose, not inputs, and each
is listed with its read-back. Working clone
`Documents/Qoder/2026-09-24/37be0a2a/s5qual`. `main` was not modified, nothing was deployed, no hosted
Supabase project was contacted, GitHub Actions was not used, no live payment order was created, no
customer was charged, and Stage 11 was not begun.

The evidence directory is `q10-logs/`, which lives **outside** the repository, in the working clone's
parent (`Documents/Qoder/2026-09-24/37be0a2a/q10-logs/`, 3.0 MiB at this writing). It is never committed
and never staged, and no instrument writes into the clone: one did, and the misfiled capture is named in
§9. Every number below was re-read from a named capture rather than carried over from an earlier draft.

Append-only. A section is never edited after it is committed; a wrong statement is corrected by a later
section that names it. `docs/architecture/commerce-foundations.md` §14, which is a design note rather
than a record, *was* edited by this pass — §12 says which lines it retired and why that is allowed there
but not here.

## 1. Scope, taken from the binding inputs

`docs/superpowers/specs/2026-10-17-stage10-commerce-kickoff.md`, ADR
[`0005-server-authoritative-commerce.md`](decisions/0005-server-authoritative-commerce.md), ADR
[`0008-provider-neutral-payment-ledger.md`](decisions/0008-provider-neutral-payment-ledger.md),
`docs/product/commercial-model.md` and the V1 scope list are the requirements. They were read before the
migration was written, and the design note
[`commerce-foundations.md`](commerce-foundations.md) carries the argument; this file carries the
measurements.

The eight obligations and where each is answered, by artefact rather than by adjective:

| Obligation | Artefact | What proves it |
| --- | --- | --- |
| Server-calculated quotes, immutable purchase orders | `internal_api.create_commerce_order`, `private.commerce_orders` frozen columns, `private.guard_commerce_order_freeze` | SQL battery 1 `Q01..Q14`, battery 2 `T73..T79`, `T85`; HTTP `P-03`, `P-08`, `P-12`, `D-15`; unit `CD-01..CD-42` |
| Wedding ownership, currency and amount validation | `wedding_id`/`owner_user_id` copied by the writer, `CHECK (currency IN ('INR'))`, `amount_minor bigint CHECK (> 0)` | battery 1 `F13..F15`, `H34/H35/H38..H40`; battery 2 `R05..R09`; HTTP `S-06..S-10` |
| Append-only, idempotent payment-event processing | `UNIQUE (provider, event_id)`, no-UPDATE trigger, two-level idempotency | battery 1 `D09/D12/D16`, `H15..H17`; HTTP `D-02`, `D-16`; `90_commerce_functions.sql` group `D` |
| Webhook verification interface, provider signatures on synthetic fixtures | `scripts/stage10-webhook-core.mjs` (485 lines) + `scripts/stage10-commerce-driver.mjs` | unit `WH-00..WH-46` (36 cases) — HMAC over raw bytes, constant-time compare, verify-before-parse |
| Separation of initiation / capture / entitlement / refund / revocation | five distinct edges in `commerce_orders.status`, `grant_commerce_entitlement`, `revoke_commerce_entitlement`, `private.commerce_refunds` | battery 1 `R01..R31`, `S01..S13`; HTTP `R-01..R-11`; browser `B30..B80` |
| Guards and RLS so a customer cannot write their own paid status | six `private` tables: `rls=true`, no policies, no grants, `reject_client_write`/`reject_client_delete` | battery 2 `V01..V15`, group `T`, `N01..N04b`; HTTP `N-01..N-05`; `40_catalog.sql` C26f/C41b |
| Reconciliation and recovery design | `internal_api.commerce_reconcile`, held rows, §10 of the design note | battery 1 `K02..K34`; HTTP `R-08`, `R-11` — **design + sweep, no live provider to reconcile against** |
| Host pending / failed / cancelled / verified states, no unapproved prices | `api.commerce_host_summary`, `src/lib/commerceStatus.ts`, `CommerceStatusPanel.tsx`, migration `20261019130000` | browser `B01..B96` (40 cases on built bytes), unit `src/test/commerceStatus*.test.ts{x}` (17 + others), HTTP `S-11`, `P-01..P-07` |

V1 commercial commitments held: one payment per wedding (partial unique live order per
wedding+package, `Q12..Q14`), no per-guest charge (C41b's census lists **six** price-shaped columns in
`private`, none of them guest-scoped, and C41 proves `public` has none), and no gating of QR, maps, RSVP
or exports (browser `B100`, `B110`, `B111`; battery 2 group `T`).

## 2. The surface, counted from the catalog rather than from prose

Three migrations: `20261017120000_stage10_commerce_foundations.sql` (1683 lines),
`20261019120000_stage10_publish_gate_empty_list.sql` (86) and
`20261019130000_stage10_host_failed_state.sql` (169). They create:

- **6** `private` tables — `commerce_packages`, `commerce_orders`, `commerce_payment_attempts`,
  `commerce_payment_events`, `commerce_refunds`, `commerce_policy`.
- **7** `internal_api` function bodies — `create_commerce_order`, `grant_commerce_entitlement`,
  `revoke_commerce_entitlement`, `expire_commerce_order`, `record_commerce_event`, `commerce_reconcile`,
  `commerce_host_summary`. Six have no `api` wrapper and are unreachable by any client; the seventh is
  paired with `api.commerce_host_summary`, the one read door a browser may knock on.
- **2** `private` trigger guards (`guard_commerce_order_freeze`, `guard_publication_commerce_gate`),
  plus `private.reject_any_update`, and `publications_commerce_publish_gate` wired to
  `public.publications`.

Each of those names is enumerated by name in `supabase/tests/stage2/40_catalog.sql` behind
`st2_at_least('stage10')`, and the HTTP suite's `before` hook re-asserts the three sets name-for-name
rather than by count (`stage10_commerce_http.test.mjs:764-787`), because a renamed body would otherwise
pass a count and answer 404 for every case below it. The definer-pairing cell `C26f` now counts **22**
pairs (19 at Stage 9, 13 before that); `C41b` pins the six price-shaped server columns; the FK arm lists
the eight referential clauses touching the money tables, all `NO ACTION` to weddings and `SET NULL` to
users.

ADR 0008 said "four service-only functions" where the shipped count is seven. §12 records that repair.

## 3. Tier 1 — the unit batteries, no engine under them

`scripts/stage10-webhook-core.test.mjs` **36** cases (`WH-00..WH-46`, the gaps at 17–19, 28–29 and 34–39
deliberate: one id per rule, not one per arrangement) and `scripts/stage10-commerce-driver.test.mjs`
**43** (`CD-01..CD-42`). With the three host-projection files — `src/test/commerceStatusShape.test.ts`
**17**, `src/test/commerceStatusTransport.test.ts` **10**, `src/test/commerceStatusPanel.test.tsx` **20** —
Stage 10's share is **126** of the repository's **1375 tests in 63 files**
(`q10-logs/s10-headgate2-test.txt`, `gate=test exit_code=0`, taken at `b81c441`).

Sensitivity, i.e. each battery seen to fail: `q10-logs/s10-wh-mutation-old-impl.txt` runs the webhook
cases against the pre-repair verifier and `q10-logs/s10-wh-restored.txt` runs them against the shipped
one. The driver repair in `3071462` (report the database's own `ERROR:` sentence instead of the last line
of a buffer) was driven by a measured incident — a refusal at `internal_api.record_commerce_event` whose
reason was lost — and its 43 cases were re-run over the repaired file (`q10-logs/s10-driver-repair-test2.txt`).

## 4. Tier 2 — the SQL batteries, on two engines

`supabase/tests/stage10/run.sh commerce` with `STAGE10_LOCAL=1` on the host's native
`PostgreSQL 17.10` → ledger **291**, functions **277** (`q10-logs/s10-sql-truthsync-4.txt`).
`run.sh all` with no local override starts `postgres:16-alpine` — the engine the product ships on —
rebuilds six chains and comes back green everywhere: Stage 10 291/277, Stage 9 134/94, Stage 8 182/185,
Stage 7 255/116, Stage 2 50/464/106/77, Stage 3 46/49/284, Stage 4 428/57, Stage 5 122/50/124,
Stage 6 91/80 — **66 `PASSED (n)` lines**, no `!!`, no FAIL, exit 0 (`q10-logs/s10-sql-pg16-all-1.txt`).
The two engines' suite-total multisets differ in exactly one number, functions 276 → 277, which is the
`G05h` cell added between the runs, not an engine divergence.

What these numbers do **not** carry is stated in the runner's own closing notice, not inferred here:
PostgREST, Supabase Auth, the Storage API and any HTTP webhook receiver were not executing, so no
provider signature was verified — the ledger's inputs there are digests and a declared validity bit.
Payment initiation, capture, refund and dispute over a wire belong to tiers 1, 3 and 4.

## 5. Tier 3 — the HTTP tier, and the two runs that were not evidence

The green capture at `b81c441` is `q10-logs/s10-http-head-3.txt`: `supabase/tests/api/run.sh` against the
live `localvivaahvarnam` stack, **ten suites, 436 executed cases, 0 failures**, `exit_code=0` read from
the adjacent `echo`. Per suite: stage10 **68**, stage3_publication 39, stage3_security 56, stage4 28,
stage5_admin_cli 36, stage5_pack_driven 28, stage6 34, stage7 61, stage8 56, stage9 30. Preconditions
printed `27 migrations applied, matching supabase/migrations` and `public schema: 20 tables, 46
policies`; the closing census printed every money store back to 0 rows, `entitlements back to 0 rows`,
`commerce_policy back to 1 rows` and `the commerce policy is back at the shipped permissive posture with
no package named`.

Stage 10's suite is 68 cases here and 67 in the earlier capture (`s10-http-full-1.txt`); the added cell
is `G-08`, which asks the policy singleton to come back on its own rather than trusting teardown.
Executed counts, not `test(` occurrences: several of the other suites generate cases in loops.

The two runs that came before it are in the record because they are the reason §11's residue rule
exists, and because hiding them would make the green line mean less, not more:

- `q10-logs/s10-http-head-1-moved.txt` — every Stage 10 case reported *"test did not finish before its
  parent and was cancelled"*, because the `before` hook asserted `'9' !== '0'` on
  `count(from private.commerce_packages)` and refused to start. The catalogue was not empty: nine rows
  left by this pass's own aborted browser runs. No assertion was touched.
- `q10-logs/s10-http-head-2.txt` — the same stack after the five money tables were cleared:
  **67 pass, 1 fail**, `✖ Z-03: an entitlement granted by a commerce capture belongs to another wedding
  '9' !== '0'`. Z-03 also sweeps `public.entitlements`, which the `before` hook does not, and this pass
  had cleared the ledger but not the rights the ledger had bought. §11 names the two scoped statements
  that fixed it.
- Older history stays: at 2026-10-19 12:5x the suite ran 66/1 with `G-02` red because the stack still
  carried the pre-repair publish-gate body (`q10-logs/http-s10http-1792394672-r10.txt`,
  `node_test_code=1`). The repair was applied forward with `npx supabase db push --local --skip-vault`
  after a `--dry-run` showed exactly one pending file (journal 25 → 26); the assertion was not moved to
  meet a schema that was behind. A later `db push` took the journal to 27 for
  `20261019130000_stage10_host_failed_state.sql`.

## 6. Tier 4 — the host panel driven in a real browser, over the wire

`scripts/stage10-browser-commerce.mjs` (893 lines, committed in `b81c441`) drives the shipped production
bundle on `127.0.0.1:4173` against the stack's Kong on `:54400`, signing the fixture host in through the
real sign-up form and the real login. **40 cases, 0 failures**
(`q10-logs/s10-browser-4.txt`, `# finished 2026-10-19T11:20:47.194Z`).

The states are driven, not asserted from a type table: `no_purchase` (`B10`/`B11`), `quote_open` with the
approved figure and the quoted-not-taken tail (`B20`/`B21`), `payment_pending` (`B30`),
`payment_attempt_failed` while the order itself stays pending (`B31`/`B32`) and clearing when a newer
attempt exists (`B33`), `cancelled` (`B40`), `quote_expired` (`B90`), `entitlement_active` (`B60`),
`refunded_pending_review` under the shipped `hold_for_review` default (`B61`), `entitlement_revoked`
reached without a refund row (`B70`) and `chargeback_hold_for_review` (`B80`). `B50`–`B52` are the
unapproved-price rule: the wire body carries no `amount_minor` and no `currency`, the page prints a
sentence instead of a figure, and the same reader does show a figure for an approved price — so the
silence is proven to be the rule rather than a broken formatter.

Privacy and boundary cases ran in the same session: `B95` a signed-in non-owner refused 403/42501, `B96`
the commerce section never mounting for that session, `B100` zero commerce requests from any guest,
invitation or review door, `B101`/`B124` every request loopback, `B110`/`B111` the money door present only
in `EditProject-dDTIUj7S.js` and in neither guest chunk, `B120`–`B122` **7859 captured request header
values** hashed with none matching the service-role key, the secret key or the maintenance database URL,
`B123` the host session authenticated with the publishable key, `B125` the webhook signing key never
reaching the browser, `B130` the run's own catalogue rows gone.

Three earlier arms of this tier are kept rather than deleted, because the tier's value is partly that it
found its own instrument defects: `s10-browser-1/2/3.txt` (runs `627a295a2b89`, `ee041c483aed`,
`7a92a71d52e2`) each aborted mid-flight — a shadowed `log` binding that broke the doors block, and a
`Refusal` whose reason the driver had dropped (the `3071462` repair). Their residue is what §§5 and §11
describe. `B01`–`B04` are a reader-side rule, not a UI rule: the panel's state arms are read *out of the
migration's own derived-state CASE*, including its `ELSE` arm, so a state added to the schema without a
sentence is refused by the instrument that claims to render states.

## 7. The refusal that has a keeper in every layer

§12 of the design note refuses "a checkout UI". A sentence in a design note is the weakest kind of
refusal, so the rule now exists in the checker and in the copy: `client-side-checkout-affordance`
(`scripts/check-product-contract.mjs:484`, scoped to `src/`, allow-list at `:781`, its own assertion at
`:1083`, and pinned in the checker's test at `scripts/product-contract.test.mjs:70,344`). `product:check`
is green at this head over **260 active files, 0 violations** (`s10-headgate2-product-check.txt`).

Two arms of the shipped copy are **unreachable and stay that way on purpose**, and are recorded as
findings rather than as coverage: the panel's "no symbol for that currency" arm cannot fire while
`CHECK (currency IN ('INR'))` stands, and three host states cannot be reached by a browser tier without
rewriting the shared `private.commerce_policy` singleton, which this stack has exactly one of.

## 8. Tier 5 — historical regressions at this head

Every browser/qualification instrument from earlier stages, re-run against this stage's tree and bundle.
Each line is a capture in `q10-logs/`, not a carry-over from the Stage 9 audit:

| capture | instrument | result |
| --- | --- | --- |
| `s10-regression-stage4-render-1.txt` | Stage 4/5 render qualification | checks **144**, measurements **31**, findings **0** |
| `s10-regression-stage5-journeys-1.txt` | Stage 5 host journeys | checks **89**, measurements **12**, findings **0** |
| `s10-regression-stage5-a11y-1.txt` | Stage 5 accessibility | checks **63**, measurements **51**, findings **0** |
| `s10-regression-stage5-network-1.txt` | Stage 5 network/privacy | checks **105**, measurements **67**, findings **0** |
| `s10-regression-stage6-assets-1.txt` | Stage 6 assets | checks **138**, measurements **21**, findings **0** |
| `s10-regression-stage7-review-1.txt` | Stage 7 review | checks **104**, measurements **18**, findings **0** |
| `s10-regression-stage8-guest-1.txt` | Stage 8 guest | checks **133**, measurements **25**, findings **0** |
| `s10-regression-stage9-raster-1.txt` | Stage 9 raster outputs | **325** assertions, 45 render records, 63 measured rows, `ALL CHECKS PASSED` |
| `s10-regression-stage9-og-1.txt` | Stage 9 OG serving | checks **497**, findings **0** |
| `s10-regression-stage9-outputs-refusal-1.txt` | Stage 9 host-UI/publisher tier | **refused**: `VIVAAHVARNAM_S9_HOST_PASSWORD is not set, so the host cannot sign in.` |

Nine of the ten reproduce the Stage 9 audit's numbers exactly. The tenth difference is one measurement,
not a finding: Stage 5's accessibility tier reported 50 measurements there and **51** here, which is a
counted element on a page this stage did touch (`CommerceStatusPanel` renders into the host workbench).
It is disclosed rather than smoothed over, and the tier's findings stay 0.

The Stage 9 host-UI/publisher row is the one tier this stage could not re-run, and the capture proves it
by the instrument's own refusal instead of by an assertion in this file: that tier signs in as a fixture
host whose local password exists in no tracked file and no evidence file, by design
(`scripts/stage9-browser-outputs.mjs:127-136` refuses argv as a credential store). Re-running it at a
later head would need the human partner to hand the credential over, which is a genuinely human-only
action and was not taken.

## 9. Secret isolation, and a sweep that had to be widened before it was believed

`secret_sweep_1.mjs` (throwaway, workspace root) reads `.env.local`, takes every value of ≥16 characters
that is not a loopback origin — 4 values, the publishable key's two spellings sharing one digest — and
searches the tree for them literally, plus three credential *shapes* (`eyJ…` JWT, `sb_publishable_…` /
`sb_secret_…`, `postgres(ql)://user:pass@host`). Every ≥16-char token is masked as
`<len ch sha:…>` before printing, so the report itself cannot leak what it finds.

Verdict at this head: **453 files scanned, 0 literal matches, 23 shape matches, none of them a declared
credential** (`q10-logs/s10-secret-sweep-3.txt`). All 23 sit inside test fixtures that carry canary text
(`canary-pw-${RUN_TAG}@10.20.30.40`) — that is the sweep finding bait, which is what bait is for.
Positive controls print beside the verdict so a zero cannot be read as a broken instrument.

Two earlier captures are kept because the sweep was wrong before it was right: `-1` printed
`sample: (undefined)` (no file, line or digest with the match), and `-2` reported 75 literal hits that
were an artifact of comparing the local database URL's **8-character default password word** against every
line in the tree. Version 3 treats that component as generic-default (`SUPABASE_LOCAL_DB_URL password
component length=8 generic-default=true`) and excludes it, while still flagging any password component
≥12 characters. That is the sweep's meaning being widened, not its coverage being narrowed.

Browser-side isolation is separately measured in §6 (`B120`–`B125`), and the HTTP tier's
`leak_census` covers the money stores. The service-role key never left the driver process in any tier.

## 10. Node gates at the code head

All seven gates at `b81c441`, each with its exit code read from the adjacent `echo`:

| gate | result | capture |
| --- | --- | --- |
| `typecheck` | exit 0 | `s10-headgate2-typecheck.txt` |
| `lint` | exit 0, **0 errors / 9 warnings** | `s10-headgate2-lint.txt` |
| `product:check` | 260 active files, 0 violations | `s10-headgate2-product-check.txt` |
| `render:check` | 6 families, 72 faces, 0 product-facing CDN references | `s10-headgate2-render-check.txt` |
| `bundle:check` | 38 chunks, 169 import edges read, 0 plate/encoder chunks on guest doors | `s10-headgate2-bundle-check.txt` |
| `dbtypes:check` | 27 migrations, 20 `public` + 16 non-client tables, 45 column groups, 0 findings | `s10-headgate2-dbtypes-check.txt` |
| `test` | **1375 tests, 63 files, 0 failed** | `s10-headgate2-test.txt` |

`dist/` is untracked build output, and was **not** rebuilt for these gates: the last change to `src/` is
`b6556f5` (15:46) and the build is from 16:11, so the bytes the browser tier drove are the bytes the
bundle checker checked, and the chunk names in §6 are the names in `dist/assets/`. The two commits after
`b6556f5` touch only `scripts/`.

**Re-taken at the docs head.** §12's slice carries documentation only — no `src/`, `scripts/`, SQL or
migration byte — so it needed the gate set run over it, not a re-measurement of any tier. It was run twice:
once across the working tree on its way to being a commit (`s10-headgate3-*`, seven captures, every one
`exit_code=0`) and once at the commit itself (`s10-headgate4-*`, seven captures, each opened with
`# head 1f3cf3e09f21605620f6f381d5d230735a696a7e` and closed by its adjacent `gate=<id> exit_code=…` line).
Only the `-4` set is a head certification; the `-3` set names no head, because it was captured before the
SHA existed, and it stays as the measurement the edits were checked against rather than being deleted. Their
counts are not restated here, for the reason Stage 6 §22.7 and Stage 7 both recorded: a section that
publishes gate numbers is itself a docs-only head that then needs its own, which is a regress the evidence
directory exists to absorb. The rule this pass follows instead is that **the commit carrying a further docs
edit to this file is certified by the next capture set in `q10-logs/`, whose numbers stay in those logs** —
so no prose in this file is ever one commit stale about a measurement it quotes.

`dist/` was not rebuilt for either set. That is a deliberate omission, not a gap: the diff is
documentation-only, so the bytes §6's browser tier drove are still the bytes `bundle:check` reads, and the
build is a separate measurement from the seven node gates rather than one of them.

## 11. Residue on the shared stack, and the two scoped statements that cleared it

`localvivaahvarnam` is shared with DueWeave, so a reset was never an option and a broad `delete` is never
one either. The blocker in §5 was measured before it was touched: **9** `commerce_packages`, **19**
`commerce_orders`, **16** attempts, **37** events, **6** refunds, **9** `public.entitlements`.
Attribution, in `q10-logs/s10-catalogue-residue-2.txt`, `-3.txt` and `s10-entitlement-residue-1.txt`:
each table's rows were counted against the `s10ui-%` run tags of this pass's four browser arms, and the
number of rows *not* matching was **0 in all six tables** — including `events`, whose signature-refusal
rows have no `order_id` and are attributed by `event_id`.

`q10-logs/s10-residue-cleanup-1.sql` deletes refunds → events → attempts → orders → packages, in FK order
(read off the eight clauses in `-3.txt`), each `DELETE` stating its own `s10ui-%` predicate rather than
relying on the measurement. `q10-logs/s10-residue-cleanup-2.sql` deletes the entitlements, scoped by
`package_code LIKE 's10ui-%' AND metadata->>'order_id' IS NOT NULL`; the only FK into `entitlements` is
`commerce_orders.entitlement_id`, already empty, so no cascade was invented. Result: 6/37/16/19/9 and 9
rows deleted, every money store and the rights table back to 0, `commerce_policy` still 1.

**Left on purpose**, and disclosed: 38 weddings / 38 `auth.users` on the stack (8 of each created by these
browser arms through the shipped sign-up form), and **71** `private.audit_events` rows with a commerce
`subject_type`. The tier's own recorded ruling is that those weddings own draft `invitation_versions` rows
under `ON DELETE NO ACTION`, so an account-deleting cascade written by an instrument would be a claim
about the schema that the schema has not made; the audit rows are the ledger behaving as designed, and
nothing asserts their count. `q10-logs/s10-browser-4.txt` prints the same statement at run time
(`orders 13 -> 19, weddings 30 -> 38, auth users 30 -> 38`).

One capture was misfiled and stayed misfiled until it was named: `s10-http-head-1` was redirected with
`../../../q10-logs/` from inside `supabase/tests/api`, which resolves to `s5qual/q10-logs/` — inside the
clone. It was moved to `q10-logs/s10-http-head-1-moved.txt`, the stray directory removed, and `git status`
then showed only the two pnpm files that are never staged. The correct depth from that working directory
is `../../../../q10-logs/`, or an absolute path.

## 12. Truth sync this pass made, and the one place append-only does not apply

Six tracked files carried a sentence that Stage 10 made false. Each was repaired in place, and each repair
is a *status* sentence — the decision it describes is untouched.

`docs/architecture/commerce-foundations.md` §14 is the stage's own status section, and the repository's
rule for those is that they follow the measurements. Three of its claims were false at this head:

- **Tier 4 said "unrun … there is no pending/failed/cancelled/verified UI to drive."** §6's 40/40 capture
  retires it; the UI exists and was driven.
- **Tier 3's count (435, stage10 67) and Tier 1's count (1327 tests / 60 files)** were read from logs
  taken before `G-08` and before the three host-projection unit files joined the sweep. Replaced with §5's
  and §3's numbers (436 cases / stage10 68; 1375 tests / 63 files), with the earlier captures named as
  history rather than deleted.
- **Tier 1's framing** ("under the disk constraint the host is currently in") and **Tier 4's definition**
  ("Requires headroom") described an outage that the human partner's starting the engine resolved; the
  tiers that needed Docker ran.

`docs/architecture/decisions/0008-provider-neutral-payment-ledger.md` had two. The cost line said "six
`private` tables and **four** service-only functions"; the shipped count is six tables, seven
`internal_api` bodies and one paired `api` wrapper (§2). Its context bullet said "Nothing gates publishing
on an entitlement **today**", which was the fact the decision was taken on and is now the thing the stage
built — so it reads as the pre-decision context it is, with the gate named beside it. A wrong census is
not a decision, which is why both were edited rather than appended around.

Four more files asserted Stage 10's negative:
`docs/architecture/stage-2-domain-blueprint.md`'s I-21/I-22/I-23/I-24 ("no trusted path … ever sets a row
`active`", "not enforced yet", "no order or payment table exists", "representable, unwired") now carry the
same inline-correction shape I-27 already used for Stage 6; `docs/architecture/domain-model.md`'s
"Entitlement granting" row and its money paragraph; `docs/product/feature-readiness.md`'s Payment
collection / Entitlement / GST / Pricing display / Refunds rows — including the GST row's "no monetary
column in `public` **or `private`** at all (C41)", which was the wrong half even before Stage 10, because
C41 measures `public` and `C41b` is the cell that names the private ones; and `README.md`'s
"what deliberately does not exist yet is a product surface for payment".

The `docs/audits/` rule is different, which is why §5, §8 and §11 add sections instead of editing numbers.

Every case id cited in these six files was re-greped out of the artefact that carries it — `F04`, `F06`,
`F11`, `D09`, `D33`, `D35`, `D38`, `R01`, `R31`, `H18`, `H20`, `H24` from the two SQL batteries, `D-12`,
`Z-02`, `P-01`, `P-07`, `S-11`, `R-11`, `G-06`, `N-04` from the HTTP suite — before the sentence quoting
it was written. `B60` and `B50`–`B52` are §6's. One citation was drafted wrong and removed before commit:
`commerce_packages_retired_pair_check` had been quoted as the reason the catalogue is empty, and it is the
reason a retired row's timestamp agrees with its status, which is a different claim.

## 13. Commit ledger and read-backs

| commit | what it carries | read-back |
| --- | --- | --- |
| `3a14f63` → `8615034` | HTTP battery, census extension, the empty-catalogue refusal, refund-under-its-own-id, host DTO/UI, the tier counts | `q10-logs/push-census*.txt`, `push-truthsync*.txt` |
| `7a2eeb6` | the `client-side-checkout-affordance` rule in the checker and the copy | — |
| `3071462` | driver reports the database's own refusal sentence | `q10-logs/push-driver-lsremote.txt`, `push-driver-gh.txt` (that pair is the `4a8950d` era capture kept as the instrument's history) |
| `b81c441` | the browser tier, 893 lines | `q10-logs/s10-readback-b81c441-lsremote.txt` and `s10-readback-b81c441-gh.txt`, both `b81c441d969f…`, equal to local HEAD |
| the §12 truth sync + this file | one docs-only slice, `1f3cf3e` — 7 files, 494 insertions: the six tracked files whose status sentences Stage 10 falsified, plus this evidence record | branch-only push (`b81c441..1f3cf3e`, `push_exit_code=0`); read back with both instruments and captured in `q10-logs/s10-readback-s10docs-lsremote.txt` and `s10-readback-s10docs-gh.txt`, both `1f3cf3e09f21…` and equal to local HEAD. A commit's own hash is not knowable while it is being written, which is why the row says "`1f3cf3e`" only now, over the read-back logs |

`git ls-remote` plus `gh api …/git/ref/heads/stage10/commerce-entitlements` are the two instruments; the
local `origin/stage10/commerce-entitlements` tracking ref is not, because this clone's fetch refspec is
pinned to one branch.

## 14. Open findings — what a later pass must not read as covered

Each of these is a measured absence, not a style opinion. None of them blocks the ledger; several block a
claim.

1. **No cascade or deletion-of-wedding test exists for money history.** The threat row in §13 of the
   design note says so, and `N04`/`Z08` do not close it: nothing deletes a *wedding* and reads the money
   rows back. The `NO ACTION` to weddings is a DDL fact, unexercised.
2. **No concurrent publish-gate race test.** The gate's mid-transaction re-derivation is proven by
   changing the policy and re-asking (`G03`/`G04`/`G12`/`G13`/`G16b`), not by racing two writers.
3. **§4.2's rule-4 partial refund answers `amount_mismatch` and records no refund row.** A real partial
   refund is therefore not modelled end to end.
4. **Idempotency poisoning:** a first delivery that is refused for amount or environment leaves an
   `applied=false` row that the second, correct delivery cannot overwrite (`D-06`, `D-16`, `H34..H40`).
   Whether the right answer is "hold and reconcile" or "replace the refusal" is a design question Stage 10
   did not quietly settle — but no tier exercises a corrected re-delivery.
5. **Under-revocation if `revoke` ships `codes = {}`** — the empty list refuses publish (`G-02`) but the
   revocation path's vocabulary for the same shape is untested.
6. **A nested revoke aborts a delivery** (`R-06`), **the newest refund overrides an older one** (`R-11`),
   and a **tie-break between two refunds can hide a revoked entitlement**. All three are reachable in the
   SQL tier; none is reachable in the browser tier, which is why §6's `B61`/`B70` say what they say and no
   more.
7. **`price_available = false` does not suppress a quoted amount** in the DTO when an order row already
   carries one — the wire shape is right (`B50`), the projection rule is untested for the mixed case.
8. **`reject_client_delete` whitelists `service_role` and `supabase_admin`.** Correct for a server path,
   and it means "no client may delete" is true of *browser* roles only; `N-01..N-04` measure exactly that.
9. **`commerce_orders.wedding_id` is `NO ACTION`,** so an account erasure against a wedding with a
   purchase fails rather than deleting money history. Stage 13's retention decision owns this.
10. **`service_role` holds no `USAGE` on `api`** yet keeps full DML and RLS bypass on `private` — so the
    published wrapper is unreachable to it and the service key's commerce answers come from PostgREST
    routing refusals (`N-03`), not from grants.
11. **Razorpay dispute vocabulary** (`R-04`): the closed `kind` list models Cashfree's chargeback shape
    and Razorpay's *documented* dispute events; a provider term the fixtures did not name arrives as an
    unknown and holds.
12. **Provider order/payment refs are globally `UNIQUE` per provider across the stack**, so shared-stack
    fixtures must be run-namespaced — which is why every tier here mints `s10ui-<tag>-…` refs. A real
    adapter must not assume it can reuse a reference.
13. **Three host states are unreachable from a browser tier** without rewriting the shared policy
    singleton (§7), and **the currency-symbol arm is unreachable** while `INR` is the only legal value.
14. **`stage9-output-publisher.mjs:288` carries the same dropped-`reason` defect** that `3071462` fixed
    for the commerce driver. Out of stage; recorded, not repaired here.
15. **The CLI that pushed the stack is 2.121.0 while the project pins 2.120.0.** The journal moved 26 → 27
    and the migration list matched, so the applied state is right; the version difference is undisclosed
    in any lockfile.
16. **No live webhook receiver exists.** §6 of the design note models delivery (retries, ordering,
    at-least-once) from documentation and synthetic fixtures. Nothing in this file is evidence about a
    provider's actual behaviour, and Tier 6 did not run.
17. **`docs/architecture/domain-model.md` §12 is stale in clauses Stage 10 did not own.** Its list of what
    the domain "does not do yet" said there is no guest, RSVP or approval screen and no upload path —
    made false by Stages 6 to 8, not by this one, and each stage's own audit contradicts it. This pass
    repaired only the money half of that sentence and left the rest, because rewriting three other
    stages' status from a Stage 10 pass would replace stale claims with unverified ones. **The same file's
    §8 table header** ("schema: Stage 2 + Stage 3 + Stage 4 + Stage 5 + Stage 6") was widened to
    "Stage 2 through Stage 10" for the same reason and says so in its own cell.

## 15. What did not run, and the decisions that are genuinely the owner's

Tier 6 (provider sandbox) did not run: no credentials, no provider contact, by design. No hosted target,
no CI, no deploy, no production output, no merge. `main` is untouched at `6ac1a6765…` — verified against
`git ls-remote origin` before and after this pass.

Six questions belong to the owner and are recorded as configuration with safe defaults, not as decisions
(`commerce-foundations.md` §15): provider choice; which prices become `active` and their GST/invoice
treatment; `hold_for_review` vs `revoke`; whether payment gates publishing and for which packages; where
the webhook receiver is hosted; and which legal entity takes the money. What is blocked by each is stated
there. What is *not* blocked by any of them is everything in §§3–10.

Reading any unrun line as a pass, or any red arm as a near-miss, is the claim class Stage 0 was written to
remove from this repository.
