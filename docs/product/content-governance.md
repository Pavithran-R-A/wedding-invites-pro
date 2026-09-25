# Tradition-pack content governance

**Status: policy for future content. No ceremonial wording is authored in this stage, and none is
needed now.**

Tradition packs carry devotional text, invocations, blessings, community-specific labels and
translated phrases. Getting these wrong is not a copy bug — an incorrect invocation or a mistranslated
family heading appears in the one document announcing a marriage. Content therefore has a lifecycle
and an owner, like code.

## Pack statuses

| Status | Meaning | Who may see it |
| --- | --- | --- |
| `draft` | Assembled, possibly machine-assisted, unaudited | Content authors only. Never selectable by a host |
| `reviewed` | Checked by a qualified human reviewer for the language and tradition in question | Internal preview with a visible "under review" marker; never publishable |
| `approved` | Signed off by a named reviewer, with the version and date of review recorded | Hosts may select and publish |
| `deprecated` | Withdrawn; existing published invitations keep their snapshot, no new selection allowed | Read-only |

A pack cannot move to `approved` without a human reviewer attached to that specific language and
tradition. Reviewers are credited in the pack's metadata, and review is per *release* of the pack,
not a one-time event.

## Review metadata (conceptual)

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

## Deliberately out of scope now

Authoring actual ceremonial text, commissioning reviewers, and building the review tooling. This
stage records the governance rules so that later work cannot quietly treat generated text as
trustworthy by default.
