# VivaahVarnam — Digital Wedding Patrika

**Status: Preview.** VivaahVarnam is an early, development-stage product. One loop is complete and was
exercised end to end — a host signs up, creates a wedding, adds the people, venues and ceremonies,
edits the invitation's words and styling, freezes an immutable version, publishes it as a single link,
revises it into a second version and republishes, rotates and revokes the link, and a visitor with no
account opens that link on a phone — **against a real local Supabase stack** (Kong, PostgREST, GoTrue,
PostgreSQL 17.6) driven from a browser. Nothing is deployed and no hosted project was used, so no claim
here is that a customer can do this on a live site today. **Guest households and RSVP are a later case:**
that surface is written, unit-tested and qualified at the SQL layer on this branch, and it has never been
exercised over HTTP or driven in a browser, so it is listed under *Implemented foundations* below rather
than under the loop that was exercised. Payment and printing do not exist in any form.

**Brand status: preliminary working brand — not legally cleared.** The name may change before
launch. Nothing in this repository should be read as a trademark claim, and no trademark search
has been completed.

VivaahVarnam is a digital *patrika*: an invitation built to be read and accepted by a whole
family, in the language the family actually uses, on the phone where it will actually be shared.

## Purpose

Indian wedding invitations are designed for print and then squeezed into chat apps. VivaahVarnam
starts from the opposite assumption — the invitation is a living, readable document that a couple
and their relatives review together on mobile, in their own language, before anything is sent.

The product priority order is deliberate:

1. Emotional quality of the invitation itself
2. Family acceptance (a parent must be able to read and approve it)
3. Regional-language correctness
4. Guest mobile and WhatsApp experience
5. Low-friction creation
6. Trustworthy publication and payment
7. Premium human services

## Verified in Stage 1

Behaviour actually exercised in this stage, without depending on an external environment we do not
control:

- Public landing, privacy, terms and cookie pages render, and describe this build honestly
- The sign-up and log-in screens render with labelled fields and autocomplete values
- Protected routes redirect to the sign-in screen while unauthenticated
- The brand lockup, design tokens, script-safe font stacks and the South-Indian language list
- The SVG sanitisation boundary and its unit tests
- The SQL row-level-security regression harness (24 assertions, Docker `postgres:16-alpine`),
  including the trusted-column write guards on `paid_status`
- The product-contract checker, and the local gates: lint, typecheck, unit tests, production build
- Public pages laid out down to a 360px viewport

## Verified in Stage 2

The database layer, exercised against throwaway local Postgres containers only:

- The canonical domain is created by nine forward migrations — no published migration was edited —
  and both chains apply cleanly on `postgres:16-alpine` (PostgreSQL 16.15) and on the Supabase local
  image (`supabase/postgres:17.6.1.171`, PostgreSQL 17.6)
- 41 assertions that a fresh chain invents nothing (right tables, all empty, no fabricated account,
  profile or role row) and 75 that the legacy chain carries what it should without inventing an
  entitlement from a historical paid claim
- 322 privilege / row-level-security attacks, run against both chains, starting at the grant layer so
  an unreachable permissive policy cannot be scored as safety, and 75 assertions that the live
  catalogue matches the documented table, foreign-key, CHECK, trigger and grant inventory
- The retirement of the scaffold into `legacy`, closed to every API role including `service_role`,
  with the rows intact
- The data adapter the screens now use, and the database-contract checker, under unit tests
- The public and unauthenticated screens again in a browser afterwards: `/`, sign-in, sign-up, the
  three policy pages, and the protected-route redirect

Every number in the three sections above is that stage's own measurement, printed in its audit. The
totals at this branch's head — and the movement between them, suite by suite — are in
[`docs/product/feature-readiness.md`](docs/product/feature-readiness.md) and
[`docs/audits/stage-5-pack-driven-authoring-review.md`](docs/audits/stage-5-pack-driven-authoring-review.md);
the older documents are not rewritten when a count moves.

## Verified in Stage 5

The review-binding and pack-driven-authoring work, exercised against throwaway local databases, this
repository's **local** Supabase stack and a browser on the production bundle — no hosted project, and
still no customer-visible pack content:

- One forward migration. Its only column is `tradition_pack_releases.review_packet_hash`, a 64-hex
  digest checked by the database, so an approval is bound to the exact bytes that were reviewed
  instead of to a claim beside them. No table, no policy and no client-visible column was added
- **122** review-binding assertions, **50** definition-vocabulary assertions and **124**
  document-resolution assertions, run on both migration chains (`bash supabase/tests/stage5/run.sh`),
  each with the positive control beside the refusal — rewriting one character of Tamil wording moves
  the digest, and reformatting the same JSON does not
- The digest is computed in Postgres with core `sha256` and `encode`, **not** pgcrypto, so the
  guarantee does not depend on an extension being installed; the maintenance CLI renders the packet
  and computes nothing
- **220 HTTP tests** across six files with real JWTs, including that none of `internal_api`'s nineteen
  functions is reachable from a browser at all (the requested name never resolves in the exposed
  profile, so the answer is `404` rather than a permission error that would confirm existence). That is
  the six-file census this section was written against, and it is kept as written; at the Stage 7 head
  the same six files plus `stage7_family_approval.test.mjs` measure **281** (`38 + 56 + 28 + 36 + 28 + 34
  + 61`, each file's own total printed apart, `q7-logs/s7-http-runsh-03.log`), and `internal_api` carries
  **24** bodies with the same not-reachable property — the Stage 7 runner prints
  `DECLARED_HEAD=stage7 / API_NAMES=13 / INTERNAL_NAMES=24` in its own captures
- A maintenance CLI, `node scripts/tradition-pack-admin.mjs`: eleven verbs, deliberately not a web
  panel, no `delete` verb, and it refuses `--linked`, `--project-ref`, a hosted URL and any mutating
  command that has not been given `--yes`. The only identity that can reach the surface it drives is
  the local owner role — **this is not a host feature and there is no customer path to it**
- Three browser journeys on the production build: a host writing every word with **no pack** chosen,
  a host choosing a **synthetic approved release** through the panel, and a **retirement** walk where a
  live guest link points at a release that is later deprecated — the published document moved exactly
  once, when the host chose the newer release and froze and published a new version to the same address
- The 10-shape × 4-viewport render sweep re-run at this head (143 checks, 33 measurements, 0 findings),
  an accessibility and mobile pass over the host editor (59 checks, 48 measurements, 0 findings), and a
  network and privacy recheck over nine surfaces — which reaches two third-party origins
  (`fonts.googleapis.com`, `fonts.gstatic.com`) by design, so the honest description is a classified
  network surface, not "zero network"
- What is **not** demonstrated, and it is the most important line in this section: **every `reviewed`
  and `approved` release this stage exercised is a synthetic `TEST ONLY` fixture.** Those synthetic
  reviewed fixtures are qualification data, not cultural authority. The Tamil/English candidate is
  still draft, `machine_assisted = true`, `human_reviewed = false` and not selectable by a customer,
  and no review of it by a named human reader has happened
  ([`docs/content-review/tamil-english-foundation-v1.md`](docs/content-review/tamil-english-foundation-v1.md)).
  A host choosing no pack and writing every word is still the only path a real family can take

## Verified in Stage 4

The tradition-pack mechanism, exercised against throwaway local databases and the **local** Supabase
stack only — no hosted project, and no customer-visible pack content:

- 18 forward migrations apply in order on both chains, with 42 / 76 outcome assertions, 46 / 49
  draft-invariant, 284 publication-boundary, 464 privilege and RLS attacks and 103 catalogue
  assertions per chain
- Stage 4's own document battery — **426 assertions per chain**, plus **57** for its fixture tooling,
  printed separately so no stage's total is read as another's — pins the release lifecycle: content
  freezes when a release leaves draft, the lifecycle only moves forward, a release that has left
  draft cannot be deleted, and the definition vocabulary is refused key by key rather than by
  convention
- **28 HTTP tests** against the running local stack with real JWTs, covering what a signed-in host may
  read (seven columns of the release table; the reviewer's identity, stated qualification and
  machine-assistance notes are ungrantable, not merely hidden) and what a selection may name: every
  release that is not approved is refused with the same sentence, whether it is a draft, a reviewed,
  a deprecated, another pack's retired release or a uuid that does not exist
- The freeze-time path from a chosen release to the guest's document, re-qualified on the
  **production bundle** served to a headless browser: the two-document comparison (no pack versus a
  synthetic approved pack), the retire-after-freeze walk, every network destination the bundle
  reaches, and a 10-shape × 4-viewport render sweep — 143 checks, 33 measurements, 0 findings
- Six new `product:check` rules that fail the build if application code ever branches on a pack key,
  infers a tradition from a name or a community, gates a rite on a language, claims ceremonial
  authority, or presents the unreviewed draft candidate as shippable — each with a self-test and the
  near-miss controls beside it
- What is **not** demonstrated, and the most important line in this section: no reviewed customer
  content exists. The only approved releases in any database are the batteries' own rows, each marked
  `TEST ONLY`, and the Tamil/English candidate that `content/tradition-packs/` carries is draft,
  machine-assisted and `human_reviewed: false`
  ([`docs/content-review/tamil-english-foundation-v1.md`](docs/content-review/tamil-english-foundation-v1.md)).
  A host choosing no pack and writing every word is still the only path a real family can take

## Verified in Stage 6: private files, measured at the SQL, HTTP, unit and browser tiers

Stage 6 gave a host's own uploaded files a home, and every tier that can measure one has now run at the
state that carries this code — **including a browser**. The local Docker engine died mid-stage and the
recovery, the blocked set and its closure are recorded in
[`docs/audits/stage-6-storage-assets.md`](docs/audits/stage-6-storage-assets.md) §18 → §§36–37; the numbers
below are re-takes at head, each with the capture it came from. What is measured, and where:

- One forward migration (`20261006120000_stage6_wedding_asset_storage.sql`) turns Storage on for one
  bucket: `wedding-assets`, private, 5 MiB per object, and `allowed_mime_types` of `image/jpeg`,
  `image/png`, `image/webp`, `audio/mpeg` — no SVG, HTML or PDF is accepted, so no markup-bearing file
  can ever reach a renderer from this path
- The object key is **minted by the database** as `weddings/<wedding-id>/<kind>/<row-id>` in a BEFORE
  trigger; a client that presents a key is refused `403 / 42501` rather than having it ignored, and the
  registry's lifecycle is `staged → ready → tombstoned`, so a row that points at bytes no longer there
  is visible as exactly that
- Three `storage.objects` policies, for `authenticated` only, and **no UPDATE policy at all** — which
  is why an upload cannot be `upsert`ed over somebody else's object
- **Two Stage 6 SQL batteries, 90 and 80 assertions**, on both migration chains, re-run alongside the
  historical suites against a schema that now contains Stage 6: 42/76 outcome, 46/49 draft invariant, 284
  publication-boundary, 464 privilege and RLS attacks, 103 catalogue, 428 + 57 pack documents and
  tooling, and 122 / 50 / 124 review-binding, vocabulary and document-resolution —
  `q6-logs/s6-sql-chain-05.log` on **2026-10-07**, `sql_chain_exit_code=0`. Every total labelled "at
  Stage 6 head" there is a re-measurement of an older suite, not a carried-forward figure, and the two
  runners' totals are never added to each other
- **220 HTTP tests / 0 fail across six files** against the running local stack
  (`q6-logs/s6-api-run-04.log`, 2026-10-07), of which `supabase/tests/api/stage6_storage.test.mjs` is
  **34 tests / 6 suites**: real tokens, real bytes, real refusals, and a teardown that *prints*
  `wedding_assets total=0` and `objects in the bucket=0` from the database instead of asserting it
  cleaned up after itself. Three of its forecasts were reversed by measurement — an unauthenticated
  download is `400 NoSuchKey`, not 401; a second write to an existing key is `400` code `409`, not an
  overwrite; and a DELETE that RLS refuses answers `200 []` (§15) — so every refusal in it is re-read
  with a following `SELECT` rather than inferred from a status code
- `supabase/tests/api/run.sh` now counts **both** stores an HTTP run can dirty silently
  (`public.wedding_assets` and `storage.objects` in this bucket) beside the three it already checked
- One Stage 3 case was proven wrong by Stage 6 and repaired, not relaxed: it hand-supplied an
  `object_key`, and because BEFORE triggers run before an RLS `WITH CHECK` is consulted, it had begun
  to assert the mint guard while claiming to assert isolation (§16). It then went back into the serial
  chain: **56 pass / 0 fail** for that file inside `s6-api-run-04.log` above, with the repaired case —
  "a child row cannot be attached to another account's wedding via `wedding_assets`" — named in the
  passing list rather than inferred from a total
- **32 unit tests over the adapter itself** (`src/test/weddingAssetUploadRules.test.ts`, no engine
  needed, inside a 566-test / 36-file suite at this head; Stage 6 measured 31 inside 473 / 32, and the
  one added test is `65fb4f0`'s repair, which asserts the file's head is read once per upload): every
  refusal the tab reaches for on its own is asserted
  *together with* "nothing was asked of the stack", the register payload is shown to carry no
  `object_key` in any shape, the write is shown to ask for `upsert: false`, and the §5.3 orderings —
  register/upload/confirm, and tombstone/collect/delete — are pinned including both rollbacks. Four
  deliberate mutations of the adapter (a widened MIME set, a `>=` ceiling, an `upsert: true` — §20.6 —
  and `contentRefusal` returning `null`, §36) each broke the case that should notice, so this suite is
  not passing by ignoring the code
- **The browser tier ran, and it is what moved this row from `FOUNDATION` to `IMPLEMENTED` (local stack
  only).** `scripts/stage6-browser-assets.mjs` drives the **production bundle** on `127.0.0.1:4173`
  against this repository's own stack, and `q6-logs/s6-browser-run-03.log` prints
  **138 checks / 23 measurements / 0 findings**: a real file through the panel's own picker; the key the
  database minted read back and matched; the bytes behind a signed preview link verified to be the bytes
  uploaded; audio drawn as `<audio controls>`; replace and remove leaving no orphan object; a second
  account refused at the page, the REST read, the direct object read, the signed-URL mint and the row
  insert while the owner's own read still succeeded; the N1–N4 network and privacy checks (origins,
  credentials, no public-path read, and the minted token found nowhere but one media `src`); the
  accessibility re-measurement at 375×740 and 768×1024; and a teardown that left `0` accounts, `0` rows
  and `0` objects. Its strongest line is the one the unit tier could only assert about decisions: each of
  the five upload refusals — including **markup behind an `image/png` declaration** and **a JPEG head
  behind one** — is proved by the request count *not moving at all*

And the four things this section must not be read as granting. **Local stack only**: no hosted Supabase
project, production bucket or real family file was touched, and the 60-second preview expiry is measured
as the shape of a minted link, never as an elapsed-time observation. **No crash-path browser evidence**:
a `staged` row orphaned between register and upload, retries and interrupted `PUT`s are pinned in unit
tests against a stand-in, not driven over a failing network. **One checker coverage gap, recorded rather
than repaired**: `canonical-table-read-outside-the-adapter` still does not name `wedding_assets`
(§37.10), so it guards the adapter convention for nine of the ten tables product code touches directly —
today the gap covers nothing, because all five of that table's `.from()` calls are in the adapter. **And
no guest is affected by any of it**: Stage 6 ships host-private upload and management only, preview is
through a short-lived signed URL, and the published snapshot still asserts no `object_key` (§7, and B28 in
the Stage 3 battery). Stage 6 is committed and pushed to `stage6/storage-assets` with the remote SHA read
back after every push; the tiers above ran at `5c8215c`, and the head carrying this prose is certified by
its own re-take of the gate set — logged in the audit's evidence captures, never asserted here from a
parent's green run.

## Verified in Stage 7: a relative reads the invitation and answers, on a phone, with no account

Stage 7 built the family approval and review workflow the product's own priority list has ranked second
since Stage 1 ("a parent must be able to read and approve it"), and every tier that can measure one has now
run against the local stack — SQL, HTTP, unit and browser. The evidence is
[`docs/audits/stage-7-family-approval.md`](docs/audits/stage-7-family-approval.md) and the boundary it
implements is stated in
[`docs/architecture/family-approval-review-security.md`](docs/architecture/family-approval-review-security.md).
What is measured, and where:

- **One forward migration, no new table and no new column**
  (`20261008120000_stage7_family_approval_review.sql`, 931 lines in eleven sections). It adds five
  `internal_api` bodies and five thin `SECURITY INVOKER` `api` wrappers, and redefines
  `create_invitation_version` so that invariant I-12 — a successor version closes the predecessor's open
  asks — is enforced at the one place a successor becomes true. The host queue, the reviewer's projection,
  the answer and the withdrawal all read tables that already existed
- **Nothing a browser role can reach is a table.** Re-read on the live stack at this head, not assumed:
  **45** `public` policies over **19** tables, unchanged; **13** `api` functions and **24** `internal_api`;
  no new table privilege for `anon` or `authenticated`. The whole Stage 7 surface is RPCs, and the
  reviewer's door is **zero-argument** — `api.resolve_family_review()` reads its credential from
  `request.headers` — so there is no query string, at no layer, for a token to be put in
- **Two SQL batteries, 255 and 116 assertions**, on a throwaway `postgres:16-alpine`, on a runner built for
  them because `80_family_review.sql`'s closing census counts cluster-wide. The twelve historical suites were
  re-measured at `DECLARED_HEAD=stage7` on both chains and moved nowhere: 42/76 outcome, 46/49 draft
  invariant, 284 publication boundary, 464 privilege/RLS attacks, 103 catalogue, 428 pack documents, 57
  fixture tooling, 122 review binding, 50 authoring vocabulary, 124 document resolution, 90 asset registry,
  80 storage policies
- **61 HTTP tests in Stage 7's own file, 281 across the seven**, `0 failed, 0 skipped`, against the real
  local stack, bracketed by a ten-table census at 0 rows before and after — including `approval_requests`,
  `approval_feedback`, `access_tokens` and `storage.objects(wedding-assets)`. Expired, revoked, forged,
  malformed, wrong-kind, cross-version, answered-twice and cross-wedding credentials are each refused, and
  every closed refusal is the same shape on the wire (`{"available": false}`, HTTP 200) so an invalid link
  cannot be distinguished from an unknown one
- **The two defects the batteries found, in the migration rather than in a probe**: a JSON `null` decision
  walked past a `IF NOT p_decision IN (…)` guard because `NOT NULL` is `NULL`, so an anonymous caller got a
  constraint code instead of the product's sentence (D-S7-01); and the host queue joined every credential
  row, so a withdrawn-and-reissued ask printed twice (D-S7-02)
- **91 unit tests across four files**, including the transport module that transcribes the six submission
  refusal sentences from what the HTTP tier actually measured rather than from the migration, and folds any
  message this build has not read into one generic sentence
- **A browser tier: checks 104, measurements 18, findings 0, exit 0** (tag `s7ui-muzpa0r1-kvklf`,
  six driver runs to get there, five of them with a stdout capture, and §13 names what each failure was and
  which run left only an evidence log). A host signs up and asks through the panel;
  the link is shown once and is not handed back on reload; a phone-sized context **with no session** opens
  `/r/:token`, answers, gets a receipt naming the version it is pinned to, and is refused on revisit; the
  host reads the note back exactly as typed; the frozen snapshot is measured **byte-identical** across the
  whole exchange (`eae1334a6960…` before and after). A stranger holding a live link is still let in — the
  link *is* the credential, and that is stated as a limit, not a feature
- **A raw review token appears in no record, log, committed file or capture.** Only a SHA-256 digest is
  stored; the runner pipes every byte a SQL suite prints through a masking filter, and the masking sweep at
  the end of the browser tier reports `6 credential(s) registered, 5 appeared in what this run tried to
  print, 5 write(s) were rewritten, 0 escaped` — the sixth is journey B's deliberately forged string, which
  this tier never prints, and the gap is disclosed rather than smoothed
- **Cultural-authority review stayed where it was**, by name, by mirror and by row count (group C). The aunt
  at `/r/:token` is not a Tamil reviewer, and Stage 7 declined that promotion on purpose

Four things this section must not be read as granting. **Local stack only** — no hosted Supabase project was
contacted, nothing is deployed, and Stage 7 is not merged. **No verified identity** — `reviewer_display_name`
is the host's words about a person and `author_label` is that person's words about themselves; the product
records a trace and refuses to claim more, and there is no reviewer login because the credential, not an
account, is the authority. **No link delivery** — there is no email, SMS or push; the host copies an address
and the product cannot see the hop, which is also why the credential survives in the reviewer's browser
history and in any hosting access log, a residue no meta tag reaches. **And no photographs at the reviewer's
door** — the projection is the guest's own DTO, which never carried an `object_key` (K, K13), so Stage 6's
private-asset boundary is intact rather than re-litigated; a guest *replying* is still Stage 8, and retention
is still Stage 13.

One inherited gap closed while here, because this stage is the one that had to read the boundary honestly:
`canonical-table-read-outside-the-adapter` now names `wedding_assets` (commit `0571191`, with a self-test
fixture) and both approval tables, so the sentence above about "nine of the ten tables" and the Stage 6
section's §37.10 record are both closed at this head — see the Stage 7 audit §16.

## Implemented foundations requiring a configured backend

Real code paths that compile and ship in this build. Stage 3 exercised the host-to-guest loop
through the product's own screens against a **local** Supabase stack (see
[`docs/audits/stage-3-public-invitation.md`](docs/audits/stage-3-public-invitation.md)); what has
**not** been demonstrated for any of them is a deployed, hosted project:

- Sign-up, log-in, logout and password reset against a Supabase Auth project — the sign-up and
  sign-in round trip was driven from the browser on the local stack; email delivery and the
  confirmation click were not (that stack auto-confirms), and reset has never been exercised end to end.
  Stage 5 repaired the sign-up screen's own copy: it asserted an email was on its way whatever the
  server had actually returned, and it now branches on the session the response carries — when there is
  no session it says `Check your email to confirm your account`, when there is one it says that nothing
  was emailed and this stack confirms accounts without email. Both arms are pinned by
  `src/test/signupNotificationTruth.test.tsx`, and both host accounts of the Stage 5 browser journey
  assert the rendered sentence in the page itself (`scripts/stage5-ui-journeys.mjs`, the
  `sign-up copy matches the local stack's no-confirmation behaviour` check), so the copy is measured
  on the production bundle and not only in a unit test
- A **My invitations** dashboard that reads the signed-in user's drafts
- Draft creation: name, main language, optional design direction, inserted into `public.weddings`
  through the data adapter
- A draft configuration page that stores an *estimated guest count* (planning only — there is no
  checkout, so it affects nothing commercial)
- The workbench editor: the four prose passages, the styling of the paper (font, size, colour,
  alignment and a **simulated** foil overlay), and the people, venues and ceremonies as rows
- A "Tradition & wording" panel that lists the approved releases a host may choose, offers "No
  tradition pack" as a first-class choice, and writes exactly one column of the host's own wedding.
  It shows no reviewer identity, qualification or machine-assistance note — those columns are not
  grantable to a browser role — and nothing is ever inferred from a name, a community, a language or
  a location. **On a real database the list is empty**, because no reviewed customer content exists
  yet, so what a host sees today is the no-pack state. Stage 5 walked both halves of this in a browser
  against the production bundle: journey A completes a wedding with the panel left on "No tradition
  pack", journey B points a real wedding at a synthetic approved release by clicking it. When the
  release a wedding points at has been retired, the editor says so in the host's own terms, holds the
  freeze button disabled, and a `create_invitation_version` issued directly as that host is refused
  `403` and creates no version — the newer release is then offered as an explicit choice, and the only
  extra words it carries are the UI's own
- Freeze-time resolution: when a version is frozen, the chosen release's wording (or the host's own,
  against the same default shape) is resolved by the database and stored inside the frozen snapshot
  with its provenance, so a guest's document is explained by the row it came from rather than by a
  lookup that has to succeed later
- The guest side of the product (Stage 8): `GuestInvitationPanel` (**783 lines**, mounted at
  `src/pages/EditProject.tsx:898`) for households, salutations and per-recipient ceremony scopes,
  `GuestRepliesPanel` (**377 lines**, `:902`) for the host's own manual entries beside the guest's, and
  `/g/:token` (`src/App.tsx:95`, outside `AuthProvider` and `ProtectedRoute`, shipped as its own lazy
  chunk) for the guest's door. Both transport tiers have now run on the live `localvivaahvarnam` stack,
  after its Stage 8 migration was forward-applied with `db push --local` behind a `--local --dry-run`
  that named exactly that one file. HTTP: **337** tests / **0** failures / exit 0
  (`q8-logs/s14-http-battery-all-01.log`), of which the Stage 8 suite is **56** cases — the **53**
  authored minus the one `G-01` template plus its 4 `HOST_CALLS` entries. Browser: **checks 133 /
  measurements 25 / findings 0**, twice in a row (`q8-logs/s15-browser-all-journeys-04.log`,
  `-05.log`), driving journeys A–D against the production bundle recorded as
  `071169257071e5b89cc7fea9df6cef354d81220624b51dd0f04241ce8953f116` over **38** files
  (`q8-logs/s16-dist-fingerprint-01.log`). What ran *before* those tiers was only the SQL
  qualification, at head `eb128f7`: `80_guest_invitation_links.sql` **182** and `90_guest_rsvp.sql`
  **185** assertions with `run.sh all exit=0` (`q8-logs/s9-sql-all-32.log`), on a disposable
  plain-PostgreSQL 17.10 cluster because the local stack's engine was down then. Still unproven is a
  **hosted** project: every number above is local-stack-only, and §23 of
  [`docs/audits/stage-8-guest-rsvp.md`](docs/audits/stage-8-guest-rsvp.md) records the eight
  instrument defects those two tiers found and how each was repaired. Unit coverage at the `eb128f7`
  head: 27 panel + 34 adapter-transport + 45 shape + 30 page + 22 door-transport + 31 replies, inside
  the 765-test / 42-file run (`q8-logs/s10-clean-test.log`)

No **production** Supabase environment was validated: a deployed project, its gateway configuration
and its transport security are all still unproven here. What Stage 3 did close is the layer Stages 1
and 2 could only reason about: their browser QA covered the public and unauthenticated surfaces, and
their database was measured through `psql` with `SET ROLE` — the layer PostgREST sits on, not
PostgREST's own filtering. Stage 3 runs the same schema on the platform images and drives it over
HTTP with real JWTs, so grants, policies, triggers, the token boundary and error shapes are observed
through Kong and PostgREST rather than inferred. See
[`docs/audits/stage-3-public-invitation.md`](docs/audits/stage-3-public-invitation.md) §4–§6 for what
that did and did not buy.

What deliberately does **not** exist yet is a **product surface** for
QR codes, PDF/image export, payment, GST handling, print ordering, and admin tooling. The people,
venues and ceremonies of a wedding are now edited on screen as rows, so the fixtures behind Stage 3's
host-to-guest run were entered through the product itself. Stage 2 gives several of the remaining
capabilities tables and rules; a schema is not a feature. Where the UI mentions them, it labels them
*Planned for V1*.

## Target V1

The first real release aims at one loop completed end to end:

- A couple builds a structured invitation (couple, families, events, venue, directions) instead of
  free-text fields
- One South-Indian language plus English, with wording reviewed by native speakers
- A private, reviewable link that family members can open on a phone and approve
- A trusted published state, with payment only where it buys something a guest actually receives

Anything outside that loop is staged behind V1 (see
[`docs/product/v1-scope.md`](docs/product/v1-scope.md) and
[`docs/product/feature-readiness.md`](docs/product/feature-readiness.md)).

## South India rollout

Language priority is a product decision, not an afterthought:

1. Tamil + English
2. Telugu
3. Malayalam
4. Kannada

Language is always chosen by the user. The app never infers a language, religion, caste, region or
tradition from a name or an identity, and it does not publish authoritative religious or
ceremonial wording produced by unreviewed generation.

## Product principles

- **Patrika-first**: the invitation document is the product, not a landing page around it.
- **Truthful UI**: a capability is shown only when it exists. Planned work is labelled planned.
- **Language-conscious**: script-safe font stacks and per-language review, not a translated string
  file.
- **Family-readable**: large type, high contrast, mobile-first, works in a chat-app browser.
- **No manufactured urgency**: no fake social proof, no countdown tricks, no micro-add-on
  nickel-and-diming.

## Architecture

React 18 + TypeScript single-page app, built with Vite (`@vitejs/plugin-react-swc`), routed with
React Router 7 (the `react-router-dom` compatibility package at 7.18.4 — Stage 5 closed a five-stage
deferral by taking the version both open moderate advisories are patched in, with no source file
changed; see [`docs/audits/stage-5-pack-driven-authoring-review.md`](docs/audits/stage-5-pack-driven-authoring-review.md) §24),
server state through TanStack Query, UI primitives from Radix via shadcn-style
components, styled with Tailwind CSS over HSL design tokens. Supabase provides auth, the Postgres
database and row-level security. Database-provided template SVG passes through the central DOMPurify
sanitisation boundary before DOM insertion; there is no SVG upload feature.

```text
src/App.tsx                     routes (protected project screens behind ProtectedRoute; the guest's
                                `/i/:token` and the reviewer's `/r/:token` in a second tree outside it)
src/pages/                      landing, auth, dashboard, create / configure / design-preview, review
src/components/landing/         landing sections
src/components/brand/           single brand lockup used by every header, footer and auth screen
src/components/auth/            auth provider + route guard
src/components/ui/              shadcn-style primitives
src/config/product.ts           the only place product name / descriptor / tagline / status live
src/lib/                        i18n language order, SVG sanitisation boundary, the public DTO and the
                                review document's shape
src/integrations/supabase/      client + generated database types + eight adapters (wedding, content,
                                publication, guest, pack releases, private assets, host review queue,
                                reviewer door) — the only modules that may name a table
supabase/migrations/            schema and RLS history
supabase/tests/rls/             executable RLS assertions
scripts/check-product-contract.mjs  scope-aware brand/claims checker
scripts/tradition-pack-admin.mjs    maintenance-only pack release tool (local owner role, no delete verb)
docs/product/                   canonical product contract
docs/architecture/              ADRs and the Stage 2 domain blueprint
docs/audits/                    stage audit evidence
```

Brand copy belongs in `src/config/product.ts` and `src/components/brand/BrandLockup.tsx`. Changing
the name should not require editing twelve pages.

## Security baseline

Row-level security is verified, not assumed. `supabase/tests/rls/` runs the policies against a
throwaway Postgres container and asserts the trusted-only columns (paid state, ownership,
generation metadata) cannot be written by an authenticated client. The Stage 0 findings —
including the insert-path guard that closes the paid-status escalation hole — are recorded in
[`docs/audits/stage-0-truth-security.md`](docs/audits/stage-0-truth-security.md).

No secret belongs in this repository. The app only ever reads a browser-public publishable key;
`.env` files are untracked, and CI fails on tracked env files or credential-shaped strings. Stage 6
added a second kind of secret-bearing surface — a host's own files — and it is held the same way: the
bucket is private, the object key is minted by the database rather than accepted from a client, and the
only read path the product has is a short-lived signed URL issued to the owning account. The Stage 6
HTTP battery carries the refusals around that as named cases — `MINT-02` (a key a client presents),
`UPL-02` (a stranger writing into the owner's prefix), `A7b` (a second write to a key that already has
bytes) — and each of the three is printed `✔` in `q6-logs/s6-http-iter-02.log`, taken on
**2026-10-06** with that run's `fail 0`. That chain has since been re-run inside Stage 8's full battery,
where the same three cases print `✔` again (`q8-logs/s14-http-battery-all-01.log:414, :421, :447`, inside
`stage6_storage.test.mjs` at **34** tests / **0** failures) and §34.4 records why the test file that run
executed is still this tree's file. The privileged-value sweep re-taken at `dff78c1`
(`q6-logs/s6-i10-valuescan-06.log`, taken at `dff78c1`, whose five node gates are recorded beside it in
`q6-logs/s6-head-cert-dff78c1.log`) prints
`tracked_at_HEAD_files_with_hit=0` and `added_lines_main_to_HEAD_with_hit=0` for each of the three
privileged shapes it keys on (`SUPABASE_LOCAL_SECRET_KEY`, `SUPABASE_LOCAL_SERVICE_ROLE_KEY`,
`SUPABASE_LOCAL_DB_URL`), with `src_files_with_hit=0`, `index_html_lines_with_hit=0`,
`dist_files_with_hit=0` and `q6_logs_files_with_hit=0` beside them.

## Product docs

- [`docs/product/README.md`](docs/product/README.md) — where to start
- [`docs/product/v1-scope.md`](docs/product/v1-scope.md) — what V1 is, and what it is not
- [`docs/product/invitation-semantics.md`](docs/product/invitation-semantics.md) — the patrika model
- [`docs/product/structured-creator.md`](docs/product/structured-creator.md) — the creation flow
- [`docs/product/content-governance.md`](docs/product/content-governance.md) — how tradition-pack wording becomes trustworthy
- [`docs/content-review/tamil-english-foundation-v1.md`](docs/content-review/tamil-english-foundation-v1.md) — the one drafted pack definition, reviewed by nobody, and what a reviewer would need to answer
- [`docs/architecture/decisions/0007-versioned-reviewed-tradition-pack-releases.md`](docs/architecture/decisions/0007-versioned-reviewed-tradition-pack-releases.md) — why a pack is a concept and a release is the document
- [`docs/audits/stage-5-pack-driven-authoring-review.md`](docs/audits/stage-5-pack-driven-authoring-review.md) — the review digest that binds an approval to exact bytes, the maintenance-only boundary around it, the browser journeys, and the React Router decision §24
- [`docs/audits/stage-6-storage-assets.md`](docs/audits/stage-6-storage-assets.md) — the private bucket, the database-minted key, the Storage policies, and the engine outage §§36–37 closed
- [`docs/audits/stage-7-family-approval.md`](docs/audits/stage-7-family-approval.md) — the family review workflow as eleven migration sections, two SQL batteries, 61 HTTP cases, 91 unit tests and a four-journey browser tier
- [`docs/architecture/public-invitation-security.md`](docs/architecture/public-invitation-security.md) — the guest door: what a credential-holding reader is and is not
- [`docs/architecture/family-approval-review-security.md`](docs/architecture/family-approval-review-security.md) — the reviewer door, and §11's eight limits, including the ones this build refuses to claim
- [`docs/architecture/domain-model.md`](docs/architecture/domain-model.md) — the canonical domain as the migrations actually hold it, including the sensitivity table in §9
- [`docs/product/commercial-model.md`](docs/product/commercial-model.md) — target pricing, pilot-validated, not live prices
- [`docs/product/brand-clearance.md`](docs/product/brand-clearance.md) — brand status and remaining clearance work
- [`docs/product/design-principles.md`](docs/product/design-principles.md) — visual and editorial rules
- [`docs/product/feature-readiness.md`](docs/product/feature-readiness.md) — IMPLEMENTED / FOUNDATION / PLANNED V1 / LATER / EXCLUDED
- [`docs/architecture/decisions/`](docs/architecture/decisions/) — ADRs 0001–0007
- [`docs/architecture/stage-2-domain-blueprint.md`](docs/architecture/stage-2-domain-blueprint.md) — documentation-only domain design

## Local development

npm is the canonical package manager. Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run dev
```

Environment: copy `.env.example` to `.env` and point `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` at a Supabase project you own. Never commit `.env`, never use a
service-role key in this app, and never connect an unrelated or production project for local work.

Every gate, in the order CI runs the five it runs (CI's own `security` job then does the credential
scan and `npm audit --omit=dev --audit-level=high`; the plain `npm audit` below is run locally, not in
CI, and its advisories are reported rather than blocking):

```bash
npm run lint
npm run typecheck
npm run dbtypes:check
npm run product:check
npm test
npm run build
npm audit
npm audit --omit=dev --audit-level=high
```

`npm run product:check` is the contract guard: **31 rules** over the active surfaces this tree scans
(**213 files** at this Stage 8 head, from `q8-logs/s8-productcheck6.log`; **186 files** at `8e62c38`,
from `q6-logs/s6-head-cert-8e62c38.log`; the count has moved three times
since the rule list was first written — once for the storage adapter and the host's file panel, once
for the adapter's own unit battery, and once for `8e62c38`'s panel tap-target test, which is the file
that took it from the 185 every earlier certification printed) — retired brand names, fabricated
social proof and per-guest pricing
language, the retired scaffold vocabulary, which tables may be named outside the data adapter, the
**ten** cultural-safety rules that refuse a tradition inferred from a name, a place or a language, a
pack key branched on in application code, a ceremonial authority claim, and any wording that lets
machine-assisted draft text read as though it had been reviewed, the three public-door rules that
refuse a credential passed as an RPC argument (`guest-door-called-with-arguments`,
`reviewer-door-called-with-arguments`, and Stage 8's `household-door-called-with-arguments`), and one
rule about writing HTML into
the DOM. Nothing was removed to get from 23 to 31 (`git show 8e62c38` diffs to the current list as
**+2 / −0**: `reviewer-door-called-with-arguments` in Stage 7 and `household-door-called-with-arguments` in Stage 8). Three of the five Stage 5 rules deliberately reach
into `docs/product/` and `docs/content-review/`, because this matrix is itself under the rule that
forbids calling the draft candidate shippable; the last of the three (`main-landmark-absence-claim`)
was added while assembling the Stage 5 report, after that report's own truth pass had left a stale
current-state sentence about the host editor standing — it refuses an absence claim about a page's
`main` landmark, and its positive control is the honest replacement sentence, so a future widening has
to break that sentence to pass unnoticed. Its scope now also covers `docs/architecture/`, which is
where that same claim would be repeated if anyone wrote it back; the ADR and blueprint files there
stay writable for every other rule, so a governance file that *quotes* a forbidden shape stays a
document rather than becoming a finding. `docs/audits/**` is ignored, which records historical evidence
verbatim. The markup rule (`markup-injection-sink`) is the newest, and it exists because the count
above used to carry a named blind spot: no rule looked at `innerHTML` or sanitisation, so injection was
guarded only by `src/lib/sanitizeSvg.ts` and the discipline of whoever edited the pages beside it. It
fires on the *write* shapes — `__html:`, `dangerouslySetInnerHTML={{`, `insertAdjacentHTML(`,
`.innerHTML =`, `.outerHTML =`, `document.write(` — anywhere in `src/`, and exempts exactly the three
lines registered in `AUDITED_HTML_SINKS` at the top of the checker, each of which stays exempt only
while the sanitisation its entry names is still in that same file. Reading `innerHTML` back is not a
finding, and `src/test/` is out of scope, because a test may attach markup to a detached node to prove
the sanitiser works. What the rule still cannot do, stated rather than implied: it cannot prove the
sanitiser is correct (that is `src/test/sanitizeSvg.test.ts`), it cannot tell whether a registered
boundary's witness is the right one — adding an entry is a review act, not a grep — and it does not
watch `dist/`, which is a build artifact rather than a source of decisions.

## Database testing

The RLS harness needs Docker and starts a disposable `postgres:16-alpine` container, applies the
migrations, runs the assertions and removes the container:

```bash
bash supabase/tests/rls/run.sh
```

Expected result: **24 passed / 0 failed**. If the count changes, investigate the policies and the
harness — do not edit the assertion count to make the run green.

- `bash supabase/tests/rls/run-baseline.sh` proves the pre-hardening baseline (only the two
  original migrations) still contained the exploit paths Stage 0 closes.
- `bash supabase/tests/rls/run-repro.sh` reproduces the paid-state INSERT bypass against the
  published schema; `REPAIRED=1 bash supabase/tests/rls/run-repro.sh` re-checks it with the repair
  migration applied. The probe is informational — read its notices, it never fails the script.

`bash supabase/tests/stage2/run.sh both` qualifies the whole schema on **two throwaway chains** — the
published migrations alone, and the migrations plus a synthetic legacy history — then runs the outcome,
draft-invariant, publication-boundary, attack and catalogue suites on each. It is named for the stage
that wrote it and now carries Stage 3's files too.

`bash supabase/tests/stage4/run.sh` runs Stage 4's own document battery over the same two chains
(426 lifecycle, freeze, resolution and provenance assertions per chain when it is run at the Stage 4
head it was written for; re-measured **428** at the Stage 5 head, because Stage 5's migration adds a
column that the battery counts, plus 57 for its fixture tooling) and starts its own container. Its
totals print apart from the other suites and are never added to them, which is deliberate: a runner
that folds counts makes a regression in one suite look like growth in another. Both runners are
informational about their boundary too — plain Postgres plus a role/auth shim, so REST-level behaviour
is claimed only by the HTTP suites below.

`bash supabase/tests/stage5/run.sh` runs Stage 5's three batteries over those same two chains:
**122** review-binding assertions (a status step that changes state also pins the digest, so an
approval cannot be moved onto different bytes after the fact), **50** definition-vocabulary
assertions and **124** document-resolution assertions. Each refusal is paired with a positive control
in the same run — rewriting one character of Tamil wording moves the digest and reformatting the same
JSON does not — because a green refusal line from an instrument that cannot succeed is the failure mode
this stage was built to catch.

`bash supabase/tests/stage6/run.sh` runs Stage 6's two batteries over the same two chains: **90**
registry assertions and **80** assertions on the policies attached to `storage.objects`. Their shape is
worth naming, because it is what the stage sells: a client-supplied key is refused outright rather than
normalised — five shapes, a legal-looking prefix, a traversal, an absolute path, another wedding's prefix
and an over-long key, each answered with the trigger's own `42501` (K6–K10) — and the sixth shape, a
whitespace-only claim, is measured as what it actually is: not a refusal but an absent claim, which the
minter writes over, so no client string is ever stored as a key (K11–K11c). A row cannot be born `ready`
or born `tombstoned` (K12/K13), `ready` cannot move backwards (T1), and a `ready` row whose object is
still in the bucket cannot be deleted (D1/D2) — the ordering being "bytes before row", which is how this
stage makes an orphan observable instead of letting it accumulate. Each battery also writes
`storage.objects` rows directly as a *stand-in* for bytes a service put there, and says so at the top:
neither file proves an over-size upload is refused, that `allowed_mime_types` is enforced at the edge, or
that a signed URL works. Those are the HTTP tier's measurements. Both batteries were green at the Stage 6
tree — `sql_chain_exit_code=0` for the replay that runs them beside every historical suite, with each total
printed apart and the two Stage 6 counts never added to another stage's. That replay is
`q6-logs/s6-sql-chain-05.log` on **2026-10-07**, the same capture the Stage 6 section cites; the earlier
`s6-stage6chain-04.log` (2026-10-06) still describes the same `supabase/` files, and §34.4 records how that
was checked rather than assumed.

`bash supabase/tests/stage7/run.sh` runs Stage 7's two batteries: **255** assertions on the family
review lifecycle (`80_family_review.sql`) and **116** on the boundary it must not cross
(`90_review_boundary.sql`). The runner is new because this workflow made the Stage 6 shape wrong: `80`'s
closing census counts rows cluster-wide ("no approval request exists that does not belong to one of this
battery's three weddings") and Stage 2's attack suite commits seed weddings and asks into the same
database, so Stage 7 split *databases* rather than assertions — a `review` chain carrying its own two
batteries and nothing else, and a `historic` chain that re-measures the twelve older suites, on both the
clean and the legacy-seed migration path, against a schema that now contains Stage 7. `80` must run before
`90` in one database, because `90` builds no family of its own: it reads the wedding, the seven asks and
the nine credentials `80` committed and asserts against them by name and count. Running `90` alone is not
a weaker test but a different one, and it does not pass, which is why the runner refuses a single-suite
argument. Every byte a suite prints is piped through `sed -E 's/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'` on its
way to the evidence directory, because the boundary battery's comparison helper prints the value it was
given when an assertion fails and one of the values routinely compared *is* a live review credential — the
"no raw token in a log" rule enforced at the last place it can be enforced for every suite at once. The
privilege
shape the paragraph below relies on is measured here rather than asserted: `G3b` reads
`has_schema_privilege(…,'USAGE')` for all three roles across both schemas — `anon` and `authenticated`
`true` on `api` *and* `internal_api`, `service_role` `false` on both — and `G3c` prints the raw `nspacl` of
both namespaces, `{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}`, so what withholds a
privileged body from a browser or from a service key is `EXECUTE`, enforced by the engine in plain SQL
rather than by a gateway setting. Captures on **2026-10-08**: `s7-stage7-runner-review-03.log` (255 and
116, each total printed apart and never added to another stage's) with `exit=0` recorded beside each suite
in `s7-stage7-sql-pair-01.log`, and `s7-stage7-runner-historic-clean-01.log` for the twelve, both chains,
at `DECLARED_HEAD=stage7`, `API_NAMES=13`, `INTERNAL_NAMES=24`. Same boundary the other SQL tiers state:
plain Postgres plus a role/auth shim plus a storage-schema fixture, with PostgREST, Supabase Auth and the
Storage API not executing, so no REST-level or browser-level claim is carried by these numbers.

`node scripts/tradition-pack-admin.mjs` is the maintenance operator's tool for authoring and approving
a release: eleven verbs, no `delete` verb, no web panel, and it refuses to run without an explicit
local target (`--linked`, `--project-ref`, a wrong container name and a hosted `*.supabase.co` URL are
each refused with exit 2). It connects by `psql` inside the local container or over loopback from a URL
read out of an environment variable, never from argv. **`service_role` holds no `USAGE` on
`internal_api` at all**, so the only identity that can drive it is the local owner role — this is
content maintenance, not a customer feature. Its HTTP-side counterpart is
`supabase/tests/api/stage5_admin_cli.test.mjs`.

`node scripts/stage4-render-qualification.mjs` is the browser instrument: it drives a real Chromium
over the DevTools protocol against the production bundle, and measures the rendered invitation
(10 content shapes × 4 viewports), the freeze-to-guest provenance walk and every network destination
the bundle reaches (143 checks, 33 measurements, 0 findings at this head). It checks rather than
assumes its three prerequisites — this repository's local stack running, `npm run build` having
produced `dist`, and `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` serving it — and
it refuses any target that is not loopback. Note what it does to get there: it writes wedding, release
and credential rows into the **local** database for the duration of a run and deletes them in its
teardown, so a run interrupted before teardown leaves synthetic rows behind; screenshots go to the OS
temp directory, not into the repository.

Stage 5 adds three instruments over the same production bundle, with the same three-prerequisite check
and the same loopback-only refusal. `node scripts/stage5-ui-journeys.mjs` walks three host journeys end
to end — **A**: sign up, create, write all four passages and the structured rows with **no pack**
chosen, freeze, publish, then read the guest page in a context with no session; **B**: choose a
synthetic approved release through the panel and freeze on its wording; **C**: retire the release a
**live guest link** points at, and measure how many times the published document moves (exactly once,
and only after the host chooses the newer release and freezes and publishes a new version to the same
address). `node scripts/stage5-a11y-mobile.mjs` is the host editor on a phone (59 checks, 48
measurements, 0 findings at this head). `node scripts/stage5-network-privacy.mjs` classifies the
network surface of nine pages rather than asserting it is empty, and records the guest page's storage
state as measured: no `localStorage`, no `sessionStorage`, no cookies. All three write synthetic rows
to the local database and clean up after themselves; **every reviewed and approved release they use is
a `TEST ONLY` fixture, which is qualification data and not cultural authority.**

## API testing against the local stack

The suites above play database roles inside psql; they cannot prove what PostgREST, a JWT or a browser
will do. These do, and they need this repository's own Supabase stack running:

```bash
npx supabase db reset --local --no-seed   # applies supabase/migrations from zero
npx supabase start                        # kong 54400, db 54401, mailpit UI 54403
bash supabase/tests/api/run.sh
```

`run.sh` reads `.env.local` (gitignored) and **refuses to run at all** unless `SUPABASE_LOCAL_URL` is a
loopback host *and* its port matches the `[api]` port in this repository's `supabase/config.toml` — a
mistaken pointer at someone else's stack fails both gates. It issues real sign-ups, real tokens and one
tampered JWT, and asserts what comes back through HTTP. At the Stage 5 head that was five files, **186
tests, 0 failed, 0 skipped**, each printing its own total:
`stage3_security.test.mjs` (56 — isolation, the anonymous surface, what a customer may never
do), `stage3_publication.test.mjs` (38 — the `api` surface, versions, credentials, the guest door,
rotation and revocation; its 38th test is Stage 5's, which probes `internal_api`'s maintenance verbs and
gets `404 PGRST202` for every credential shape, and which reuses the case id `API35` that the
revocation test already owns — recorded as a naming collision rather than renamed, because renaming it
would mean re-running the tier for a label), `stage4_tradition_packs.test.mjs` (28 — what a signed-in
role may read of the catalogue, which release a selection may name, and that a browser has no way to
author or approve a release), `stage5_pack_driven_http.test.mjs` (28 — the review-boundary posture over
HTTP, including that every reviewer, authorship and machine-disclosure column is refused **by name** at
the edge) and `stage5_admin_cli.test.mjs` (36 — the maintenance CLI against the real stack, each refusal
paired with the mutation that proves the refusal is the tool's and not the test's).
`run.sh` discovers its files by glob, so at the Stage 6 tree there is a **sixth**:
`stage6_storage.test.mjs`, **34 tests** — the 33 above plus `UPL-07`, the case that measures which
half of the confirmation edge has content behind it. All six have since been through the joint serial
chain together: **220 tests, 0 failed, 0 skipped** (capture `q6-logs/s6-api-run-04.log`, re-taken
2026-10-07), and the runner's own residue check came back with every counter — weddings, `auth.users`,
drafts, asset rows and bucket objects — at the zero it started from. `UPL-07`'s finding is a Stage 6
defect that was repaired in the adapter rather than in the database; §36 of
`docs/audits/stage-6-storage-assets.md` records what the tier does and does not now guarantee.
There is now a **seventh** at the Stage 7 tree: `stage7_family_approval.test.mjs`, **61 tests** — the ask's
ownership edge, the reviewer's door on a `x-review-token` header, the eight payload refusals in the
product's own sentences, the replay refusal, and `G-05`/`G-06`, which measure that the two approval tables
stay off the client in the owner's own session (a direct `PATCH` is 403/`42501`, another account's `GET` is
`[]`, and `private.access_tokens` is not in the catalogue at all — 404/`PGRST205`). All seven ran the joint
serial chain at this head: **281 tests, 0 failed, 0 skipped** (capture `q7-logs/s7-http-runsh-03.log`),
bracketed by a ten-table census at 0 rows before and after, including `approval_requests`,
`approval_feedback`, `access_tokens` and `storage.objects(wedding-assets)`. Stage 7's SQL batteries run on
their own runner, `bash supabase/tests/stage7/run.sh`, which splits databases rather than assertions because
`80_family_review.sql`'s closing census counts cluster-wide: `review` (255 + 116) and `historic` (the twelve
older suites on both chains).
`--local` is always explicit: `supabase link`, `db push`, `db pull` and
`db reset --linked` are not part of this project's workflow and are never run.

See [`docs/architecture/public-invitation-security.md`](docs/architecture/public-invitation-security.md)
for the boundary those tests hold, and
[`docs/architecture/render-contract.md`](docs/architecture/render-contract.md) for what an invitation
document promises once it gets to the screen.

## GitHub CI note

`.github/workflows/ci.yml` runs `verify` (clean install, lint, typecheck, product contract check,
unit tests, build) and `security` (env-file and credential scanning, production `npm audit`) on
pushes and pull requests targeting `main`.

Hosted-runner verification is currently **deferred**: this private repository's monthly runner
allocation is exhausted, so some runs conclude `failure` after zero steps with no runner ever
starting. That is an infrastructure quota condition, not a code failure, and is recorded as
`EXTERNAL CI QUOTA DEFERRAL` in the stage audits. If a job *does* start and a step fails, that is
a real failure and gets investigated.

## License

Private and unpublished at this stage.
