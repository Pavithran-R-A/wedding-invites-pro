# Family approval review security model

> The standing record of how a host asks a relative to read a frozen invitation, and what stops that
> ask from becoming a way into someone else's wedding, a second voice in the host's document, or a
> claim about a person's identity the product cannot support. Facts here are read from the schema and
> from batteries that run against a real API and a real browser; where a sentence is a decision rather
> than a fact, the reason is attached to it in the same breath. The stage that built it is
> [`../audits/stage-7-family-approval.md`](../audits/stage-7-family-approval.md), which carries the
> measurements. The code is
> [`20261008120000_stage7_family_approval_review.sql`](../../supabase/migrations/20261008120000_stage7_family_approval_review.sql),
> the client half is
> [`src/integrations/supabase/publicReview.ts`](../../src/integrations/supabase/publicReview.ts) and
> [`src/lib/familyReview.ts`](../../src/lib/familyReview.ts). It sits beside
> [`public-invitation-security.md`](public-invitation-security.md), which governs the guest door; where
> the two share a rule, this file names the shared rule and points at the door it was borrowed from.

## 1. What is being protected

A review link is a bearer credential, in the same sense and with the same consequences as a guest
link (`public-invitation-security.md` §1). The difference is what it opens: a guest link resolves a
*published* document to anyone, while a review link resolves an *unpublished, frozen* document to
whoever the host handed it to. So the thing being protected is not only other people's data but the
host's own claim about who saw their invitation before it went out, and what that person said.

| Who is asking | What they can learn | What they cannot do |
| --- | --- | --- |
| anonymous, no credential | nothing: `{"available": false}` from the review door, one phrase, identical to the answer given for a forged, revoked, expired, superseded or already-answered link (`:582-588`) | read any table; call either review door with a credential that does not resolve; tell which of those five cases it was |
| a signed-in host, about someone else's wedding | nothing, and no signal that the wedding exists: `insufficient_privilege` with the one phrase every `internal_api` host verb uses (ADR 0006) | ask, withdraw, or read another family's queue |
| a host, about their own | their own asks, each answer with the reviewer's own words, the version each ask is pinned to, each link's `link_state` and last-opened time — and no token material of any kind (`:916`) | mint a credential by hand, insert a frozen version by hand, name a reviewer for someone else's wedding |
| a relative holding a live link | the frozen document through the guest projection, the ask's own metadata, and the section keys that document contains | see the guest list, a household, an RSVP, another reviewer, a photograph, an `object_key`, a signed URL, a note they already sent, or any other wedding |
| a reader of the database | the SHA-256 digest of every review credential ever minted, its kind, its request and version pointers, and its expiry — and nothing that recovers one | — |

## 2. The callable surface

Five verbs, in the product's existing two-schema shape: privileged bodies in `internal_api`, which no
browser role can address, and one-statement `SECURITY INVOKER` wrappers in `api`, which PostgREST
exposes. `api` is still a schema of functions and nothing else.

| Verb | Exposed as | Callable by | Derives its caller from | Argument shape |
| --- | --- | --- | --- | --- |
| ask | `api.request_family_review(uuid, uuid, text, timestamptz)` | `authenticated` | `auth.uid()` | wedding, version, the reviewer's name, optional expiry |
| withdraw | `api.revoke_family_review(uuid)` | `authenticated` | `auth.uid()` | the request id |
| host queue | `api.get_approval_requests(uuid)` | `authenticated` | `auth.uid()` | wedding |
| open the review | `api.resolve_family_review()` | `anon`, `authenticated` | the `x-review-token` header | **zero arguments** |
| answer | `api.submit_family_review(text, text, text, text)` | `anon`, `authenticated` | the `x-review-token` header | decision, label, note, section key — no credential |

`service_role` appears in neither half, as it does not for the eight pre-existing wrappers: it holds no
`USAGE` on `api` or `internal_api` (Stage 2's C17c/C17e), it is not a browser, and it already owns the
grants on the tables these bodies write (`:859-861`).

`anon` is granted exactly the two review-door functions and nothing else. That makes this the product's
**second anonymous door**, deliberately rather than incidentally: a family reviewer has no account, so
`anon` is the only role they can ever be, and the alternative — a policy granting `anon` a table — would
fail Stage 2's C18, which is not available to weaken (`:863-866`). `anon`'s `USAGE` on `api` is Stage
3's (`20260926130000_stage3_publication_resolution_boundary.sql:142`); Stage 7 added function grants
inside it, not a new schema grant.

The wrappers are not decorative in one specific way: `api.resolve_family_review()` is **VOLATILE**,
because the door stamps `last_used_at` (`:396-430`), and PostgREST requires POST for a volatile
function. That is the mechanism that keeps the credential out of any URL: a volatile, zero-argument
function has no query string to leak through (`:801-804`). The invariant is enforced mechanically, not
by review habit, by the product-contract rule `reviewer-door-called-with-arguments`
([`scripts/check-product-contract.mjs:214-223`](../../scripts/check-product-contract.mjs)), which fails
the build on any `.rpc('resolve_family_review', …)` in `src/`.

## 3. The credential

* **Minted** by the ask, in the same statement that writes the request row: 32 bytes from the backend
  CSPRNG, base64url with padding stripped, 43 octets (`:127`). Same generator, same alphabet, same
  digest-only storage as the guest link, kept identical on purpose so one weakness cannot be hidden by
  divergence between two shapes.
* **Stored** only as `encode(digest(convert_to(raw,'UTF8'),'sha256'),'hex')` in
  `private.access_tokens.token_hash`, with `token_kind = 'approval_review'` and both
  `approval_request_id` and `approval_version_id` set (`:129-140`). `private` is not REST-addressable,
  so no browser role can name the column that holds the digest.
* **Returned once.** The raw string exists in exactly one HTTP response — the ask — and in nothing else:
  not in the queue read (`:916`), not in storage, not in a database column, not in this repository's
  committed text, and not in a run log that got past the masking layer. A host who loses it asks again.
* **One per request, while it is live.** `one_live_token_per_approval_request` (`:900-904`) is the
  approval-kind counterpart of Stage 3's `one_live_public_token_per_publication`. Without it a bug in
  the host path could mint a second live link for one ask and the product would have two answers to
  "which link did I send".
* **Carried in a header.** The client puts it in `x-review-token`
  (`publicReview.ts:32,78-85`) and the door reads it from `current_setting('request.headers')`
  (`:388`, `:562`). It is never an argument.
* **Shape-checked before it is hashed** (`octet_length = 43` and `^[A-Za-z0-9_-]+$`, `:390`, `:563`) and
  the check is a filter that returns the refusal rather than an error, so junk never reaches a digest
  and a malformed link costs the same as an unknown one. On the client side the same shape is asserted
  before any request is made, so a hand-typed 88-character paste does not even leave the phone
  (`src/lib/familyReview.ts:39` builds the host's link only from a well-shaped token, and
  `src/integrations/supabase/publicReview.ts:90,113` refuses both door calls before a request; measured by
  the browser tier's `a malformed credential is refused locally, without a round trip` at
  `scripts/stage7-browser-review.mjs:1041`).
* **Expiring by default at 14 days**, overridable upward by the host's own `p_expires_at` (`:112-116`).
  The number is this stage's own decision and is written as a constant with its reason attached rather
  than buried in an expression; `domain-model.md:383-385` forbids inventing a *retention* number, which
  is Stage 13's work and is untouched here.
* **Revoked in two situations**: the host withdraws an ask (`:188-192`), and a successor version is
  frozen (`:757-761`). Both set `revoked_at`; nothing deletes a token row.

## 4. Liveness, and the single refusal

Both doors resolve a credential through the same six predicates (`:399-408`, `:569-580`):

1. digest equality against `token_hash`;
2. `token_kind = 'approval_review'` — a guest or RSVP credential does not open this door even though
   both kinds are 43 octets of the same alphabet (group K of `80_family_review.sql`);
3. `revoked_at IS NULL`;
4. unexpired;
5. the request is still `status = 'pending'`;
6. the whole `(wedding, request, version)` triple agrees with the request row — the composite join that
   makes a cross-wedding credential and a cross-version credential the same refusal.

Anything that fails any of them gets one answer. For the door that is `{"available": false}`; for the
answer it is `{"recorded": false, "reason": "unavailable"}`. A holder of a dead credential is not
entitled to learn *which* of malformed, unknown, forged, revoked, expired, superseded or answered it
was — Stage 3 already made that the product's refusal shape rather than only an invitation-page
convenience, and Stage 7 inherits it rather than re-deciding it.

The one refusal that *is* specific is a bad decision verb (`:528-541`), which is checked before the
credential is read at all: it carries no information about anyone's link, and it lets the page tell a
relative "the review decision is not one this product records" instead of lying to them about their own
link. Its `p_decision IS NULL` half is measured, not theoretical: `NOT NULL IN (…)` evaluates to NULL,
so an unsupplied `null` from an anonymous RPC caller once fell through every guard and reached the
INSERT, where the schema stopped it — and the caller was handed a message naming a table and a
constraint. A JSON `null` reaching a family member's screen as a schema error is a defect this stage
owns.

There is a deliberate asymmetry in the vocabulary that a later reader must not "fix".
`approval_requests.status` permits `expired` (Stage 2's CHECK) and **nothing in this design ever writes
it**: expiry lives on the credential row, so an ask whose link has run out still reads
`status = 'pending'` while the queue's derived `link_state` reads `expired` (`:360-368`). A status only
a scheduler could set would be a second, drift-prone clock at a head that has no scheduler. The queue
therefore reports the deadline (`link_expires_at`) and the derived state, and group E of the SQL battery
measures both halves of that sentence against a moved-out credential.

## 5. Identity, stated the way this build states it

Possession of a review link proves that whoever holds it may answer *this* request. **It does not prove
who they are**, and nothing in the schema, the UI copy, or this document may present it as if it did
(`:333-344`). No account, no email verification, no device signal, and no claim of "verified reviewer"
is made anywhere; the product has none of those things at this head.

What the schema *can* do is make a forwarded link leave a trace instead of an alibi:

* `approval_requests.reviewer_display_name` — the name the host typed when asking (`:103-110`).
* `approval_feedback.author_label` — the name the person answering typed (`:611`).
* The host's queue shows both, so "this was asked of my mother-in-law and answered by someone who typed
  a different name" is visible on the screen rather than silent in a table. The browser tier measures
  exactly this case: a signed-in stranger who opens a live link answers under the words *they* typed
  ("I am actually the neighbour") while the page still addresses them by the name the host chose, and
  the host is shown that signature.
* `private.access_tokens.last_used_at` — stamped on every successful read (`:426-430`), so "the link was
  opened, and when" is evidence the host can see. Stage 2 declared the column and four stages left it
  NULL; this door is the first thing in the product to use it, for the one purpose its name implies.

`approval_requests.reviewer_contact_text` stays NULL in this build (`:309-324`, section 2.4 of the
migration). A phone number or email would suggest the product delivered something to a named person and
could verify that it reached them; it delivered nothing, so the column is left alone rather than
half-filled.

Two consequences bind the UI. The reviewer page carries the words "There is no sign-in on this page" and
is asserted to offer no account affordance at all; and the reviewer's own label is treated in
`publicReview.ts:44-48` as *a signature, not a credential* — which is the sentence this section exists to
make checkable.

## 6. What a reviewer may see

The review payload is `private.public_invitation_dto` — the guest-facing whitelist (Stage 3 drew it at
eleven names, Stage 4's schema-v2 projection added `sections`, so twelve) — with review metadata beside
it (`:466-484`). Reusing that projection instead of writing a second "review DTO" is the load-bearing
decision in this section:

* the projection already refuses a snapshot whose shape it does not recognise, so a reviewer cannot be
  shown a partial document (`:420-424`);
* it already carries no `object_key`, so a reviewer gets no photograph, no signed URL and no key to
  build one from — Stage 6's private-asset boundary holds over the review door for the same reason it
  holds over the guest door, and no separate threat model was needed because no new surface was created;
* it contains no guest list, no household, no RSVP row and no other reviewer, so Stage 2's I-13 is
  honoured by the payload's shape rather than by a filter added at the last moment.

Anything a later stage adds to this payload is a change to the guest projection too, and both doors'
batteries have to move together. That coupling is the point, not an inconvenience.

The response also returns `section_keys` — the vocabulary the frozen document actually contains
(`:435-438`) — so the page can offer a note a pin rather than a free-text guess. It does **not** return
note history: writing feedback and moving the request out of `pending` are the two outcomes of one
transaction, so a request this caller can open provably has no feedback row yet. An earlier draft of
this response carried `my_previous_notes`, which measurement showed to be `[]` on every single open; a
field that can never hold anything is a promise a page would break, so it is absent rather than empty,
and what a reviewer said reaches the host through the queue and cannot be re-opened from the link.

## 7. Answering: append-only, un-replayable, and no mutation of the document

* **One answer per ask.** Each accepted answer writes exactly one `approval_feedback` row and moves the
  request out of `pending` (`:608-617`). A second attempt on the same credential is refused because the
  request is no longer pending — which is what makes the recorded decision un-replayable *without
  needing a nonce*. If the family changes its mind, the host asks again: a new request, a new credential,
  a new row. The race is closed by checking `ROW_COUNT` (`:620-627`): if the `UPDATE … WHERE status =
  'pending'` moved anything other than exactly one row, the transaction aborts and the loser's feedback
  row goes with it, so no note is left pointing at a request somebody else already answered.
* **History cannot be rewritten.** `approval_feedback` has no UPDATE path and no `updated_at` (Stage 2's
  C36), and its delete guard plus the `ON DELETE NO ACTION` composite FK mean neither a client nor a
  cascade can un-say a review. Group G of the SQL battery exercises the guard's *exemption* on a live
  row rather than reading it from trigger text, and records that the guarantee a trusted role gets back
  is "value-for-value unchanged", not a licence to edit.
* **A rejection needs a reason.** `changes_requested` with no note is refused (`:554-560`): a rejection
  with no reason is not actionable and reads to a family as someone saying no to their wedding.
* **A note can only be pinned to a section that exists** in the frozen snapshot the reviewer is looking
  at (`:598-606`), re-checked on the way in so a hand-built request cannot invent a key. The
  no-key case is tested first because `NOT IN` against an empty array is TRUE.
* **The document is never touched.** Submit's only interaction with `invitation_versions` is that
  section-key test: it reads the pinned version's `snapshot -> 'sections' -> 'items'` (`:600-601`) and
  assigns nothing. `version_number` is read by the review door (`:414`) and by the host queue (`:258`),
  never by the answer path, and the rule is stated where the function is written (`:495-505`) and in
  its own `COMMENT` (`:922`). So "reviewing cannot silently mutate the approved invitation" is not
  politeness this function promises — it is a grant shape (`authenticated` has SELECT on
  `invitation_versions` and nothing else) plus the Stage 2 trigger `versions_immutable_no_update`
  (`20260925120200_stage2_versions_and_publication.sql:50`), which answers `42501` to any UPDATE. The
  browser tier measures the claim end to end by digest:
  the snapshot the reviewer read and the snapshot in the table afterwards are byte-identical, and no
  second version row exists.

## 8. A successor version closes the predecessor's open asks (I-12)

`stage-2-domain-blueprint.md:722` recorded this invariant as "constrained, not performed": the status
literal and its CHECK existed and nothing wrote them, because the marking action needed the
version-minting path. That path exists since Stage 3 and was rewritten in Stage 5, so Stage 7 performs
the marking inside `create_invitation_version` (`:736-761`): as soon as a successor row exists, every
still-`pending` ask on that wedding becomes `invalidated` with `invalidated_at`, and every live
`approval_review` credential on that wedding is revoked. Without the revocation, "stop resolving" would
be a hope rather than a property: a reviewer could answer a document the host had already moved past.

Three things are deliberately **not** done there, and each is a refusal to be tidier than the truth:
answered requests keep their status and their `responded_at` (what a reviewer said about v1 is a fact
about v1, and the biconditional CHECK would refuse to keep the timestamp while moving the row anyway);
no row is deleted (`stage-2-migration-plan.md` §7.1 settled that approval history does not vanish with
an aggregate — a silent erase of a family's disagreement is the same harm in a different shape); and the
function's own guards, issue engine and retry loop are re-declared unchanged from Stage 5, so the posture
assertions (C26, G1, I1-I3) keep reading the same values.

## 9. Separation from cultural-authority review

**This is the sentence Stage 7's architecture asserts, rather than a code path that enforces it, and it
is stated here because the migration says it lives in this document**
(`:778-796`).

* `internal_api.submit_tradition_pack_review` / `approve_tradition_pack_release` (Stage 5) move a *pack
  release* between `candidate` and `approved`, are callable only by a maintenance identity, and produce a
  review-packet hash.
* `internal_api.submit_family_review` moves a *host's request* between `pending` and an answer, is
  callable by an anonymous link-holder, and produces an append-only feedback row.

They share no table, no column, no status vocabulary and no privilege. **Nothing in the Stage 7 migration
reads `tradition_pack_releases`.** The one place the two could legitimately have been merged is the
deferred promotion in `domain-model.md:370` ("Stage 7's review workflow, if the review is ever to be done
by a named person inside the product rather than by a maintenance identity at a terminal"). This stage
declines it, for a privilege reason rather than a scope one: an anonymous link-holding relative is not a
cultural reviewer, and giving the family-review door any path to a pack release status would let a bearer
credential decide platform content. The pack-review surface therefore stays a local operator tool.

The same reasoning keeps Tamil cultural-authority review *out* of the reviewer's page: a relative
approving their family's patrika is not certifying wording for other hosts, and the product never says
they did. `docs/content-review/` is where that separate question lives.

## 10. Where each rule is tested

| Layer | Instrument | What it can prove | What it cannot prove |
| --- | --- | --- | --- |
| SQL | [`supabase/tests/stage7/80_family_review.sql`](../../supabase/tests/stage7/80_family_review.sql) (255 assertions, families A–Z) and [`90_review_boundary.sql`](../../supabase/tests/stage7/90_review_boundary.sql) (116) | schema, grants, policies, triggers, the token store, the state machine, the six liveness predicates, cross-wedding and cross-version refusal, I-12, the digest-not-the-link claim, expiry as an absence | PostgREST, Supabase Auth, the Storage API: no link is opened over HTTP, no JWT is verified, no header is read |
| HTTP | [`supabase/tests/api/stage7_family_approval.test.mjs`](../../supabase/tests/api/stage7_family_approval.test.mjs) (61 tests in 8 groups: TRANSPORT, CALLER MATRIX, ASK, REVIEW DOOR, REVIEW ANSWER, HOST QUEUE, VERSION SUCCESSOR, CREDENTIAL STORE), run through [`supabase/tests/api/run.sh`](../../supabase/tests/api/run.sh) beside the six historical API suites | the live stack's real status codes and bodies, the header as the only transport, the JWT-shaped anonymous caller, replay and expiry refusal over the wire, that the run left the database where it found it | what a person sees on a phone |
| Client unit | `src/test/familyReviewShape.test.ts`, `familyReviewPanel.test.tsx`, `familyReviewPage.test.tsx`, `familyReviewTransport.test.ts` | the JSON readers refuse the wrong *kind* and keep an unfamiliar *word*; the panel's affordances; the transport's `describe()` masking | that the wire ever carried anything |
| Browser | [`scripts/stage7-browser-review.mjs`](../../scripts/stage7-browser-review.mjs), four journeys against the production bundle (104 checks) | the shipped bytes, the real click path, what the CDP layer says left the machine, the credential's declared travel, accessibility at 390×844, and the digest of the frozen snapshot before and after a review | the console (the shared driver attaches no Runtime/Log listener), hosted access logs, and any real third party |
| Build-time | `scripts/check-product-contract.mjs` rule `reviewer-door-called-with-arguments`, plus the catalogue censuses that count `api`/`internal_api` functions | that no future edit puts a credential in a query string, and that the callable surface is a closed list | behaviour |

[`supabase/tests/stage7/run.sh`](../../supabase/tests/stage7/run.sh) is the runner for the SQL layer and
carries the boundary statement in its own header;
[`../audits/stage-7-family-approval.md`](../audits/stage-7-family-approval.md) is where the measured numbers live, because they move when the stage moves and this file is meant to outlast them.

## 11. What this boundary does not do

Stated as limits, because a security document that lists only strengths is a marketing document.

1. **It does not verify that the person holding a review link is the person the host named.** See §5.
   The build leaves a trace; it does not establish identity.
2. **It does not deliver the link.** There is no email, no SMS, no push. The host copies an address and
   pastes it into whatever channel their family already uses, and the product cannot see that hop. That
   is why `reviewer_contact_text` is NULL and why the panel's own copy says "Nothing has been sent to
   anyone. Copy it, or hand the link over yourself."
3. **It cannot reach what a browser keeps.** The credential sits in the reviewer's history, and in
   whatever access log a hosting stack writes. `<meta name="referrer" content="no-referrer">`
   (`index.html:16`) suppresses the *route* in cross-origin requests — measured on the local stack: the
   stylesheet request goes out with an empty Referer, and the font files it pulls go out with the
   stylesheet's own address between two Google hosts, identical whether or not the page's address holds
   a credential — but no meta tag reaches history or a server log. Deployment inherits that residue.
4. **It does not expose a photograph.** Not because review was given a separate threat model, but because
   the reviewer's payload is the guest projection, which never carried an `object_key` (§6). If a later
   stage wants images in review, that is a new surface and needs its own model, per Stage 6 §7.
5. **It does not schedule.** No cron, no worker, no expiry job: expiry is an absence at read time (§4),
   and `status = 'expired'` is a literal nothing writes.
6. **It does not decide retention.** How long an answered review stays readable is Stage 13's and is
   deliberately untouched.
7. **It does not claim a real family.** Every measurement here ran against the loopback stack with
   throwaway accounts and synthetic names, all of which the tier deleted again before it reported its
   residue.
8. **It is not merged, deployed, or run against hosted Supabase.** Stage 7 stops at the branch.

## 12. Changing this boundary

* Add nothing to the reviewer payload without adding it to the guest projection, and moving both doors'
  batteries in the same change. A private "review-only" field is how the two would start to differ.
* Do not give `anon` a table grant to avoid a function. C18 is the load-bearing assertion that keeps
  `anon` empty, and the two doors are the whole of the anonymous surface.
* Do not add an argument to `api.resolve_family_review()`. The zero-argument/volatile/POST shape is
  what keeps the credential out of a URL, and the contract rule will fail the build if you try.
* Do not write `status = 'expired'`. Two clocks drift; one is enough, and it is the credential row.
* Do not merge the two review vocabularies (§9). If a later stage *does* promote cultural-authority
  review into a named in-product reviewer, it must arrive with its own privilege story and its own
  battery — and the deferred line in `domain-model.md:370` is where to record that this document said so.
