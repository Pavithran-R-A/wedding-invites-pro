# ADR 0007 — A tradition pack is a concept; the reviewed, publishable unit is a *release*

**Status:** Accepted (Stage 4, implemented and qualified against a real local API stack and a real
production bundle). **Nothing in the local catalogue is customer content: every release this stage
created is a `TEST ONLY` fixture.**
**Date:** 2026-09-28
**Affects:** `tradition_packs`, the new `tradition_pack_releases`, `weddings.tradition_pack_release_id`,
snapshot building, the public DTO, the editor's selection panel, the renderer, CI
**Supersedes part of:** [ADR 0003](0003-data-driven-tradition-packs.md) (its direction, not its rules)
and the `tradition_packs` shape Stage 2 shipped — see **Deviation record** below.

## Context

[ADR 0003](0003-data-driven-tradition-packs.md) decided that cultural variation would be data, chosen
by the host, with a `draft → reviewed → approved → deprecated` lifecycle and named reviewers. It
explicitly did not implement anything. Stage 2 then created `public.tradition_packs` while building the
canonical domain, and that table quietly *was* a pack engine with no engine: one row held a `revision`
integer, a `status`, `supported_languages`, a `structure` JSONB and three review columns
(`reviewed_by`, `reviewed_at`, `review_notes`). Stage 3 froze invitation snapshots against
`private.default_invitation_definition()`, so no row of that table was read by anything.

Implementing ADR 0003 against that shape failed on its own first requirement. The question governance
exists to answer is *"this guest read this sentence — who approved it, when, on what basis, and what
else did they read?"* A single pack row cannot answer it, because every answer is about a **version of
the content**, and the shape put content and lifecycle in one mutable row while the identity of the
content lived in a different column (`revision`) from the content itself (`structure`). Four concrete
problems followed:

1. **Approval could be restated.** A pack's `status` and its review columns were all editable, so an
   `approved` row could describe a different review than the one its wording had been approved under.
   "The review record is part of the frozen unit" is unenforceable when the unit is a mutable row.
2. **A correction destroyed evidence.** Fixing one wrong invocation meant editing the row that a
   published snapshot's provenance pointed at, so the claim and the content it described drifted apart
   — or the fix had to be skipped.
3. **`revision` was a number with no content identity.** Two rows could not share a key and differ by
   revision (the unique constraint was `(pack_key, revision)`), so a pack's history either overwrote
   itself or became a pile of unrelated pack keys.
4. **The lifecycle and the visibility rule were the same predicate.** Stage 2's read policy filtered
   `status = 'approved'`, which conflates "a browser may see this" with "a host may choose this" and
   both with "a guest may read a document frozen from this".

## Decision

**Split the concept from the content. `tradition_packs` is the concept — a slug, a display name and a
scope statement. `public.tradition_pack_releases` is the review unit, and it is the only thing a
wedding can select, a version can freeze, or a guest's document can be attributed to.**

`weddings.tradition_pack_release_id` (renamed from `tradition_pack_id`, now pointing at a release) is a
*reference*, not a copy: the wedding says which release it chose, and every freeze reads that choice.
The copy happens once, at freeze, inside `private.build_invitation_snapshot`, which writes a
projection of the release into the frozen document. That is the whole pinning mechanism: after a
freeze, no join to the catalogue is needed to reproduce what a guest was shown.

Enforcement is layered by kind of claim, because the four claims are different:

| Layer | Claim | Mechanism |
| --- | --- | --- |
| `CHECK` constraints | what a row in a given state must look like | `draft_carries_no_review_metadata`, `review_metadata_is_mandatory`, `approved_at_matches_status`, `deprecated_at_matches_status`, `machine_assistance_disclosure_required` (all biconditional, all named) |
| `private.guard_tradition_pack_release()` | the *shape* of a change | content frozen once status leaves `draft`; exactly three forward steps; review record immutable at any step; no row born `approved`; no `DELETE` of a release that left `draft` |
| `weddings_pack_release_gate` | what a host may newly choose | `approved` only, read as the calling role |
| `versions_pack_release_gate` | what may be frozen now | the release the wedding selects **and** `approved` — so retiring a release stops new documents without touching existing ones |
| RLS + grants | what a browser may read | approved releases, plus a deprecated release **only** where the caller's own wedding selects it; no write path for any browser role |

The two trigger gates read status *as the calling role*, which is deliberate: for a customer, an
unapproved release is not readable at all, so the refusal says "not readable by this role" rather than
leaking which internal states exist. The trusted maintenance path bypasses row security and is
refused by status name. One naming wart is recorded rather than renamed: the read policy is called
`users_read_approved_and_own_retired_pack_releases` (`:1573`) while the status vocabulary it filters
has no `retired` value — `CHECK (status IN ('draft', 'reviewed', 'approved', 'deprecated'))` at `:99` —
so "retired" in prose here always means `deprecated`.

**Deprecation is non-retroactive and that is the point.** Retiring release 1 does not move a wedding
off it, does not change a frozen snapshot's bytes, and does not break a live guest link; it only
refuses the next freeze. Release 2 being approved does not "upgrade" anything — moving to it is a host
action, and freezing from it is a second host action.

**Provenance is per section, and only three fields reach a guest.** Inside the frozen document each
resolved section carries `body_source` (`reviewed_pack` | `host`), `overrode_pack_text`,
`heading_fallback_used` and `body_fallback_used`. The snapshot's `tradition_pack_release` block keeps
the fuller record — pack key, display name, scope statement, release number, definition schema
version, languages, `machine_assisted`, author label, review label, reviewed languages, source
reference — because that is the evidence a support or review conversation needs. `public_invitation_dto`
projects exactly `pack_key`, `display_name` and `release_number` from it. A reviewer's identity,
their basis, their scope, the machine-assistance notes and any internal key have no path to the
public DTO, and the guest page was measured to prove it.

**A pack is optional, structurally.** `default_invitation_definition()` returns a definition in the
same shape a release carries, so "no pack" and "with pack" traverse the same resolver and the same
renderer. The alternative — an `if (pack)` branch in the renderer — is what ADR 0003 rule 1 exists to
prevent, and Stage 4's copy of that risk is a six-section neutral default instead.

**Language and tradition stay independent axes.** A release declares `languages`; the resolver picks
the requested language and *reports* a fallback (`body_fallback_used`) rather than silently
substituting English. The renderer receives a resolved value and a boolean. It is never told "this is
Tamil, do Tamil things".

**No new exposed surface.** Content authoring stays a privileged table write behind those triggers. No
RPC was added for it: the exposed `api` schema is still exactly the seven publication wrappers ADR 0006
qualified, because a maintenance RPC would either be unreachable over HTTP or would widen the
browser-callable surface to make a test easier.

## What was rejected, and why

- **Keeping review metadata on the pack row and adding a `pack_releases` table beside it.** Two places
  to be wrong about the same release; the honest unit would still be ambiguous.
- **Editing an approved release in place and recording a "history" table.** A history table describes
  an edit that a guest's document may already be built on. Frozen-at-approval makes the question
  unanswerable-by-accident instead of answered-by-a-log.
- **Allowing `approved → reviewed` (un-approving).** Either it leaves a review claim on wording nobody
  read, or it deletes the record of what was read. Both are the failure this table exists to prevent.
  A mistake becomes release N+1.
- **Deleting deprecated releases to keep the catalogue tidy.** A release that left `draft` is evidence
  of what a guest may have been offered; the guard refuses the `DELETE` even for the trusted path,
  which is why this stage's own test mints leave *deprecated* rows behind rather than vanishing.
- **A pack-selection RPC that "just returns the approved ones".** RLS already answers that, with the
  one exception the policy above carries (a host's own retired release, needed to render their editor
  honestly). A second read path would be a second copy of a rule that can then disagree with the
  first.

## Consequences

*Positive:* "which wording did this guest read?" is answerable from one row of one table; a cultural
correction becomes an ordinary content release with a review attached, not a schema migration or a
code change; the renderer's vocabulary is three section kinds and no culture, so an unreviewed
tradition cannot be encoded in a component; the no-pack path is the same code as the pack path; and
every rule above is a SQL object that the existing batteries can attack, which is how most of them got
fixed before this stage finished.

*Negative, and accepted:* release rows accumulate and cannot be removed, so the catalogue grows
forever and needs a retention *view*, not a delete; content authoring is a privileged database write
with no UI, which is correct for a stage with one reviewer (nobody) and unacceptable for a team, so an
authoring tool is a real later cost; pinning a projection into each snapshot duplicates content per
version; the freeze-time gate means a host mid-edit can be refused publication for a reason they
cannot see in the product, so the refusal has to be explained in the app's own words; and
`definition_schema_version` is a contract this build must keep refusing to guess about — a future
build that changes the section vocabulary has to reject old definitions, not interpret them.

## Deviation record — what Stage 4 changed about Stage 2's tables

**Status:** ADR 0003's rules are unchanged and still binding. This records where Stage 4's *schema*
departed from the shape Stage 2 shipped, so a reader of the Stage 2 audit does not find a table that
no longer matches its own report.

Stage 2's `tradition_packs` carried `revision`, `status`, `supported_languages`, `structure`,
`reviewed_by`, `reviewed_at`, `review_notes`, and a `users_read_platform_packs` policy filtering
`status = 'approved'`. Stage 4's forward migration `20260927120000_stage4_tradition_pack_releases.sql`
drops those seven columns, drops that policy, adds `scope_statement`, makes `pack_key` unique, and
moves content and lifecycle into `tradition_pack_releases`. Stage 2's migration files were not
edited; the shape the Stage 2 audit described is the shape that file still creates, and this
migration is the forward step away from it.

Two consequences worth naming rather than burying:

- The legacy rows Stage 2 migrated from `legacy.templates` carried a `price_tier` label and no review
  record. They were never promoted into releases: an unreviewed row cannot be made selectable by
  renaming a column, which is the same rule this ADR applies to machine-assisted content.
- `design_templates` keeps Stage 2's `status IN ('draft','approved')` read policy. Same kind of
  table, different answer, because its reason still holds there (a migrated legacy template has never
  been reviewed and a picker that hid drafts would go blank) and does not hold for packs, whose table
  was empty and whose content is the sensitive half of the product.

## Honesty limits of this stage

The mechanism is qualified. The content is not.

- No release in this repository or this local database is customer-safe. The catalogue's approved rows
  are fixtures whose display names, scope statements and review labels say `TEST ONLY`, and one of
  them says in its review label that it is *not a real cultural review*.
- The Tamil/English candidate at `content/tradition-packs/tamil-english-foundation.v1.json` is
  `status: draft`, `human_reviewed: false`, `customer_selectable: false`, `machine_assisted: true`,
  and every Tamil body value is a bracketed placeholder precisely so that no machine-generated
  ceremonial sentence can be read as an approved one. Its review document,
  `docs/content-review/tamil-english-foundation-v1.md`, is a work order for a human reviewer and
  contains no answers.
- All qualification ran against the local stack only. No hosted project received a migration, a row or
  a request, and the hosted CI runner was unavailable to this stage (account quota), so the gates that
  ran, ran here.
- The browser sweep is **rendering verification**: it measures what a layout engine drew. It is not a
  native-speaker linguistic review, and it makes no WCAG conformance claim.

## Evidence

[`../../audits/stage-4-tradition-pack-foundation.md`](../../audits/stage-4-tradition-pack-foundation.md)
— §18 (the synthetic release lifecycle), §19 (selection UX), §21–§22 (freeze, retirement and the
guest-visible consequences, on the production build), §24 (the renderer search that must find no
identity branch), §26 (every destination the bundle reaches), §27 (ten shapes × four viewports), and
§30 (the clean-install battery). The instruments are
`supabase/tests/stage4/` (SQL, both chains),
[`supabase/tests/api/stage4_tradition_packs.test.mjs`](../../../supabase/tests/api/stage4_tradition_packs.test.mjs)
(HTTP, against the real local API), and
[`scripts/stage4-render-qualification.mjs`](../../../scripts/stage4-render-qualification.mjs)
(real Chromium, real bundle, real stack).
