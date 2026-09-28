# Content review — Tamil and English invitation structure, candidate release 1

**Document status: a request for a human review that has not happened yet.**
Nothing in this file records a review. Every field below that belongs to a reviewer is blank, on
purpose, and this document changes no status anywhere: the candidate it describes is still
`draft`, `human_reviewed: false`, `customer_selectable: false`, and `machine_assisted: true`.
It is not in any catalogue, in any environment, as a row.

This is the artefact that directive §23 asks be prepared "for later human review". It is a
handover, not a verdict.

---

## 1. Candidate identifier

| Field | Value |
| --- | --- |
| File | `content/tradition-packs/tamil-english-foundation.v1.json` |
| `artifact` | `tradition_pack_release_candidate` |
| `pack_key` | `tamil_english_foundation` |
| `display_name` | Tamil and English invitation structure (candidate) |
| `release_number` | 1 |
| Lifecycle status in the file | `draft` |
| `human_reviewed` | `false` |
| `customer_selectable` | `false` |
| `machine_assisted` | `true` |
| `review` | `null` |
| Database row | **None.** The candidate exists only as this file. No environment holds it as a `tradition_pack_releases` row (see §6). |

## 2. Schema version

| Field | Value |
| --- | --- |
| `artifact_schema_version` | 1 — the shape of this JSON handover file |
| `definition_schema_version` | 1 — the contract the `definition` claims to satisfy |

`definition_schema_version` is not a content version. The database's guard
(`private.guard_tradition_pack_release()`) refuses any release claiming a version this build does
not understand, so a candidate claiming `2` cannot be stored at all rather than being stored and
mis-read. The contract itself is pinned in
`supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql` and mirrored in
`src/lib/traditionPackContract.ts`.

## 3. Intended scope — and what it deliberately does not claim

Quoted verbatim from the candidate's `scope_statement`, because a reviewer is being asked to
agree or reject this sentence in particular:

> This pack supplies the structure of an invitation: which sections appear, in what order, what
> each is called, and which of them read the host's own words. It does not supply ritual
> instruction, religious authority, community obligation, or an interpretation of any tradition,
> and it does not claim that any wording in it is traditional, correct, or approved. Its purpose
> is to be a machine-checkable candidate for a schema, not advice about ceremony.

What the product does with a pack, mechanically: it fixes which sections a document has, the order
they appear in, the label each one carries, and any body sentence the pack supplies. It does not
decide who the hosts are, what their families are called, which rites they hold, when or where, or
whether they want a pack at all. A host writing everything themselves is a supported state, not a
degraded one.

If a reviewer disagrees with any part of that sentence — for example, that naming a section "With
our blessings" is itself a claim the pack should not make — that is a finding on this candidate,
not a discussion to have after approval.

## 4. Supported languages

`languages`: `["en", "ta"]` — English and Tamil.

Two facts a reviewer should not have to rediscover:

* The order is load-bearing. The guard refuses a `languages` array that is not sorted and
  duplicate-free, so `["ta", "en"]` — which is what candidate 1 of this file declared before it
  was offered to a real database — cannot be stored. The mirrored rules in
  `src/test/traditionPackDraftCandidate.test.ts` accepted it, which is how the defect was found
  and why that ordering is now pinned in both places.
* `reviewed_languages`, when a reviewer fills it in, must be a **subset** of `["en", "ta"]` and
  must also be sorted and duplicate-free. A reviewer who checked only Tamil records `['ta']`, not
  a claim about English. The columns exist so that "which languages did this review actually
  cover?" has a machine-readable answer.

## 5. Every section key

Eleven sections, positions 1–11, no gaps, no duplicates. `kind` is one of the three the build can
draw: `text`, `people_list`, `event_list`.

| # | `section_key` | `kind` | `required` | `host_field` | heading? | `pack_text`? | `allow_english_fallback` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `opening` | text | **yes** | — | yes | yes | yes |
| 2 | `welcome` | text | no | `welcome` | yes | no | yes |
| 3 | `family_introduction` | text | no | `family_introduction` | no | no | — |
| 4 | `family` | **people_list** | no | — | no | no | — |
| 5 | `couple` | text | no | — | yes | yes | yes |
| 6 | `invitation` | text | no | — | yes | yes | yes |
| 7 | `ceremonies` | **event_list** | **yes** | — | no | no | — |
| 8 | `venue` | text | no | — | yes | yes | yes |
| 9 | `event_notes` | text | no | `event_notes` | no | no | — |
| 10 | `blessing` | text | no | — | yes | yes | yes |
| 11 | `closing` | text | no | `closing` | no | yes | yes |

Four sections read a host field (`welcome`, `family_introduction`, `event_notes`, `closing`).
Six supply a body sentence. `closing` does both, which means the pack's sentence appears only
where the host has not written one — see open question Q4.

## 6. Exact candidate wording

Every string in the artefact, verbatim, with the JSON path it lives at. A reviewer is asked to
mark each one accepted, changed, or removed — and to write the replacement, not describe it.

### Envelope (fields that are not `definition`)

| Path | Value |
| --- | --- |
| `display_name` | `Tamil and English invitation structure (candidate)` |
| `author_label` | `VivaahVarnam Stage 4 working draft, authored with a coding model` |
| `changelog` | `Candidate 1 of this pack: declares the eleven section slots this build renders, one people list, one event list, four host-field readings, and a three-entry event vocabulary. All body wording is placeholder. No reviewed wording is claimed.` |

`scope_statement` is quoted in full in §3; `source_reference` and `machine_assistance_notes` are
quoted in full in §7.

### Section headings

| Path | Value |
| --- | --- |
| `definition.sections[0].heading.ta` | `[placeholder] opening label` |
| `definition.sections[0].heading.en` | `Invitation` |
| `definition.sections[1].heading.ta` | `[placeholder] welcome label` |
| `definition.sections[1].heading.en` | `A warm welcome` |
| `definition.sections[4].heading.ta` | `[placeholder] couple label` |
| `definition.sections[4].heading.en` | `The couple` |
| `definition.sections[5].heading.ta` | `[placeholder] invitation label` |
| `definition.sections[5].heading.en` | `You are invited` |
| `definition.sections[7].heading.ta` | `[placeholder] venue label` |
| `definition.sections[7].heading.en` | `Where` |
| `definition.sections[9].heading.ta` | `[placeholder] blessing label` |
| `definition.sections[9].heading.en` | `With our blessings` |

### Section bodies (`pack_text`)

| Path | Value |
| --- | --- |
| `…sections[0].pack_text.ta` | `[placeholder] opening body pending human review` |
| `…sections[0].pack_text.en` | `[placeholder] Opening body. This candidate supplies no reviewed wording; a reviewer supplies it before this release can be marked reviewed.` |
| `…sections[4].pack_text.ta` | `[placeholder] couple body pending human review` |
| `…sections[4].pack_text.en` | `[placeholder] Couple body. Names are drawn from the host's own people list, never from this pack.` |
| `…sections[5].pack_text.ta` | `[placeholder] invitation body pending human review` |
| `…sections[5].pack_text.en` | `[placeholder] Invitation body. The request to attend is ordinary English here, not a traditional form of words.` |
| `…sections[7].pack_text.ta` | `[placeholder] venue body pending human review` |
| `…sections[7].pack_text.en` | `[placeholder] Venue body. The address itself belongs to the host's event list, not to this pack.` |
| `…sections[9].pack_text.ta` | `[placeholder] blessing body pending human review` |
| `…sections[9].pack_text.en` | `[placeholder] Blessing body. A closing good wish in the host's own words belongs here, not in this pack.` |
| `…sections[10].pack_text.ta` | `[placeholder] closing body pending human review` |
| `…sections[10].pack_text.en` | `[placeholder] Closing body.` |

Every `pack_text` value — in both languages — begins with the literal characters
`[placeholder]`. That is not a formatting quirk: it is the reason this candidate cannot be
mistaken for reviewed prose on a screen, and it is pinned by a test. A reviewer who supplies real
wording replaces the whole string, including the marker.

### Event vocabulary

| Path | Value |
| --- | --- |
| `definition.event_vocabulary[0].event_key` | `ceremony` |
| `definition.event_vocabulary[0].labels.ta` | `[placeholder] ceremony label` |
| `definition.event_vocabulary[0].labels.en` | `Ceremony` |
| `definition.event_vocabulary[1].event_key` | `reception` |
| `definition.event_vocabulary[1].labels.ta` | `[placeholder] reception label` |
| `definition.event_vocabulary[1].labels.en` | `Reception` |
| `definition.event_vocabulary[2].event_key` | `meal` |
| `definition.event_vocabulary[2].labels.ta` | `[placeholder] meal label` |
| `definition.event_vocabulary[2].labels.en` | `Meal` |

Three generic keys, chosen because they name a time and a place rather than a rite. A Tamil label
for `ceremony` is one of the things a review has to decide: a single word covering many different
rites is unlikely to be the right word for any of them (Q2).

### Design guidance

| Path | Value |
| --- | --- |
| `definition.design_guidance.lead_size` | `28` |
| `definition.design_guidance.motif_reference` | `[placeholder] motif token, no asset supplied` |

No artwork is claimed. `motif_reference` is a token slot, not an asset, and nothing in this stage
ships a motif.

## 7. Whether the wording was machine-assisted

**Yes. Completely, and with no human reading of any of it.** Quoted verbatim from the artefact:

`machine_assistance_notes`:

> Every string in this candidate was produced by a coding model working from the Stage 4 section
> vocabulary. Nothing in it has been read by a human reviewer, and no native speaker of Tamil has
> checked any Tamil value. Each Tamil value is a bracketed placeholder rather than wording, so the
> artifact cannot be mistaken for reviewed content, and no Tamil sentence has been machine-
> generated for a human to approve after the fact.

`source_reference`:

> Stage 4 directive sections 7, 10, 13 and 14; the section vocabulary pinned in
> supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql and mirrored in
> src/lib/traditionPackContract.ts. No external text, scripture, community source or prior
> invitation was copied or paraphrased into this file.

The database enforces the pairing rather than trusting it: constraint
`machine_assistance_disclosure_required` refuses a release with `machine_assisted = true` and no
disclosure of at least 20 characters. A draft also may not carry any review metadata at all —
`draft_carries_no_review_metadata` refuses a `reviewed_by`, `reviewed_at` or `review_label` on a
row that has not been reviewed, which is the constraint that makes "we'll fill the reviewer in
later" unrepresentable.

## 8. What has been verified about this candidate — and what has not

Verified, by executed tests against the real local stack:

* The production parser accepts the definition with **zero** issues, at the languages the
  candidate declares (`src/lib/traditionPackDefinition.ts`, run by
  `src/test/traditionPackDraftCandidate.test.ts`, 17 tests).
* The resolver draws it in both `ta` and `en` with no issues raised, producing all eleven section
  keys in pinned order — the same code path an editor uses.
* The database's own guard **accepts the candidate as a draft row**, byte-for-byte on the two
  leaves sampled (a Tamil placeholder and an English sentence carrying an apostrophe), and a
  signed-in customer cannot see that row: not by id, not through the picker's query, and not its
  `author_label`, which is refused by a column grant. The host cannot select it either — the
  selection gate refuses it with the one sentence it uses for every unshippable release. The row
  is then deleted, and the deletion succeeds only because the row never left `draft`
  (`supabase/tests/api/stage4_tradition_packs.test.mjs`, case `CAND-01`).
* The whole candidate was also run through the real Stage 4 HTTP battery of 28 cases plus the SQL
  battery, with the numbers reported in `docs/audits/stage-4-tradition-pack-foundation.md`.

**Not verified, and not claimable by anyone reading this document:**

* No human has reviewed any of this wording. `human_reviewed` is `false` in the file and there is
  no reviewer to name.
* No native speaker of Tamil has read a single Tamil value here. Every Tamil value is a
  placeholder, so there is nothing to have read — but the absence of Tamil wording is not evidence
  that any proposed Tamil wording would be right.
* Nothing here has been compared against a community source, a scripture, a published invitation,
  or a practitioner. `source_reference` says so in the negative.
* No religious, ceremonial, caste or community authority is claimed, and none is available.
* Nothing in this candidate has ever been offered to a customer. The only review-shaped data in
  this repository is a **test-only synthetic fixture** (`test-reviewed-fixture`, reviewer label
  `TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW`) that exists so the lifecycle can be
  exercised. Do not read that fixture as a review.
* The local database this was tested against is not a production database, and local qualification
  is not production qualification.

## 9. Open review questions

Unanswered. A reviewer writes answers here or rejects them; nobody else should fill these in.

* **Q1 — Are the English labels right for a Tamil-English invitation at all?** `Invitation`,
  `A warm welcome`, `The couple`, `You are invited`, `Where`, `With our blessings`. Six plain
  English phrases, machine-authored, none of them checked. Do any read as presumptuous, cold,
  wrong in register, or as claiming a relationship the host has not stated?
* **Q2 — What should the Tamil labels be, and should a Tamil label be invented for a generic
  key?** `ceremony` in particular: is there an acceptable single word, or should this pack show
  the host's own wording and supply nothing?
* **Q3 — Is `opening` being `required` correct?** A pack that requires a section means a document
  cannot be drawn without it. Is any section of this structure genuinely mandatory, or should
  every one of them be optional and left to the host?
* **Q4 — `closing` reads a host field *and* supplies a pack sentence.** So a host who writes
  nothing inherits a machine-authored closing line. Should a field the host is expected to fill
  have a fallback body at all, or should the fallback be empty?
* **Q5 — Is `blessing` a section this pack should offer?** The label is `With our blessings`. A
  closing good wish may be religious, familial, or secular, and practitioners differ; the
  governance rule is that where variants exist they are presented as variants, not as "the
  correct way".
* **Q6 — Is eleven the right number of sections, in this order?** Specifically: is
  `family_introduction` distinct from `family` (the people list) in a way a host will understand,
  and does `venue` separated from `ceremonies` match how these invitations are actually read?
* **Q7 — Does the event vocabulary omit something the build cannot represent?** It offers
  `ceremony`, `reception`, `meal`. A rite the host wants to name is entered by the host; the
  question is whether that is sufficient, or whether the vocabulary actively misleads.
* **Q8 — Is the `scope_statement` in §3 accurate and sufficient**, and is it readable by a host
  rather than only defensible by a lawyer?
* **Q9 — Is `design_guidance.lead_size: 28` a content decision or a styling one**, and does this
  pack have any business carrying it?
* **Q10 — What is this pack called to a customer?** `display_name` currently ends in
  "(candidate)". A name promising more structure than it supplies is a governance problem, not a
  copy problem.
* **Q11 — Should a *visual* template be named "Telugu Ceremonial"?** This is not a question about
  this pack, but reviewing this pack surfaced it, and it belongs with a content reviewer rather
  than with an engineer. `src/components/landing/DesignDirectionSection.tsx` lists five design
  directions, one of which couples a language to the word "Ceremonial" in its display name, and
  another is "Tamil + English Traditional". The Stage 4 cultural-safety gate deliberately does not
  flag either — a template name is not a code branch, and §24 forbids logic, not vocabulary — so
  nothing in this repository will raise this on its own. Is naming a typeface layout after a
  language and a ceremony a claim the product should not be making without practitioners' input,
  or is it plainly a style? Record the decision; do not leave it to the next engineer.

## 10. Reviewer instructions

In order, and none of them optional:

1. **Say who you are and what qualifies you, in §11 below, before judging the wording.** If you
   are not qualified for `ta`, record `reviewed_languages` as the languages you actually checked
   and nothing wider.
2. **Read §3 and decide whether you agree the pack's scope is what it says.** If you do not, that
   is a REJECT or a required change to `scope_statement` — do not fix it by ignoring it.
3. **Take every string in §6 individually.** Mark it accepted, changed, or removed, and write the
   replacement text in §12. Replacing a `[placeholder]` with real wording is the main job; leaving
   the marker in place means the release cannot honestly move out of draft.
4. **Answer or reject each open question in §9.** An unanswered question is a finding.
5. **Check the two structural claims:** that no sentence in this pack tells anybody what to
   believe, whom to obey, which rite must be performed, or who is pure; and that no label
   forecloses a variant a practitioner would recognise.
6. **If any wording you supply was produced with a model's help, say so in the machine-assistance
   disclosure.** The constraint binds the disclosure to the flag; the honesty is the point, not
   the checkbox.
7. **Record a decision in §13.** Only ACCEPT may be followed by a lifecycle move, and only by
   whoever applies it.
8. **Understand what the database will and will not let you do afterwards.** A release is editable
   only while it is a `draft`. Moving it to `reviewed` freezes its content permanently and requires
   `review_label`, `review_basis`, `review_scope`, `reviewed_languages` and `reviewed_at` to be
   non-null in the same write. `approved` may not restate the review record. A release that has
   left `draft` cannot be deleted, only deprecated. So **ACCEPT WITH CHANGES means the draft file
   changes and release 1 stays a draft** — it does not mean editing an approved release, which the
   database refuses. If a change is wanted after release 1 has been approved, that is release 2,
   and invitations already frozen keep release 1.
9. **Do not create a row for this candidate until you have finished.** Nothing in Stage 4 requires
   it, and an incomplete draft in a shared catalogue is how unreviewed wording starts looking
   shipped.

## 11. Fields the reviewer must fill — identity and qualification

```
Reviewer name or handle:
______________________________________________

Relationship to the content (practitioner / community elder / translator / staff / other):
______________________________________________

Languages you personally reviewed (choose only from: en, ta):
______________________________________________

Basis for your qualification, in your own words (this is stored as `review_basis`):
______________________________________________

______________________________________________

Scope of what you checked — which sections, word for word (stored as `review_scope`):
______________________________________________

______________________________________________

Source of any wording you introduced or endorsed (stored as `source_reference`; do not leave
blank if you supplied or changed any text):
______________________________________________

______________________________________________

Did you use a model to draft, translate, or shorten anything you endorsed?  Yes ☐   No ☐
If yes, what, and what you checked yourself:
______________________________________________

Date of review (stored as `reviewed_at`, ISO 8601):
______________________________________________
```

## 12. Field-by-field change notes

One row per string the reviewer changes. Empty rows mean "unchanged" — they do not mean
"endorsed", so record §13 explicitly.

| JSON path (from §6) | Verdict (accept / change / remove) | Replacement text, written out | Why |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

## 13. Decision

Tick exactly one. The options are the three the directive names.

```
☐  ACCEPT
      Meaning: the wording above is approved as it stands, and may be recorded as reviewed
      with the identity in §11. No string in §6 may be left carrying a `[placeholder]` marker
      under this option.

☐  ACCEPT WITH CHANGES
      Meaning: the structure is right and the changes in §12 are what should be made. Release 1
      stays a draft; the file is edited; a re-read is required before any lifecycle move.

☐  REJECT
      Meaning: this candidate should not become a customer-facing pack, in this shape or with
      §12 applied. Record what made it unrecoverable below.
```

```
Decision, if not one of the three above (write it out):
______________________________________________

Reason, in the reviewer's own words:
______________________________________________

______________________________________________

Known risks a later reader should carry forward:
______________________________________________

______________________________________________
```

## 14. What happens after this document is filled in

Nothing automatic. The lifecycle is not a button in a document: a filled-in review becomes a
database write by a maintenance identity, in this order and no other —

`draft` → `reviewed` (content frozen; review record mandatory in the same write) →
`approved` (sets `approved_at`; may not restate the review) → optionally `deprecated`.

Only `approved` releases are visible to a host's picker, and only an approved release can be
frozen into an invitation. A `reviewed` release stays invisible to customers, which is the point
of the intermediate state. Until a row moves to `approved`, this candidate remains, in every
sense the product can observe, not shipped.
