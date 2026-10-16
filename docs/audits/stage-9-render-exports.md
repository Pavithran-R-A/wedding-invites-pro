# Stage 9 — Render and export for one immutable invitation version: what ran, and what each run measured

Branch `stage9/render-exports`. The stage opened on the merged Stage 8 baseline `d49cb948…` and closes this pass at
`932bbb50e8263f9b08a386b70bf26f61fff09726`. **41 commits** join the two (`git log --reverse --format='%h %s'
d49cb94..HEAD`, `9f1c4ad docs(stage9): render/export design contract for one immutable version` through `932bbb5
fix(stage9): verify a ready row against the digest it actually promises`); every one is listed in §20 with its
read-back. Working clone `Documents/Qoder/2026-09-24/37be0a2a/s5qual`. `main` was not modified, nothing was deployed,
no hosted Supabase project was contacted, and GitHub Actions was not used.

The evidence directory is `q9-logs/`, which lives **outside** the repository, in the working clone's parent
(`Documents/Qoder/2026-09-24/37be0a2a/q9-logs/`, 56 MiB at this writing, 431 entries). It is never committed and
never staged. Every number below is quoted from a named capture in that directory, and each was re-read from the
file rather than carried over from an earlier draft of this document — which matters here, because §17 records the
one number that this stage did publish from the wrong capture and the chain that proves it.

Append-only. A section is never edited after it is committed; a wrong statement is corrected by a later section that
names it. The same rule covers the `q9-logs` captures: a superseded capture stands unmodified, and the file that
retires it says so (`gate-s96-raster-run9.txt` is still 118 assertions; §11 and §17 both explain why it is no longer
the number to quote).

## 1. Scope, taken from the repository rather than from this stage's ambition

`docs/architecture/decisions/0004-canonical-invitation-multiple-outputs.md` — "One canonical invitation, many
outputs", Accepted at Stage 1 — is the constraint this stage renders against: one invitation document model, and
every output a *derived artefact* of it. That is why there is no second schema here, why the manifest references
`version_id` rather than holding its own copy of any content, and why an output's `render_config_hash` names the
three source files whose bytes produced it (§7).

The substrate was read before anything was designed, as the directive required: the canonical invitation schema and
its frozen-version DTO, `docs/architecture/render-contract.md`, the design tokens and the six pinned invitation
families, ADR 0004, and the Stage 5/6 render qualification (`scripts/stage4-render-qualification.mjs`, whose checks
this stage re-runs as a regression in §16). The V1 scope for this stage is four output kinds — Open Graph preview,
shareable image, PDF, QR plate — from one immutable version.

What the stage deliberately does **not** own, and does not claim: a hosted deployment, a public preview bucket, a
consent mechanism, a crawler-facing OG endpoint, print ordering, or any payment surface. The buckets stay private;
`docs/architecture/render-outputs.md` §8 names the hosting seams and this branch never touches them.

## 2. The design pass, and the threat model that came before the code

`docs/superpowers/specs/2026-10-13-stage9-render-exports-design.md` (**661 lines**, committed as `9f1c4ad`, the
stage's first commit) holds the design and the threat model. It states the measured substrate it stands on (§2 of
that file), compares three approaches and picks one (§3), then fixes the dataflow from an immutable version to every
output (§4), the output catalogue (§5), the typography and Indic-correctness rules (§6), the manifest and its
functions (§7), the two storage security domains (§8), the QR lifecycle and the refusal list (§9), the Open Graph
contract and its honest status (§10), the worker's security posture (§11), failure/retry/cleanup/invalidation (§12),
the reproducibility contract in three levels (§13), and local versus production (§14). The architecture document that
the product reads is `docs/architecture/render-outputs.md` (**288 lines**), kept in sync in `a35d4f9`, `5a64f81` and
§17 below.

Two rulings in it are worth restating because they cost something and were not taken for convenience. First, the
render tier draws its own QR squares instead of calling the encoder's canvas renderer, because that renderer computes
a fractional module size and §6 of this stage's contract refuses one. Second, the Open Graph row is written as
`PARTIAL (local contract only)` in the readiness matrix and stays there: no host in this pass ever answered a real
crawler (§18).

## 3. Typography substrate, and the gate that keeps it a substrate

Indic text is the reason this stage cannot trust a CDN. `fe539ea feat(stage9): serve the six invitation families from
this origin, pinned and hashed` self-hosts the faces; `596d89a` retires the font-host allowset from all six browser
instruments so a reintroduced remote fetch cannot pass a stale rule; `5bb27f1` stops a fresh checkout from re-writing
bytes the font manifest signed (`.gitattributes`, proven in `q9-logs/s93-clean-checkout-bytes-before.txt` and
`eol-checkout-proof.txt`).

The gate is `scripts/check-render-assets.mjs`, run as `npm run render:check`. At this head
(`q9-logs/gate-s98e-rendercheck.txt`, verbatim): `src/pages/EditProject.tsx`: **6** family names, all shipped;
`src/index.css`: **11** family names, all shipped; `fonts.googleapis.com` and `fonts.gstatic.com`: **0** references
in product-facing text and **5** in test fixtures only (`src/render/renderRequest.test.ts`), never bundled;
**6** families, **72** faces, **983 KiB** of committed font bytes. `scripts/renderAssets.test.mjs` carries the **28**
tests over that manifest (§15).

## 4. The harness document, and the proof that a real Chromium used it

`render.html` plus the `src/render/` subtree is the render entry: one document, a version DTO and a surface name in,
pixels out. `scripts/stage9-render-worker.mjs` (**1,271** lines) drives it over raw CDP against a pinned Chromium, in
its own browser profile, with byte ceilings and bounds applied before a file is written.

The isolation proof at head `9d08b9f` is `q9-logs/gate-9d08b9f-chromium-proof.txt`, and it is the instrument this
stage was most careful about, because a render tier that silently reached the internet would be a privacy defect
carried by every artefact. Its closing lines: `PASS zero non-loopback hosts completed a request`; `PASS none of the
CSP probes got a response`; `PASS every completed request was to the app origin — 127.0.0.1:4173`; `PASS no
credential header on any request`; `PASS the self-hosted faces were used by the harness`; `PASS no source-path asset
was fetched (production bundle only)`; `chrome profile removed true`; and the control server's own record of the whole
run — `[{"url":"/q9-from-harness.png","referer":null}]`, which is the referrer rule measured rather than asserted.
`PROOF PASSED — 0 problem(s)`.

## 5. The QR encoder: measured before it was chosen, guarded before it was used

`q9-logs/s9-qr-dependency-measurements.txt` records the choice against measurements taken in scratch trees outside
the repository, installed with `--ignore-scripts` so no package lifecycle hook ran. `qrcode@1.5.4`: **29** packages,
**2,486 KiB**, four declared lifecycle scripts in the tree (`get-caller-file` prepare, `pngjs` prepublish, `qrcode`
prepublish, `yargs` prepare). `qr-creator`: **1** package, **149 KiB**. Bundler-reachable graph: `qr-creator`'s only
ESM entry is **1** file / **12,073** bytes with no externals; the `qrcode` browser entry reaches **35** files /
**84,275** bytes with externals `dijkstrajs` and `pngjs`. The encoder was chosen over the smaller closure anyway, and
the reason is recorded rather than apologised for: the caller must be able to ask how dense the matrix came out.
Only `qrcode/lib/core/qrcode.js` is imported, at 16 px per millimetre, so 25/40/60 mm are whole-number canvases of
400/640/960 px, and an address that will not fit a plate is a refusal `plate-too-dense` rather than a smaller QR.

The destination rule lives in `src/render/qrTarget.ts` (**124** lines) as an allow-shape guard: `https` only, a
public host only, and `/g/` and `/r/` refused **before** the token shape is considered — a guest door and a relative's
review door are not things a printed plate may open. The refusal is measured, not merely written: the raster tier
calls the worker with a household door, a family-review door, a clear-text target, an unknown variant, a query string
and a non-invitation path, and asserts that each refusal wrote **no** file (`every-plate-refusal-wrote-no-file`).

Reachability is now a rule, not a sentence: `qr-encoder-imported-outside-its-owner` is the 32nd entry in the product
contract checker and fires on any `from`/`import(`/`require(` of the encoder package outside `src/render/qrPlate.ts`
(§15 for the count, `scripts/check-product-contract.mjs:452-475` for why the exemption is one file and not a
directory).

## 6. Geometry: every box, ladder step and drop rule in one file

`src/render/outputGeometry.ts` (**358** lines) owns the export boxes, the fit ladder, the share pagination ceiling
(`MAX_SHARE_PAGES`, ceiling 4) and the paper contract; `0dff590` put them in one file and `038d095` fixed the defect
that found them there — a transition still holding on the export canvas. `src/test/outputGeometry.test.ts` carries
**43** tests (§15). The rules that this file makes measurable, and that the raster tier scores against produced bytes
rather than against a record: the teaser is **1200×630**, the share sheet **1080×2160**, a document too tall for one
sheet becomes a numbered set (`page 1 of 2`) instead of a crop, an over-ceiling document is refused by name, and
byte ceilings are per kind.

## 7. The migration, the manifest and the two buckets

`supabase/migrations/20261013120000_stage9_render_outputs.sql` (**655** lines, `f36619a`) creates `public.invitation_outputs`,
its two buckets (`invitation-outputs`, `invitation-previews`), the object-key minting trigger, the client-write and
client-delete guards, the update/delete guards, the `set_updated_at` trigger, the `owners_read_own_invitation_outputs`
SELECT policy (the table's only `authenticated` policy) and the two read functions. It was applied forward to the
local stack with `supabase db push` behind a dry run (`q9-logs/s9-dbpush-dryrun-01.txt`, then `s9-dbpush-01.txt`
ending `Finished supabase db push.`); no reset, no hosted target.

The chain's own shape is printed by the inspection probes: `q9-logs/s9-chain-01.txt` and `s9-chain-02.txt` show
`OUTPUT_POLICIES=public.invitation_outputs owners_read_own_invitation_outputs [SELECT -> authenticated]` and the five
or six output triggers by name — the two captures differ in exactly one listed trigger (`invitation_outputs_set_updated_at`
versus the shared `set_updated_at`), which is why both are kept rather than the tidier one.

## 8. The catalogue tripwires and the api-surface census

Stage 2's catalogue tripwires refuse a table or function that the census has not been told about, so a new surface
must be *declared* to pass. This stage widened them in five narrow commits — `56544d7` (Stage 2), `a08d361` (Stage 3
publication census), `187e284` (regenerated database types), `52c4c06` (Stage 4→7 censuses), `39ac307` (the domain
census the render table moved) — and the HTTP-side counterparts in `ac3da11`. `954629b` then repaired two
storage-policy censuses that had been measuring every bucket under a Stage 6 label, which is a defect this stage
introduced by adding buckets rather than one it inherited silently.

The measured census, printed inside `q9-logs/s9-run-render-01.txt`: `API_NAMES=21`, `INTERNAL_NAMES=32`,
`PUBLIC_TABLES=20`, `STORAGE_BUCKETS=3: invitation-outputs, invitation-previews, wedding-assets`.
`q9-logs/s9-census-derive-01.txt` adds the privilege shape per function — for every one of the api-surface wrappers,
`wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true
no_service_role_on_either=true` — plus the eleven unpaired `internal_api` maintenance functions and the three
argument-free api functions (`resolve_family_review`, `resolve_guest_invitation`, `resolve_public_invitation`), which
is the door-credential rule from Stages 3/7/8 still holding after Stage 9 added two reads.

## 9. The SQL tier: four chain modes, all green

`supabase/tests/stage9/run.sh` (**351** lines) with `80_render_manifest.sql` (**1,749** lines) and
`90_render_functions.sql` (**1,336** lines), committed as `8d95224`. Four modes were run on the disposable chain
(`vivaahvarnam-s9probe`, plain Postgres + role/auth shim + storage-schema fixture):

| capture | what it ran | totals |
|---|---|---|
| `q9-logs/s9-run-render-01.txt` | Stage 9's own pair, alone on the chain | **126** and **94** assertions, 0 FAILED |
| `q9-logs/s9-run-guest-01.txt` | Stage 8's pair, at the Stage 9 head | **182** and **185**, 0 FAILED |
| `q9-logs/s9-run-family-01.txt` | Stage 7's pair, at the Stage 9 head | **255** and **116**, 0 FAILED |
| `q9-logs/s9-run-historic-01.txt` | twelve older suites on two chains (24 summary lines) | **464**, **103**, **43**/**76**, **46**/**49**, **284**, **428**, **57**, **122**, **50**, **124**, **91**, **80** — 0 FAILED |

Why Stage 9's pair ran on a chain that ran nothing else is stated by the runner itself and repeated here because it
bounds every number above: the batteries' closing census counts manifest rows and bucket ids cluster-wide. The
older suites ran on chains that had not been given Stage 9's output rows. And the runner's own boundary paragraph,
verbatim from the captures: "plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase Auth and
the Storage API were not executing, and nothing was rendered — no image, no PDF, no QR payload and no byte comparison
is carried by these numbers." One disclosure this pass makes about its own evidence: these four captures record
per-suite `PASSED (n)` totals and contain no `FAILED` line, but they do not carry an appended `runner_exit=` line, so
their exit status is not re-derivable from the file alone; the HTTP captures (§10) do print theirs.

## 10. The HTTP tier, and what it does not contain

`q9-logs/s9-http-run-03.txt`: eight suites over the live `localvivaahvarnam` stack through Kong/PostgREST —
stage3_publication **38**, stage3_security **56**, stage4_tradition_packs **28**, stage5_admin_cli **36**,
stage5_pack_driven_http **28**, stage6_storage **34**, stage7_family_approval **61**, stage8_guest_rsvp **56** =
**337** tests, `fail 0` in every suite, `RESULT: PASS`, `api runner exit=0`. The residue censuses after the Stage 6,
7 and 8 teardowns returned to baseline.

**There is no Stage 9 HTTP file.** `supabase/tests/api/` carries no `stage9_publish.test.mjs`. The publish path was
therefore exercised at the two ends that exist — the SQL lifecycle in §9 and the real publisher plus an independent
byte verifier in §13 — and the middle (upload → registry → signed download → verified bytes *as an HTTP battery*, with
the second-owner and anonymous refusals on the wire) is on the unexecuted list in §18 rather than claimed here.

## 11. The raster output tier, and the nine runs that made it honest

`scripts/stage9-render-raster.mjs` (**1,561** lines) renders a synthetic approved version over the production bundle
and scores the *produced bytes*: PNG IHDR, WebP box, PDF MediaBox, byte ceilings, the fit ladder's own measurements,
pagination counts, every QR refusal, the credential sweep over its own report and records, and the level-3
reproducibility checks (a second process drawing the same artefact to the same bytes). It needs loopback Chromium and
`vite preview` only — no Docker.

Its history is the record of a tier learning to be non-vacuous, and the finding counts are as informative as the
passes:

| capture | findings | result |
|---|---|---|
| `gate-s96-raster-run1.txt` | 14 | type scaled before a line was lost (`24px → 22px`, dropped four blocks), `worker-error` and `paginate` where a single sheet was expected, six `render-timeout` QR refusals |
| `gate-s96-raster-run2.txt` | 5 (`5 FINDING(S)`) | the two teaser rules, `share-mid-ok — paginate`, `no-referrer-left-the-harness`, `artefacts-exist — 7 in the first directory` |
| `gate-s96-raster-run3.txt` | 2 (`2 FINDING(S)`) | the teaser lead rule, the referrer rule |
| `gate-s96-raster-run4.txt` | 0 | **116 assertions, 22 render records, 37 measured rows** |
| `gate-s96-raster-run5..9.txt` | 0 | **118 / 22 / 37** each |
| `raster-pdf-run1.txt` | 2 | the PDF cases' first run |
| `raster-pdf-run2.txt` | 0 | **256 / 37 / 49** |
| `raster-pagination-run1.txt` | 7 (`6 FINDING(S)` + header) | `share-two/three/four-pages-measurement-wrote-no-file`, `share-three-pages-needed-exactly-that-many-pages — 4 page(s) of 2160 px for 5606.34 px`, `share-over-ceiling-refuses-by-name — {"ok":false,"reason":"unbreakable-content","height":11815.78}` |
| `raster-pagination-run2.txt` | 0 | **324 / 44 / 63** |
| `raster-pagination-run3.txt` | 0 | **325 / 45 / 63** |
| `gate-s99-raster-run1.txt` | 0 | **325 / 45 / 63**, `raster_exit=0`, re-run at this head `932bbb5` on a rebuilt `dist` (`preview-server-s99.txt`) |

The credential rule is visible in the first table: run 1 printed two findings whose names *were* the tier's own random
credential, redacted in the capture as `<credential>` by the masking sweep — an early proof that the sweep had to run
over finding names as well as bodies, which it now does
(`report-lines-carry-no-credential — 36784 byte(s)`, `record-bodies-carry-no-credential — 45 record(s), 122033
byte(s)`, `every-assertion-kept-its-name — 324 named assertion(s)` in `gate-s99-raster-run1.txt`).

One cross-run measurement taken for this document, because reproducibility claims should be checked across time and
not only inside one process: comparing `gate-s99-raster-run1`'s artefact directory against
`raster-pagination-run3`'s, all nine PNG/WebP raster artefacts hash identically across the two runs (19 files; the
four-page share set and both teaser boxes included), while `pdf_a4_p1.pdf`, `pdf_letter_p1.pdf` and the three QR
plates differ — the PDFs for the reason §12 measures, the plates because the tier mints a fresh random credential per
run, which is by design. The tier's report and records files necessarily differ, since each carries its own scratch
directory name.

## 12. The PDF: read back as bytes, and the reproducibility ruling it forced

`799bdb9` recorded the paper contract as measured and pinned it without a browser; `877db41` added the reader that
parses a produced sheet; `54db046` qualified the produced sheet from its own bytes. `scripts/pdfStructure.test.mjs`
carries **23** tests, and `q9-logs/pdf-reader-proof.txt` closes with `differences: 0` over the delivered A4 sheet: no
`/ID` array, tagged, link targets restricted to the public map, normalised length preserved, still readable after
normalisation.

`fd3c6c0 fix(stage9): pin the three files render_config_hash digests against CRLF checkout` is an EOL defect found by
a real checkout, and `q9-logs/pin-crlf-check.txt` shows the pin's shape: `lf → {"ok":true,"major":155}`,
`crlf → {"ok":true,"major":155}`, `crlf-trailing-spaces → {"ok":true,"major":155}`,
`absent → {"ok":false,"reason":"pin-line-missing"}` — a config whose line endings move still hashes to the same
contract, and a config that lost the pin line refuses.

The reproducibility limit was found on the live stack, not in a unit test. Publisher run 2 printed
`REFUSAL ready-object-differs-readback-digest-mismatch name=pdf_a4_p1.pdf`; the cause was measured in
`q9-logs/live/pdf-stamp-finding.md`: Chromium's print-to-PDF stamps `/CreationDate` and `/ModDate`, so run 2's sheet
differs from run 1's by two byte runs of five bytes each, at offsets **249..253** and **284..288**, same length, same
structure, same MediaBox, while all seven raster and plate draws reproduced byte-for-byte. Treating the fresh draw as
the reference would refuse a correctly delivered PDF forever; ignoring the difference would hide a renderer that
stopped being pure. The ruling, in `932bbb5`: for a row that already claims `ready`, the promise under test is **the
row's own `content_digest`** — the digest a host's signed download is served against and the one the SQL lifecycle
guards — and a non-reproducing draw is named separately as `ready-object-not-reproduced-by-this-draw`. Nothing about
the blocking half loosened: mime, ceiling, IHDR, WebP box and MediaBox are still measured over the served bytes.

## 13. The publisher on the live stack: register → upload → read back → verify → `ready`

`scripts/stage9-output-publisher.mjs` (**923** lines) over `scripts/stage9-publish-core.mjs` (**515** lines),
committed as `d366106`. It is a trusted local maintenance process: it is the only place that holds a service-role key,
a database session and the browser's bytes at once. It reads its own local key file (`.env.local`) through its own
parser, refuses any `supabase.co`/`supabase.io` Storage target by name, requires the loopback assertion on the API
origin, takes the QR target from an environment variable named by the operator rather than a default, and builds a
redactor over the service key, the publishable key and the target before anything can be logged. `--yes` gates every
Storage write (`guardStorageWrites`); the same command without it draws and reports and writes nothing.

The lifecycle order is the one the readiness row claims: register the row, take the object key **the database
minted**, upload, read the object back, verify mime / ceiling / IHDR / WebP box / MediaBox / digest against the served
bytes, and only then transition to `ready`. A `ready` row is the last thing that happens, never the first.

Measured runs, all against `localvivaahvarnam` for one immutable version `90ab1108-0017-4f25-a570-49c5c15f310a`
(wedding `6cb1c41b…`, `version_dto_digest aeaa8fcc7437…`, API origin `http://127.0.0.1:54400`, render origin
`http://127.0.0.1:4173`):

- **Dry run** (`live/dryrun-1.txt`, 2026-10-15 14:14:44Z): `summary: 0 artefact(s) delivered, 0 blocking
  finding(s)` against a baseline census of `invitation_outputs=0`, `objects(invitation-outputs)=0`
  (`live/baseline-census.txt`), with `browser closed: profileRemoved=false renders=4`. That `false` is the residue
  finding described below.
- **Run 1** (`live/publish-1.txt`, 14:18:43Z): four `REGISTERED`→`READY` pairs per artefact, `summary: 8 artefact(s)
  delivered, 0 blocking finding(s)`, `profileRemoved=true renders=4`. The run record
  (`publish-90ab1108-2026-10-15T14-18-43-199Z.json`) carries each row's digest, `render_config_hash` and
  `qr_target_digest` (`5aa7d5ca147a…`) — the address itself appears in no record, and the plate's target was supplied
  through `STAGE9_QR_TARGET`.
- **Run 2** (`live/publish-2.txt`, 15:05:27Z): the same manifest re-published with nothing changed produced
  **7 `VERIFIED-IN-PLACE`** and **1 REFUSAL** (the PDF), `summary: 7 artefact(s) delivered, 1 blocking finding(s)` —
  the defect §12 rules on, found by the second run rather than by a theory.
- **Run 3** (`live/publish-3.txt`): the Docker engine went down; the capture is one line, the `npipe` connection
  error. Recorded because a tier that reports nothing on a blocked run is a tier nobody can audit.
- **Run 4** (`live/publish-4.txt`, 2026-10-16 05:56:05Z, at head `932bbb5`, after §12's repair): **8
  `VERIFIED-IN-PLACE`**, the PDF's line carrying `draw-not-reproduced` beside it, `summary: 8 artefact(s) delivered,
  0 blocking finding(s)`, `publisher_exit=0`. Its record shows every artefact's action as `verify` and every finding's
  level as `note`; the PDF row carries both `row_digest feb48bf1…` and `draw_digest 18c17b0b…` under
  `ready-object-not-reproduced-by-this-draw`, and then `ready-object-verified`.

No-write proof for run 4, taken as data rather than as a claim: the manifest snapshot in run 1's record and the one in
run 4's record were compared row by row on `id, status, content_digest, ready_at, created_at, attempt_count,
render_config_hash, page_number` — **8 rows, 0 changed, 0 added, 0 vanished, every digest equal**, and the QR plate
reproduced (it draws from the fixed target the operator passed, unlike the raster tier's per-run credential).

The independent verifier, which exists because the publisher grading its own homework is not evidence,
`live/verify-bytes.mjs` → `live/verify-bytes.txt`: it re-read the manifest with fresh `psql`, minted its own 60-second
signed URLs and re-hashed every download. **21/21**: `manifest-read 8 rows read back`; per-object bytes for all eight
(`28574B`, `19184B`, `248927B`, `225092B`, `192370B`, `167712B`, `24970B`, `3549B`, each `status=200` with its format
mime and a digest); `all-objects-hash-to-their-row-digest 8/8`; `all-objects-served-their-format-mime 8/8`;
`raster-box/og_image 1200x630`, `raster-box/share_image 1080x2160`; `pdf-structure/a4-mediabox
head=%PDF- mediabox=[0 0 595.91998 841.91998]`; `qr-square-and-scannable-size 640x640`; the three refusals
`anon-cannot-read-an-authenticated-path status=400`, `private-bucket-refuses-the-public-path status=400`,
`signed-url-serves-the-bytes-without-a-bearer status=200`; and `no-service-key-in-log-or-record` plus
`no-guest-address-in-log-or-record`. **This is what a host's download path does locally. It is not a hosted
behaviour** — the same 60-second signed URL, a second account and an anonymous visitor have never been exercised over
HTTP as a battery (§10, §18).

Failure and recovery handling is unit-qualified rather than live-qualified, and named as such:
`stage9-publish-core.test.mjs` and `stage9-output-publisher.test.mjs` carry the cases `records exactly one attempt per
failure and stops at the ceiling`, `retries a failed row, and only its own attempt count moves`, `refuses to retry
past the ceiling and uploads nothing`, `names an object its own refusal left behind, and still records the failure`,
`sorts the stale occupants of the slot by what may legally be done to each`, `removes the stale object, marks the
stale row superseded, then publishes`, `leaves a stale ready row ready when its object would not go away`, `keeps a
failed stale row and only takes its object`, and `names an orphan it cannot take and marks nothing`. A crash between
upload and UPDATE therefore lands on the `registered`/`uploading` path those cases describe; the crash was not
simulated against a live database.

**The teardown finding, in full, because it is the same defect class twice.** The dry run logged
`profileRemoved=false` with no reason, and `q9-logs/live/../` (the temp directory) still held
`stage5-chrome-iusF4i`, 611 K, whose host-mtime 19:44 is that run's 14:14:44Z record line. Root cause was an
observability gap, not a second deletion bug: the publisher had exactly one close site, and it printed
`profileRemoved` and `renders` while dropping the `reason` and `profilePath` the driver supplies (§17 for the harness
fix `858dae4`, which is the same class in the driver). The log line now carries both. *Why* that particular `rm`
refused is **not recorded anywhere** — the pre-repair line could not carry it — and this document states that rather
than inferring it. Run 4's line, with the repair in place: `browser closed: profileRemoved=true renders=4
profile=C:\Users\PAVITH~1\AppData\Local\Temp\stage5-chrome-7KSesq`, and that profile is gone from disk (verified
after the run).

## 14. The bundle boundary: §9.4's claim measured on emitted chunks

`scripts/check-bundle-boundary.mjs`, committed as `16956a3`, reads `dist/assets/*.js` after a production build and
asserts the reachability claims the design makes. `q9-logs/bundle-boundary-16956a3.txt` and
`bundle-boundary-39ac307-v2.txt` print the same line at both heads: PublicInvitation **6** chunks on opening (6
counting its own lazy imports, 5 files in its preload list), GuestDoor **10** (10, 9), the host route loaded by
`index-wlplAEws.js` with **14** preload files and **0** plate or encoder chunks on opening, `ShareQrPlate-Dyqb4Is_.js`
reached only through `assets/EditProject-Buq1itL9.js`, **38** chunks / **169** import edges / **1018 KiB**, encoder
chunk `qrTarget-DFYbP69i.js`, and `render.html eager: render-CW8pl4ox.js, index-CHY8huk…` — the render entry is where
the encoder is allowed to live, and neither guest bundle reaches it. `Bundle boundary OK`.

## 15. Unit batteries and the node gates at this head

`q9-logs/gate-s98e-test.txt` (Vitest, ANSI-stripped, this head): **Test Files 58 passed (58)**, **Tests 1236 passed
(1236)**. The Stage 9 files and their per-file counts, read off that capture: `outputGeometry.test.ts` 43,
`renderRequest.test.ts` 54, `ogMetadata.test.ts` 30, `qrPlate.test.ts` 15, `qrTarget.test.ts` 14, `QrCanvas.test.tsx`
10, `invitationOutputs.test.ts` 47, `invitationOutputsTransport.test.ts` 15, `invitationOutputsPanel.test.tsx` 18,
`invitationRenderer.test.tsx` 35, `invitationRenderSurfaces.test.tsx` 9, `shareQrPlate.test.tsx` 13,
`renderAssets.test.mjs` 28, `pdfStructure.test.mjs` 23, `stage9-output-publisher.test.mjs` **78**,
`stage9-publish-core.test.mjs` **51**.

The rest of the gate family at `932bbb5`: `npm run lint` → `✖ 9 problems (0 errors, 9 warnings)`, all nine the
`react-refresh/only-export-components` class (`gate-s98e-lint.txt`); `npm run typecheck` → clean, no output
(`gate-s98e-typecheck.txt`); `npm run product:check` → `Product contract OK — 249 active file(s) scanned,
0 violation(s)` (`gate-s98e-productcheck.txt`); `--self-test` → `Product contract self-test OK — 32 rule(s) verified`
(`gate-s98e-selftest.txt`, the only place the rule count is printed); `render:check` as in §3. A second, clean-tree
test run agrees: `gate-s98e-test-clean.txt` prints the same 58 files / 1236 tests.

## 16. Historical regressions at this head

Nine browser/qualification instruments from earlier stages, re-run against this stage's bundle. Every one reports
`findings: 0` except the pair named below:

| capture | instrument | result |
|---|---|---|
| `s9-regression-stage4-render-01.txt` | Stage 4/5 render qualification | checks **144**, measurements **31**, findings **0** |
| `s9-regression-stage5-journeys-01.txt` / `-02` | Stage 5 host journeys (two runs) | checks **89**, measurements **12**, findings **0** |
| `s9-regression-stage5-a11y-01.txt` | Stage 5 accessibility | checks **63**, measurements **50**, findings **0** |
| `s9-regression-stage5-network-01.txt` | Stage 5 network/privacy | checks **105**, measurements **67**, findings **1** |
| `s9-regression-stage5-network-02.txt` | same, after the harness fix | checks **105**, measurements **67**, findings **0** |
| `s9-regression-stage6-assets-01.txt` | Stage 6 assets | checks **138**, measurements **21**, findings **0** |
| `s9-regression-stage7-review-01.txt` | Stage 7 review | checks **104**, measurements **18**, findings **0** |
| `s9-regression-stage8-guest-01.txt` | Stage 8 guest | checks **133**, measurements **25**, findings **0** |

The one non-zero is not a guest, an RSVP or a privacy leak: `network-01` closed with `[cleanup] the browser profile
that held the host session was deleted by the driver — still present at
C:\Users\PAVITH~1\AppData\Local\Temp\stage5-chrome-aZQXVE`. That is the harness defect `858dae4` fixed (delete the
profile *before* reporting it deleted), and `network-02` is the same 105 checks with the finding gone. It is also the
same defect class §13's log-line repair extends — which is why this audit records the publisher's version of it
instead of treating the harness fix as the end of the story.

## 17. Defects found, and the proof that each instrument could see them

**Product defects** found by executing rather than by reading: a transition still holding on the export canvas
(fixed in `038d095`); the teaser fit ladder shrinking type before losing a line (found by raster runs 1–3, fixed by
the ladder rules now scored in §11); a share document silently cropped instead of paginated (`913f60c`); the harness
naming itself in the stylesheet request, which a `Referrer-Policy` measurement then had to settle (`35d390f`, and
`referrer-controls-measured.txt`); a produced PDF whose only non-reproducible part is Chromium's two date stamps
(ruled on in §12, `932bbb5`); the `render_config_hash` pin moving under a CRLF checkout (`fd3c6c0`); two storage
censuses labelling every bucket as Stage 6's (`954629b`).

**Instrument defects** found in this stage's own tools: raster runs 1–3 and the two later first-runs (`raster-pdf-run1`
2 findings, `raster-pagination-run1` 7) were largely the tier discovering that its own cases were not measuring what
they claimed — `-wrote-no-file` and `-measurement-wrote-no-file` are the tier refusing to pass on a missing
measurement; the `render-timeout` cluster in run 1 was the tier's own timeout, not the worker's refusal rule. The
publisher's teardown line dropped the driver's `reason` and `profilePath` (§13). And the driver itself reported a
profile deleted before deleting it (`858dae4`).

**Sensitivity**, i.e. each instrument seen to fail. Three mutation captures bound the §12 repair:
`q9-logs/mutation/pre-fix-red.txt` prints `Tests 3 failed | 4 passed | 71 skipped (78)` with the three named failures
`refuses an object that is not the bytes the row promises, and changes nothing`, `refuses a ready row whose recorded
digest is not the object in the bucket, even when this run draws that object`, and
`verifies a stamped draw against the row digest and names the difference instead of hiding it` — the cases written
before the fix. `mutation/post-fix-green.txt` is **misnamed and is recorded as what it prints**, not as its filename
claims: `Tests 2 failed | 5 passed | 71 skipped (78)`, failing
`verifies a ready row in place and writes nothing at all` and the stamped-draw case. It is an intermediate capture
taken 33 seconds after the red one; the certified green state is `mutation/teardown-log-run1.txt`
(`78` + `51` = **129 passed**) and the whole-tree `gate-s98e-test.txt` (**1236**). Two earlier mutations bound the
publisher's blocking half rather than its §12 half: `mutation/mutB-verification.txt` `4 failed | 72 passed (76)` and
`mutation/mutC-merge-removed.txt` `8 failed | 68 passed (76)`, with `mutation/restored-green.txt` printing
**76 passed** between them at 76 tests — the file grew to 78 tests with §12's three new cases, which is why the two
eras print different totals for the same filename.

No assertion was weakened to obtain any number in this document, and no gate configuration was changed to make a run
pass.

## 18. What did not run

Stated as a list rather than implied by an absence:

1. **The host's own screen in a browser.** `InvitationOutputsPanel.tsx` has never been clicked through by a real host
   session at this head: no listed row, no button press, no downloaded file observed through the UI. Its contract is
   qualified by 18 panel tests + 47 store tests + 15 transport tests (§15) and by §13's verifier, which mints the same
   signed URLs from outside the app.
2. **A second wedding's owner and an anonymous visitor refused *on the wire*.** The SQL policies refuse them
   (`owners_read_own_invitation_outputs` is the only SELECT policy; §9's battery carries the cross-wedding refusals and
   a `42501` against re-parenting), and §13 measures the Storage-side refusals (`status=400` twice, from the
   verifier's own requests). There is no HTTP battery case for either refusal, and no browser run.
3. **The elapsed 60 seconds.** `OUTPUT_LINK_SECONDS` is measured as the minted link's shape, as in Stage 6; a
   deliberately-expired link was never requested.
4. **The Stage 9 HTTP tier** — `supabase/tests/api/stage9_publish.test.mjs` does not exist (§10). Upload, retry,
   revocation and stale-supersession are therefore qualified at the SQL layer, at the unit layer and by one live
   publisher run, not through Kong as a battery.
5. **A crash or a partial upload against a live database.** The recovery branches are unit-qualified by the named
   cases in §13; no process was killed mid-upload on the stack.
6. **Real hosted Open Graph.** No crawler fetched anything; `scripts/og-serving-adapter.mjs` is a loopback stand-in
   (§11 of the design file, `render-outputs.md` §8). The OG row stays `PARTIAL (local contract only)`.
7. **QR rotation seen by a human.** `ShareQrPlate.tsx` draws the plate at publish and rotate in the host's browser and
   is qualified by 13 tests; the journey that watches the plate change when the host rotates was not run.
8. **Screen readers and a WCAG measurement over the outputs panel and the render harness.** The Stage 5 accessibility
   instrument passes (§16) and covers the surfaces it names; it does not know about `InvitationOutputsPanel`.
9. **Mobile rendering of the *downloaded* artefacts.** The bytes carry fixed boxes (1200×630, 1080×2160, 40 mm plate,
   A4/Letter sheet) measured in §11 and §13; how a given chat app presents them was not observed.
10. **GitHub Actions, a hosted deployment and any hosted Supabase project.** Not used, by instruction.

## 19. Residue, cleanup and headroom

- **On the local stack, by this stage's design:** 8 `ready` rows in `public.invitation_outputs` and 8 objects in
  `invitation-outputs`, re-read as `ready 8` / `objects=8` after run 4 (`census_exit=0`). They are the delivered
  artefacts of one synthetic version and are this task's own residue; retiring them is a scoped DELETE of that
  version's rows and objects, not a reset, and it has not yet been done.
- **Containers:** `vivaahvarnam-s9probe` — the disposable chain §9 ran on — exists as `Exited (0) 19 hours ago` and
  is this task's to retire. Nothing belonging to another project was touched: the `*_dueweave` containers are all in
  the state this pass found them (`Exited`, 9 days) and `p3c-rest-v16` likewise. Starting the Docker engine is a
  human-only action and happened once during this stage, between run 3 and run 4.
- **Browser profiles:** `stage5-chrome-7KSesq` was deleted by run 4's own teardown (§13). One residue stands:
  `C:\Users\PAVITH~1\AppData\Local\Temp\stage5-chrome-iusF4i`, 611 K, created by the pre-repair dry run. It is
  recorded, not silently removed, and its cause is §13's unresolved `rm` refusal.
- **Foreign temp entries left alone:** `chrome_chrome_url_fetcher_23596_1052932256`,
  `chromium_chrome_BITS_20420_783576470`, `chromium_chrome_BITS_6520_605867243` — not created by this task.
- **Evidence:** `q9-logs/` 56 MiB / 431 entries, outside the repository, uncommitted by design. The raster tier's own
  scratch directories (`s9-raster-*`, 15 of them) and the OG tier's (`s9-og-*`) stay with it for the same reason.
- **Headroom:** `df -B1 /mnt/c` at this writing reports **5,799,628,800 bytes free** on a 510,088,515,584-byte volume
  (≈5.4 GiB). No build was started without checking it; the heavy items this head needed were one `npm run build`
  (which produced the `dist` §13's run 4 and §11's run 1 both rendered against) and one Chromium per tier.

## 20. Commit ledger and read-backs

The 41 commits between the Stage 8 baseline `d49cb94` and `932bbb5`, in order (`git log --reverse --format='%h %ad %s'
--date=format:%H:%M`, host-local times):

`9f1c4ad` design contract · `fe539ea` six families self-hosted · `596d89a` font-host allowset retired from the
browser instruments · `5a64f81` four documents synced · `0a86e89` CDN needle sweep scored by fetchability ·
`5bb27f1` fresh checkout cannot re-write signed font bytes · `9d08b9f` the render harness · `94da725` QR refuses every
door but the invitation's · `1525025` the printed plate, whole-pixel modules · `0840ba1` the encoder reachable only
from the render entry · `267abe1` the Open Graph contract derived and served · `9204949` the OG row reported as
partial · `0dff590` one geometry file · `038d095` transitions held on the export canvas · `35d390f` the harness stops
naming itself · `f5b8aea` the worker given the driver's CDP doors · `a35d4f9` substrate, digests and bounds recorded ·
`c3a62a7` draw in Chromium, refuse before drawing a wrong one · `609c94a` bytes qualified against real Chromium ·
`799bdb9` the paper contract measured and pinned · `fd3c6c0` the CRLF pin · `877db41` read a produced PDF back ·
`54db046` the sheet qualified from its own bytes · `913f60c` paginate a too-tall share document · `ae21e0d` serve
each case's own rendered `og_image` · `f36619a` the manifest, its two buckets, its two reads · `56544d7` Stage 2
tripwires widened · `a08d361` Stage 3 census widened · `187e284` database types regenerated · `52c4c06` Stage 4→7
censuses widened · `098c083` the runner that reaches the stage9 head on either chain · `22e892b` the HTTP runner
counts the manifest and both buckets · `ac3da11` three HTTP tripwires widened · `954629b` two storage censuses
repaired · `8d95224` the two render batteries · `b80c3d9` the host's file list, the scannable plate, the reprint
sentences · `39ac307` the domain census the render table moved · `16956a3` the bundle boundary measured on emitted
chunks · `858dae4` the harness deletes before reporting · `d366106` the trusted publisher · `932bbb5` verify a ready
row against the digest it promises.

Read-backs taken from captures: `q9-logs/readback-877db41.txt` prints
`877db41418bb3735e99e2bfa0fd19db193aceeec refs/heads/stage9/render-exports` and
`readback-877db41-gh.txt` the same SHA through `gh api`; `gh-readback-fd3c6c0.txt` prints
`fd3c6c060094a99587ae55dd5dfc2e26c003d1ce`; `s9-push-readback-01.txt` prints
`954629bcea3107f75671046bb4dc954967cb399c` as both the remote ref and the commit queried through the API. Every push
was to `stage9/render-exports` with the branch refspec, and every remote read-back used `git ls-remote` or `gh api`
rather than a stale `origin/<branch>` tracking ref.

## 21. The tree that ships this file, and the two claims that did not survive being asked for a capture

§20's ledger stops at `932bbb5`, and §19's headroom reading stops there too. Both are superseded by
measurement rather than by narration, and this section is where that happens; the sections above it
stand unmodified.

**Two commits joined between `932bbb5` and the tree these gates ran on.** `11e6ffc` carries the
publisher's teardown-log repair described in §13's last paragraph — the `finally` block used to drop
`reason` and `profilePath`, so a failed profile removal reported `profileRemoved=false` with nothing
beside it and the next run had no fact to root-cause. `1fc10fe` is the document sync: README's
"no product surface yet" list still named QR and export, the render-outputs §7 still said nothing in
this stage uploads a byte, and the matrix's image row still published the superseded 118-assertion
raster total. The commit that carries this file follows and is not predicted here; `git log` names it.

**Two claims failed when asked for their own capture, and both were repaired before committing.**

* The README said "a clean clone prints **247**". Nothing had ever run a clone: the number was the
  arithmetic of 211 + 36. `q9-logs/s9-tracked-scope.mjs` now derives it without a clone and without a
  re-implementation of the scoping rules — it feeds `git ls-tree -r --name-only <head>` through the
  checker's own exported `isScannedPath` and prints the list beside the count. Its captures:
  `s9-tracked-scope-11e6ffc.txt` — `tracked_total=424`, `tracked_in_scope=247`, out-of-scope reasons
  listed (72 `.woff2`, 52 `.sql`, 28 under `scripts/`, 11 `.sh`, 9 under `docs/audits/`, one `.env`,
  `.gitattributes`, `.gitignore`, `.ico`, `.toml`); `s9-tracked-scope-d49cb94.txt` — `tracked_total=297`,
  `tracked_in_scope=211`. So 247 is measured, and the §19 claim that the audit document itself adds
  nothing to the count is now visible in the out-of-scope list rather than asserted.
* The README attributed both file counts to `gate-s98e-productcheck.txt` and `gate-s98e-selftest.txt`.
  The second prints a rule count, not a file count, and the first has no clone number in it. The line
  now cites `q9-logs/gate-s99-productcheck-final.txt` for 249 and the two scope captures for 247/211.
  While fixing it the delta was derived too — `s9-tracked-delta-d49cb94-11e6ffc.txt` splits the 127
  tracked additions between `d49cb94` and here as **36 in scope / 91 out**, the 91 by reason
  (72 + 14 + 3 + 1 + 1), which confirms §15's "(14 additions)" under `scripts/` and the claim that
  `.gitattributes` is one of the invisible ones; `s9-tracked-deletions.txt` reads `deletions_total=0
  deletions_in_scope=0`, so "zero removals" is no longer a bare assertion.

**The node gates re-ran on the shipping tree, in this order, each with its own capture.**
`gate-s99-productcheck-final.txt` → `Product contract OK — 249 active file(s) scanned, 0 violation(s)`,
`productcheck_exit=0`; `gate-s99-selftest-final.txt` → `self-test OK — 32 rule(s) verified`,
`selftest_exit=0`; `gate-s99-rendercheck-final.txt` → `6` family names in `EditProject.tsx` and `11` in
`index.css`, all shipped, `0` product-facing CDN references, `5` fixture-only references in
`src/render/renderRequest.test.ts`, `6` families / `72` faces / `983 KiB` — the same sentences §3
publishes; `gate-s99-lint-final.txt` → `✖ 9 problems (0 errors, 9 warnings)`, `lint_exit=0`;
`gate-s99-typecheck-final.txt` → no output, `typecheck_exit=0`; `gate-s99-test-final.txt` →
`Test Files 58 passed (58)` / `Tests 1236 passed (1236)` / `test_exit=0`, in which the three files the
host's file panel is qualified by re-print §15's counts exactly: `invitationOutputs.test.ts` 47,
`invitationOutputsTransport.test.ts` 15, `invitationOutputsPanel.test.tsx` 18. `product:check` ran a
second time after the document edits — `gate-s99-productcheck-final2.txt`, 249 files, 0 violations,
exit 0 — because three of the 32 rules reach into `docs/product/`, so a `.md` edit is a gate input, not
a comment. The raster tier re-ran at this tree in §11's closing paragraph
(`gate-s99-raster-run1.txt`, 325 assertions / 45 records / 63 measured rows, `raster_exit=0`).

**What was deliberately not re-run, and why that is a claim rather than an omission.** The SQL, HTTP and
browser tiers in §9–§10 and §16 ran against code that `11e6ffc` does not change in any way they can
observe: the only shipped edit is a log line in a `finally` block of a maintenance script that none of
those tiers imports. Re-running them would move their captures, not their conclusions, and §19's
residue census would have to be re-taken to match. This is the same reasoning Stage 7's closure applied
to a docs-only head: the tier inputs changed, so the changed input is what gets certified.

**The publisher re-run that the log repair made observable.** `q9-logs/live/publish-4.txt` ran on this
tree against the live `localvivaahvarnam` stack: `VERIFIED-IN-PLACE` ×8, the PDF line reading
`pdf_a4_p1.pdf … draw-not-reproduced`, `summary: 8 artefact(s) delivered, 0 blocking finding(s)`,
`publisher_exit=0`, and — the fact §13's repair exists to produce —
`browser closed: profileRemoved=true renders=4 profile=…stage5-chrome-7KSesq`. Its manifest snapshot
diffs against run 1's across `id,status,content_digest,ready_at,created_at,attempt_count,
render_config_hash,page_number`: 8 rows, **0 changed**, which is what §13 promised a repeat run would do
and is now measured rather than reasoned.

**§18's list is unchanged by this section**, and the two entries that would close it are still open
work rather than claims: the host's own screen driven by a real session in a browser (the panel, its
signed download, a second account and an anonymous visitor refused on the wire), and a Stage 9 HTTP
battery — `supabase/tests/api/` still has no file that names these outputs, so the row in §10 stands.

**Headroom, measured at the moment the last gate finished.**
`q9-logs/s9-headroom-final.txt` (`utc=2026-10-16T06:21:09Z`): `bytes_free=2441064448`, `use_pct=100%` on
`C:`. §19 recorded 5,799,628,800 bytes free at `932bbb5`, and this segment has watched the number fall
through ~5.56 GB and ~2.92 GB to ~2.44 GB without this task writing anything comparable — `q9-logs` is
56 MiB across 447 entries and the scratch browser profile named above is 611 K. The consumption is
outside this repository. No npm install, build, or Docker work was attempted at this reading, and none
should be until headroom is re-measured; my own container `vivaahvarnam-s9probe` is `Exited (0)` with a
16.4 kB writable layer, so retiring it buys nothing and is left for the cleanup pass rather than
pretending to be a mitigation. Nothing belonging to `dueweave` was touched.
