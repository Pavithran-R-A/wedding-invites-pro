# Tradition-pack content governance

**Status: policy for future content. No ceremonial wording is authored in this stage, and none is
needed now.**

*(Stage 4 changed one word of that: the policy is now **enforced** for pack releases — a release
cannot be approved, selected or frozen without the record below — and it still describes content that
does not exist. Nothing in the local catalogue is customer content; see the last section.)*

*(Stage 5 changed a second word: the tooling sentence below is no longer true. There is now an
authoring UI, a review workflow with a hash-bound record, and a maintenance CLI — all of them local,
all of them reachable only by maintenance roles, and all of them qualified against synthetic
`TEST ONLY` fixtures. Governance is now enforced **and operated**, still over content that does not
exist. See "What Stage 5 changed", and read it together with the sentence in that section about what
a fixture review is not.)*

Tradition packs carry devotional text, invocations, blessings, community-specific labels and
translated phrases. Getting these wrong is not a copy bug — an incorrect invocation or a mistranslated
family heading appears in the one document announcing a marriage. Content therefore has a lifecycle
and an owner, like code.

## Pack statuses

Status belongs to a **release**, not to a pack. A pack is the concept ("a Tamil-and-English
foundation wording set"); each of its frozen wordings is a release with its own status, its own review
record and its own number. That split arrived in Stage 4 and is recorded in
[`../architecture/decisions/0007-versioned-reviewed-tradition-pack-releases.md`](../architecture/decisions/0007-versioned-reviewed-tradition-pack-releases.md);
before it, one row carried the concept, the wording and the status at once.

| Status | Meaning | Who may see it |
| --- | --- | --- |
| `draft` | Assembled, possibly machine-assisted, unaudited | Content authors only. Never selectable by a host |
| `reviewed` | Checked by a qualified human reviewer for the language and tradition in question | Internal preview with a visible "under review" marker; never publishable |
| `approved` | Signed off by a named reviewer, with the version and date of review recorded | Hosts may select and publish |
| `deprecated` | Withdrawn; existing published invitations keep their snapshot, no new selection allowed | Read-only |

A pack cannot move to `approved` without a human reviewer attached to that specific language and
tradition. Reviewers are credited in the pack's metadata, and review is per *release* of the pack,
not a one-time event. *(Stage 4: it is literally the release that moves — `status` lives on
`tradition_pack_releases`, and a pack row has none.)*

*(Stage 5, and this is the sentence that has to be read before the table above is quoted at anyone:
the constraint enforces the **presence and shape** of a review record, not the identity or
qualification of a reviewer. `reviewed` and `approved` are now reachable through
`internal_api.submit_tradition_pack_review` and `internal_api.approve_tradition_pack_release`, which a
maintenance role can call. Every step that got there in this stage came from a suite minting a
`TEST ONLY` fixture. The rules above are the policy this product intends to hold itself to with real
reviewers; the mechanism enforces them over the data it is given, and it cannot tell a qualified
reviewer from a script that typed a plausible `review_basis`.)*

## Review metadata (conceptual)

*(Every one of these is a column since Stage 4 — on the release: `languages`, `review_label`,
`review_basis`, `review_scope`, `reviewed_languages`, `reviewed_by`, `reviewed_at`, `machine_assisted`
with `machine_assistance_notes`, `source_reference`, `changelog`, `status` and `approved_at`; on the
pack: `scope_statement` — and the constraints binding them are named in the last section. The heading
is kept because the list below is still written as the questions a reviewer has to answer, not as a
schema.)*

Each pack release records: language(s) covered, tradition/community scope statement, the reviewer
identity and their stated basis for qualifying, review date and scope (which sections were checked
word-for-word), source of any sampled wording, machine-assistance disclosure, changelog, and the
approval decision itself. The purpose is answerability: when someone says "this blessing is wrong
for us", we must be able to find who approved it and on what basis.

## Hard rules

1. **AI-generated translation or religious/ceremonial wording never silently becomes authoritative
   pack content.** Machine output may enter a `draft` pack, must be labelled as machine-assisted,
   and cannot reach `reviewed` or `approved` without a human check against the specific tradition.
2. **Human review is required before a production pack release.** No exceptions for "small fixes";
   a changed word in an invocation is not a small fix.
3. **No inference.** Packs are selected by the host. Nothing in governance, tooling or defaults may
   derive a tradition, religion, caste or community from a name, language, location or guest list.
4. **No invented authority.** We do not publish wording as "the correct way" when practitioners
   differ; where variants exist, they are presented as variants.
5. **Immutable snapshots.** A published invitation keeps the pack content it was approved against,
   even after that pack is corrected or deprecated. Content updates must never silently edit
   someone's already-sent wedding document.
6. **Feedback has a route.** When a host or reviewer reports a problem with pack content, there must
   be an owner and a documented path to a fix, and the affected published snapshots identified.

## What Stage 4 made impossible, and what it left open

Rules 1–6 were prose. As of `20260927120000_stage4_tradition_pack_releases.sql` most of them are
constraints and triggers, which is a different kind of promise: it cannot be forgotten in a later
commit. The mapping, with the measurement named beside each one (the numbers are in
[`../audits/stage-4-tradition-pack-foundation.md`](../audits/stage-4-tradition-pack-foundation.md)):

| Rule | Now enforced by | What that rules out |
| --- | --- | --- |
| 1, 2 | `review_metadata_is_mandatory`, `draft_carries_no_review_metadata`, `approved_at_matches_status`, and the guard trigger's refusal of a lifecycle step that restates the review record | A draft that has been "approved" by filling in a name; a machine-assisted release that declares nothing about being machine-assisted (`machine_assistance_disclosure_required`) |
| 1 | `machine_assisted` + `machine_assistance_notes`, both projected into a frozen snapshot | A generated paragraph arriving at a guest with no record that a model wrote it |
| 3 | `weddings.tradition_pack_release_id` is written only by the host's explicit action, and four `src/`-scoped shape rules in `product:check` (`tradition-pack-identity-branch`, `tradition-selected-from-identity`, `identity-tested-by-name-shape`, `language-gated-rite`) | A "suggest a pack from the couple's details" feature arriving quietly as one more column in the same statement as the selection |
| 4 | `scope_statement`, mandatory on the pack and 20–2000 characters by constraint, and the release's own words are the only claim it may make | The platform describing a pack as authentic, correct, official or scripturally approved |
| 5 | `versions_pack_release_gate` (`private.require_frozen_pack_release`) plus the snapshot's own copy of the release's wording | Deprecating a release changing what an already-published guest reads — measured: retiring the release behind a live publication left the page resolving, and only a *new* freeze refused |
| — | `private.guard_tradition_pack_release()`'s content tuple, and its refusal to `DELETE` anything that has left `draft` | Editing an approved wording in place, and destroying the review evidence by removing the row |

What it deliberately does **not** provide, all of it still open:

* **No approved content exists.** Every release this stage created is a `TEST ONLY` fixture or a
  draft candidate. The one wording set written as a real artefact —
  `content/tradition-packs/tamil-english-foundation.v1.json` — is `human_reviewed: false`,
  `customer_selectable: false`, machine-assisted, and full of bracketed placeholders. It is not
  selectable, and the review document beside it is a work order with no answers in it. Measured at
  §35 of the Stage 5 audit: the artefact's four disclosure flags are unchanged, its `review` field is
  `null`, and in the live local catalogue **0** rows are candidate-shaped. What that catalogue does
  hold is 11 packs and 17 releases, 8 of them in `approved` state, every one of them named `TEST
  ONLY` with `reviewed_by IS NULL`. **Those synthetic reviewed fixtures are qualification data, not
  cultural authority** — they exist so the lifecycle, the hash binding and the privilege boundary can
  be tested at all, and an `approved` row among them is a state transition under test, not a blessing
  that anyone read.
* **Authoring and review tooling now exist locally; the review *community* does not.** Stage 4's
  sentence here read "A release is created by SQL today. There is no UI for a reviewer, no queue, and
  no way to record a review except writing the columns." Stage 5 replaced that: the host editor drives
  itself from a frozen release's resolved contract (`src/lib/invitationAuthoring.ts`,
  `src/components/invitation/AuthoringOutline.tsx`, `src/components/invitation/AuthoritativeIssues.tsx`),
  `internal_api.get_tradition_pack_review_packet` hands a reviewer the exact bytes a review binds to,
  `internal_api.submit_tradition_pack_review` records the review against that hash, and
  `scripts/tradition-pack-admin.mjs` gives a maintenance operator `list`, `retention`, `inspect`,
  `validate-release`, `review-packet`, `submit-review`, `create-pack`, `create-release`,
  `update-draft`, `approve` and `deprecate`. What is still missing is upstream of all of it: there is
  no queue, no assignment, no reviewer onboarding, and no qualified reader who has agreed to review
  anything. The tooling is a door into a room that is still empty.
* **No reviewer identity system.** `reviewed_by` is an optional FK to `auth.users` and
  `review_label`/`review_basis` are free text, because a reviewer who is not a customer of this
  product must still be creditable — and because building an approval workflow was out of scope.
  Consequence to keep in mind: a `review_label` is a claim someone typed, not a verified identity.
  What Stage 5 did add is *binding*: the review record pins `review_packet_hash`, and the guard keeps
  that pin (`NEW.review_packet_hash := OLD.review_packet_hash`), so a reviewer can no longer be made to
  appear to have approved bytes they did not see, and the same record cannot be re-pointed at a later
  wording. That closes a forgery window about *what was reviewed*; it says nothing about *who*.
* **Rule 6 is half a tool now.** Stage 4 left it as prose. The answer it needs is queryable today:
  `internal_api.tradition_pack_retention_report` (and the CLI's `retention` verb) walks releases to
  the versions frozen from them and the publications that still carry them, so "which guests are
  reading this wording?" has an output. What is still absent is the other half of a feedback route: no
  owner, no intake, no SLA, and no human process that would ever run the command. The schema makes the
  answer possible and Stage 5 made it *askable*; nothing here makes it happen.
* **Reviewers are not shown to hosts.** The DTO projects `pack_key`, `display_name` and
  `release_number` and nothing else, so the guest's document carries no reviewer name and no
  qualification. That is a privacy decision, not an oversight, and it is written down in
  [`../architecture/render-contract.md`](../architecture/render-contract.md) §7.6. *(Stage 5 re-measured
  it rather than assuming it: the guest projection still carries "no review record, no hash, no ids",
  and `InvitationRenderer.tsx:343` states that provenance is deliberately not drawn on the page. A host
  can see what a document stands on in the authoring outline; a guest cannot.)*

## What Stage 5 changed, in governance terms

Stage 5 was the stage that gave this policy an operator path. Four things are worth naming precisely,
because each one is a place where a future reader could over- or under-read the mechanism:

1. **A review now binds to bytes.** `internal_api.get_tradition_pack_review_packet` produces the
   review packet, `private.tradition_pack_review_payload` / `private.tradition_pack_review_hash`
   digest it (`VIVAAHVARNAM-REVIEW-PAYLOAD/1`, with `private.review_field` escaping each field and
   `private.canonical_token` fixing the line digest), and the record written by
   `internal_api.submit_tradition_pack_review` pins `review_packet_hash` — which the release guard then
   refuses to let anyone re-point (`NEW.review_packet_hash := OLD.review_packet_hash`). Governance
   consequence: "approved" can no longer mean "approved at some version of this text"; it means that
   hash.
2. **The step closes the read-then-write window it had.** The first version compared a handed-in digest
   against material that had been *read*, not held, so a concurrent draft edit could bind a reviewer to
   bytes they never saw. The repair is the `FOR UPDATE` lock taken ahead of the comparison. This is
   recorded in §29–§33 of the Stage 5 audit because it was found by trying to break it, not by reading
   it.
3. **`machine_assisted` is enforced at the record and frozen with the wording — and shown to nobody in
   the interface today.** Rule 1's disclosure requirement bites where the release is written, and the
   guard's content tuple copies `author_label`, `machine_assisted` and `machine_assistance_notes` into
   the frozen snapshot so the fact travels with the document. But `src/integrations/supabase/traditionReleases.ts:13-18`
   deliberately does not select any of those columns, and `InvitationRenderer` prints no provenance, so
   neither a host nor a guest is told in the UI that a wording was machine-assisted. That is a defensible
   privacy posture — "what cannot cross the wire cannot leak" is the file's own reason — and it is also a
   gap against the spirit of Rule 1, which says a machine's hand should be *disclosed*, not merely
   *recorded*. It is named here rather than left for someone to discover: if disclosure to the reader is
   the requirement, the work is to decide **who** gets told and to add that read deliberately, not to
   assume the column's existence already answers it.
4. **The cultural-safety checker grew four more rules** (`pack-selection-derived-by-name`,
   `place-tested-for-a-tradition`, `tamil-candidate-status-claim`,
   `machine-assisted-claimed-approved`), joining the 23 that already existed: 27 at that point, and
   `product:check` is the gate that stops a commit from quietly describing the draft candidate as
   shippable. Stage 5's fifth rule (`main-landmark-absence-claim`, added while assembling the Stage 5
   report after a stale current-state sentence about the host editor had survived the truth sync) takes
   the total to 28; it guards documentation truth rather than culture, so it is not one of the ten above.
   Its known blind spot is stated in the audit rather than here: none of the 28 rules looks
   at markup injection, so Rule 3's protection is about *derived tradition selection*, not about
   rendering safety, which lives in the Stage 0 sanitisation boundary and the Stage 5 refuser instead.

None of the above changes what the product may claim today: the real Tamil-and-English candidate is
`draft`, machine-assisted, unreviewed and not customer-selectable; no human cultural review has been
recorded anywhere in this repository; and the synthetic `TEST ONLY` fixtures that make all this
testable are qualification data, not cultural authority. Nothing is deployed.

## Deliberately out of scope now

Authoring actual ceremonial text, commissioning reviewers, and the reviewer-facing process around the
tooling (intake, assignment, qualification, SLA). Stage 5 built the mechanism and stopped at the
boundary of the judgment: this stage records the governance rules, enforces them, and gives a
maintenance operator a way to act on them — and still does not decide any wording, name any reviewer,
or put a single sentence in front of a customer as tradition.
