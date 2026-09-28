# Tradition-pack content governance

**Status: policy for future content. No ceremonial wording is authored in this stage, and none is
needed now.**

*(Stage 4 changed one word of that: the policy is now **enforced** for pack releases — a release
cannot be approved, selected or frozen without the record below — and it still describes content that
does not exist. Nothing in the local catalogue is customer content; see the last section.)*

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
  selectable, and the review document beside it is a work order with no answers in it.
* **No authoring or review tooling.** A release is created by SQL today. There is no UI for a
  reviewer, no queue, and no way to record a review except writing the columns.
* **No reviewer identity system.** `reviewed_by` is an optional FK to `auth.users` and
  `review_label`/`review_basis` are free text, because a reviewer who is not a customer of this
  product must still be creditable — and because building an approval workflow was out of scope.
  Consequence to keep in mind: a `review_label` is a claim someone typed, not a verified identity.
* **Rule 6 is still only prose.** A report of wrong wording has no owner, no route and no tool that
  lists the affected snapshots. The schema makes the *answer* possible (find the releases that
  selected a given `release_number`, then the versions frozen from them) and nothing makes it
  happen. This is the gap to close first when a real pack exists.
* **Reviewers are not shown to hosts.** The DTO projects `pack_key`, `display_name` and
  `release_number` and nothing else, so the guest's document carries no reviewer name and no
  qualification. That is a privacy decision, not an oversight, and it is written down in
  [`../architecture/render-contract.md`](../architecture/render-contract.md) §7.6.

## Deliberately out of scope now

Authoring actual ceremonial text, commissioning reviewers, and building the review tooling. This
stage records the governance rules so that later work cannot quietly treat generated text as
trustworthy by default.
