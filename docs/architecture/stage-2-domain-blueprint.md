# Stage 2 domain blueprint

> **Status: decided. This document is now a decision record as well as a proposal.**
> Everything from `## 1. weddings` down is the pre-implementation argument, kept verbatim so the
> reasoning behind the choices stays readable. What Stage 2 built, refused and deferred is recorded
> once, at the end, in [§ Stage 2 outcome](#stage-2-outcome). The schema as it exists today is
> described in [`domain-model.md`](domain-model.md); the migration's mechanics in
> [`stage-2-migration-plan.md`](stage-2-migration-plan.md); the executed evidence in
> [`../audits/stage-2-domain-database.md`](../audits/stage-2-domain-database.md).

> **THIS WAS DOCUMENTATION ONLY WHEN IT WAS WRITTEN.**
> No migrations, no generated types, no database code, no edge functions and no schema changes were
> produced for this document, and none of it was approved work at the time. It existed so Stage 2
> could start from an argued position instead of a blank page. Every entity below was a *proposal
> under challenge*, not a decision.
>
> Persisted reality **before Stage 2** — `projects`, `templates`, `guests`, `orders`, `payments`,
> `printers`, `activity_logs` from the original scaffold, plus the two account tables `profiles` and
> `user_roles`. The application read and wrote **only** `projects` and `templates`. Everything else
> was scaffold surface that later stages had to either claim deliberately or delete; Stage 2 claimed
> `profiles` and `user_roles` unchanged, rebuilt the rest of that list as new canonical tables, and
> archived the other six. See the outcome section.
>
> Binding inputs: [`../architecture/decisions/0001-patrika-first.md`](decisions/0001-patrika-first.md)
> · [0002](decisions/0002-structured-creator.md) · [0003](decisions/0003-data-driven-tradition-packs.md) ·
> [0004](decisions/0004-canonical-invitation-multiple-outputs.md) ·
> [0005](decisions/0005-server-authoritative-commerce.md) ·
> [`../product/invitation-semantics.md`](../product/invitation-semantics.md) ·
> [`../product/v1-scope.md`](../product/v1-scope.md)

## How to read an entity entry

Each entry states: **purpose**, **likely ownership**, **key relationships**, **important invariants**,
**sensitive/private considerations**, and **table vs JSON** — where "JSON" means a column (or nested
field) on the parent row rather than its own table. The table/JSON judgement is the most important
line in each entry, because the easy failure is turning every noun into a table.

General rule applied throughout:

> A concept earns a **table** when at least one of these is true: it is queried independently; it has
> its own lifecycle or permissions; other rows reference it; it must be indexed, constrained or
> audited on its own; it grows unboundedly. Otherwise it is **JSON on a parent**, or it does not
> exist yet.

---

## 1. `weddings`

- **Purpose:** The durable top-level aggregate — one wedding that a couple/hosts are planning. Owns
  the identity that everything else hangs from, and outlives any single invitation version.
- **Likely ownership:** `owner_user_id` → `auth.users`. A single owning account, with a separate
  membership concept if a team/second host ever collaborates (see §Necessity challenges).
- **Key relationships:** 1‑many `people`, `events`, `venues`, `invitation_versions`,
  `publications`, `guest_households`, `approval_requests`, `assets`, `entitlements`.
- **Important invariants:** Exactly one owning account context. Never orphaned by version churn.
  Deletion cascades to everything guest-facing (a cancelled wedding must stop resolving links).
- **Sensitive/private:** Contains names, locations, dates, and eventually phone numbers of a real
  family. Treat as personal data with a retention limit, not as an infinite archive.
- **Table vs JSON:** **Table.** Independently queried (dashboard, admin, billing), referenced by
  nearly everything, and needs RLS scoped per owner.
- **Necessity challenge:** This is `projects` renamed. If we do not need fields beyond
  title/language/guest_count, the honest answer is *alter `projects` into `weddings`* rather than
  introduce a second aggregate and a migration that has to reconcile them. Decide early; the longer
  both exist, the worse it gets.

## 2. `people` (hosts, couple, family members, elders)

- **Purpose:** Any human named in the document or in the hosting structure — bride, groom, parents,
  grandparents, invoking relatives.
- **Likely ownership:** The wedding; not a login. A person is *content*, not an account.
- **Key relationships:** Many to `weddings`; referenced by `invitation_versions.content` for section
  rendering; optionally linked to `auth.users` only if that person can log in (a co-host).
- **Important invariants:** Position/order within a group is meaningful and must be preserved, not
  alphabetical. Deleting a person must not silently change an already-published version.
- **Sensitive/private:** Names and family relations are personal data of third parties who never
  gave us consent. Collect minimally; the host's declaration that these are their relatives is the
  basis, and we should not add more about them than the document needs.
- **Table vs JSON:** **Lean JSON first.** Family members appear only as ordered content of a
  version, are not independently queried, and per-variant structure differs by tradition pack. A
  `people` table is justified only when something must *reference* a person (RSVP attribution,
  co-host invitation, reuse across weddings). Starting as `jsonb` inside wedding content, and
  extracting later when a real query demands it, avoids a wide table with 12 nullable relation
  columns.
- **Necessity challenge:** Strong. The scaffold's `profiles` table (one row per auth user) is *not*
  this concept, and conflating them is the classic mistake: a guest named on an invitation must never
  need an account. Keep `profiles` = account metadata, and never let it accumulate wedding content.

## 3. `events` (functions)

- **Purpose:** A dated occurrence within the wedding — reception, haldi, the muhurtham, a lunch
  after the ceremony. Multiple per wedding is the norm, not the exception.
- **Likely ownership:** The wedding.
- **Key relationships:** Many to `weddings`; many-to-many to `venues` (or a single `venue_id`, see
  challenge); referenced by `event_scopes`; appear in rendered versions and in the guest "correct
  events" requirement.
- **Important invariants:** Times are wall-clock + explicit timezone, never bare UTC — a muhurtham at
  07:30 local is the fact, and DST or server timezone must never shift it. An event may be optional
  per pack. Events must be reorderable without renumbering.
- **Sensitive/private:** Low sensitivity (venue and date become public to invited guests anyway), but
  the *set* of functions reveals family practice, so it must only be visible to intended recipients.
- **Table vs JSON:** **Table.** Event scoping (`which guest sees which events`) requires stable
  event identity that other rows reference, and filtering per recipient is a real query.
- **Necessity challenge:** If V1 shipped without per-recipient event scoping, events could be JSON.
  But V1's IN list includes event scopes, so the table is warranted — and if scopes were ever cut,
  this table should be reconsidered, not kept out of habit.

## 4. `venues`

- **Purpose:** A physical place with an address, geo point and map link, shared across events.
- **Likely ownership:** Wedding-scoped rows, with an optional global/cross-wedding lookup layer for
  popular halls later.
- **Key relationships:** Events ↔ venues; rendered into versions and outputs; the target of the
  guest's most common action (open map).
- **Important invariants:** **Sharing a venue never grants ownership or visibility.** Two couples at
  the same hall must not be able to discover each other through it. Address text and coordinates must
  stay consistent with what was published (a wrong map pin is a serious user-facing failure).
- **Sensitive/private:** Reveals a family's locality and budget band implicitly. Never expose a venue
  record for browsing/search across weddings in V1.
- **Table vs JSON:** **Table if deduplicated/referenced; JSON if merely embedded.** Honest assessment:
  for one wedding, the venue is content on the event. The table earns its keep only when a hall is
  reused across weddings (a partner-venue feature) or when map links must be validated centrally.
  Start as JSON on `events`, extract when a cross-wedding query appears.
- **Necessity challenge:** High. A venue directory is a tempting, expensive, low-V1-value project.

## 5. `tradition_packs`

- **Purpose:** Declarative description of a tradition's section order, labels, required/optional
  fields, event vocabulary, motifs, typography guidance and reviewed wording samples
  (ADR 0003).
- **Likely ownership:** Platform-owned content, authored by reviewers — not customer data.
- **Key relationships:** Referenced (version-pinned) by `invitation_versions`; references motif
  `assets`; may be joined by a `pack_translations` or content-variant table.
- **Important invariants:** Immutable once referenced. A pack row must never be edited in place while
  invitations depend on it. Status lifecycle enforced at the DB level: only `approved` content may be
  selected for publication. **No column may be interpreted as a customer's caste, religion or
  community.**
- **Sensitive/private:** This is the highest-reputational-risk table in the product. Reviewer identity
  and review basis must be recorded and queryable — "who approved this blessing text" needs an answer.
- **Table vs JSON:** **Table for the pack header (status, version, reviewer, timestamps), JSON inside
  for the structure** (section order, labels, vocabulary) since it is read as one document and never
  queried field-wise.
- **Necessity challenge:** Real, but only when packs exist as product content. Building the pack
  *engine* before there are two genuinely different packs is speculative generality; V1 may need one
  well-made Tamil+English pack expressed as config, and the abstraction should follow the second.

## 6. `templates` (design directions)

- **Purpose:** Visual treatment: layout rules, palette, type pairing, motif placement. The landing
  page's "design directions" become shippable objects here.
- **Likely ownership:** Platform content.
- **Key relationships:** Referenced by versions; combined with a tradition pack; may reference
  `assets`.
- **Important invariants:** A template must be pack-compatible (a template cannot smuggle in a
  religious symbol the host did not select). Already published versions must render unchanged when a
  template is revised. Existing table has `preview_svg` consumed through the sanitiser boundary —
  keep that invariant: **any SVG entering the DOM goes through `sanitizeSvg`.**
- **Sensitive/private:** Low direct privacy risk; high *cultural* risk (see §8 of design principles).
- **Table vs JSON:** **Table** (already exists) — referenced, versioned, browsed as a catalogue.
- **Necessity challenge:** The relationship between "template" and "design direction" needs an
  explicit decision: one row per visual design, or per (design × pack) pairing? The wrong answer
  multiplies content work silently.

## 7. `invitation_versions`

- **Purpose:** The immutable snapshot that everything trustworthy attaches to: content, resolved pack
  + template, styling, and the rendered document (ADR 0004).
- **Likely ownership:** The wedding; created by an account.
- **Key relationships:** Many to `weddings`; referenced by `publications`, `approval_requests`,
  `outputs`, `guest_households`' view context; references one pack version and one template version.
- **Important invariants:** **Immutable after creation** (updates forbidden by policy and trigger).
  Exactly one `draft` per wedding is editable at a time. Supersession is explicit and monotonic.
  Content must be *resolved* into the version (pack text copied in), not merely referenced, or
  "immutable" is a lie.
- **Sensitive/private:** Contains the full guest-visible content plus host-edited names; a version is
  the object a leaked link exposes, so it must not carry internal host notes, pricing, or guest lists
  in the same row.
- **Table vs JSON:** **Table, with JSON inside.** Version identity, timestamps, status and lineage are
  columns; the document body is a `jsonb` snapshot.
- **Necessity challenge:** Not challengeable if publication and approval exist. If Stage 2 ships only
  drafts, versions can wait — but then *nothing can be published*, which is the point of the product.

## 8. `publications`

- **Purpose:** The act of pointing a stable, reachable address at an immutable version — plus the
  token and settings that make it openable by guests.
- **Likely ownership:** The wedding (one active publication per wedding, history retained).
- **Key relationships:** 1‑many from `weddings`; references exactly one `invitation_version`; owns the
  guest-facing route/slug; parent of access telemetry.
- **Important invariants:** A publication always names a specific version, never "the current one".
  Unpublishing must make links stop resolving promptly. Re-publishing a different version is an
  explicit, audited action. Publishing requires the entitlement check server-side (ADR 0005) where a
  paid tier applies.
- **Sensitive/private:** This row is the attack surface: it is the thing a stranger probes. Slug/token
  entropy, rate limiting and no data leakage in error responses are properties of this table's design.
- **Table vs JSON:** **Table.** Needs its own lifecycle, its own permissions, and to be queried by
  slug on the public path.
- **Necessity challenge:** None — it is the core deliverable. Resist instead the temptation to fold it
  into `weddings.is_published`, which is how versioning discipline dies.

## 9. `guest_households`

- **Purpose:** The unit a link is addressed to — one family, one flat, one office desk. The reason
  personalisation and RSVP are tractable at all.
- **Likely ownership:** The wedding.
- **Key relationships:** Many to `weddings`; has `recipients`; has `event_scopes`; linked to `rsvps`;
  referenced by tokens.
- **Important invariants:** A household's salutation must never be visible to another household.
  Deleting a household revokes its access. Household count is not a billing metric (rejected pricing
  pattern).
- **Sensitive/private:** **Highest data-protection load in the system.** Names, phone numbers and
  addresses of third parties, imported by the host, most of whom never consented to us. Requires
  purpose limitation, short retention, export/delete support, and a guest-facing "why do you have my
  name?" answer.
- **Table vs JSON:** **Table.** Queried per recipient on the public path, referenced by tokens and
  RSVPs, needs row-level security — this is the clearest table in the document.
- **Necessity challenge:** Legitimate. But note households are what *personalisation* needs; if V1
  shipped one generic link with no scoping, this would collapse into a guest list. Keep the design,
  sequence the feature honestly.

## 10. `recipients`

- **Purpose:** Individuals inside a household, for salutation ("Dear Anitha and Suresh") and for
  headcount-accurate RSVP.
- **Likely ownership:** The wedding, via a household.
- **Key relationships:** Many to `guest_households`; referenced by `rsvps` attendance; carries an
  optional personal link.
- **Important invariants:** Recipients are never enumerable through a guest link. A personal link
  reveals exactly one recipient's view.
- **Sensitive/private:** Personal data of non-consenting third parties, as above. Do not attach
  anything beyond what the salutation and headcount need — no notes about relationships, no inferred
  community, no "vegan" metadata that becomes an embarrassing disclosure.
- **Table vs JSON:** **JSON inside the household initially.** A household's member list is read as a
  unit, rarely queried per person, and RSVPs can reference by a stable member key inside the JSON.
  Promote to a table when an individual needs their own token or their own RSVP record.
- **Necessity challenge:** Strong candidate for deferral. Many target users think in families, not
  individuals; the scaffold's existing `guests` table should not be assumed to be the right shape.

## 11. `event_scopes`

- **Purpose:** Which events a given household (or recipient) is invited to — the difference between
  "come to the reception" and "come to all four functions".
- **Likely ownership:** The wedding, attached to a household.
- **Key relationships:** Households ↔ events.
- **Important invariants:** **A scope can never grant access outside its own wedding.** A scope that
  lists zero events is a data error, not "invited to nothing" — must be validated. Rendering must
  filter by scope on the server, never hide client-side.
- **Sensitive/private:** A cross-scope leak tells one family that another exists at an event they were
  not invited to. This is a category-defining failure and should be treated as a security bug, not a
  content bug.
- **Table vs JSON:** **JSON array of event ids on the household.** It has no lifecycle, no independent
  query beyond "what does this household see", and no other referent. A join table here is ceremony
  for its own sake until event count and household count both get large.
- **Necessity challenge:** The *concept* is necessary; the *table* is not.

## 12. `approval_requests`

- **Purpose:** Asking a named person (usually a parent or elder) to review a specific version and
  respond. Family acceptance is the product's social unit, so this is not an optional workflow.
- **Likely ownership:** The wedding; addressed to a reviewer identified by contact, not necessarily an
  account.
- **Key relationships:** Exactly one version; many `approval_decisions`; carries the reviewer's token.
- **Important invariants:** Bound to one immutable version, so it can be *invalidated* — never
  silently re-used — when a new version is created. An expired/withdrawn request must stop resolving.
  A reviewer is not a guest and must not see the guest list.
- **Sensitive/private:** Contains a reviewer's contact details and their pending view of the family's
  document. Their comments can be blunt and private; treat them as such.
- **Table vs JSON:** **Table.** Its own lifecycle (pending/approved/changes-requested/expired), its own
  token, and a status that a host polls.
- **Necessity challenge:** Necessary for the promise "your family approves it". Can be deferred within
  Stage 2 but not deleted from the model, because approval against a version is what makes versioning
  worth having.

## 13. `approval_decisions` (and comments)

- **Purpose:** The reviewer's answer on a version: approve / request changes, with optional
  free-text comments.
- **Likely ownership:** The approval request; attributed to a reviewer identity.
- **Key relationships:** Many to one `approval_requests`; may reference specific sections for a
  pinpoint comment.
- **Important invariants:** Append-only; a re-approval is a new decision, not an overwrite. A decision
  cannot be written by the host about their own version (self-approval must be blocked or explicitly
  allowed as a mode). Timestamps must be trustworthy for later disputes.
- **Sensitive/private:** Family disagreement in writing is delicate — a comment that says "this is
  wrong, change it" is read by the person who wrote the draft. Section-pinning and clear attribution
  matter more than usual; misattribution here causes real interpersonal harm.
- **Table vs JSON:** **Table** — it is the audit record, needs append-only integrity and queries
  ("what did we ask her about?").
- **Necessity challenge:** Legitimate. Resist only the urge to build full comment threads, emoji
  reactions and mentions; that is a chat product, and it is not in V1.

## 14. `rsvps`

- **Purpose:** A household's (or recipient's) reply to an invitation, per event.
- **Likely ownership:** The wedding; submitted anonymously-with-token by a guest.
- **Key relationships:** Household, event, optionally recipients; produced through a scoped token.
- **Important invariants:** **An RSVP may only operate on an authorised, scoped recipient/event pair**
  — never "the wedding's RSVPs". Duplicate submissions must be idempotent or explicitly superseded.
  Once a meal/headcount number is relied on by a caterer, retro edits need care.
- **Sensitive/private:** Guest-submitted personal data, often on a shared phone, frequently a
  non-consenting third party's name. Must be visible only to the host (never to other guests),
  deletable on request, and never used for marketing.
- **Table vs JSON:** **Table.** Written by unauthenticated public submissions, queried by host for
  counts and lists, needs its own audit trail.
- **Necessity challenge:** Core. The existing scaffold `guests` table is a plausible place to grow it
  — but only after checking whether its columns are the right ones rather than adopting its shape by
  default.

## 15. `assets`

- **Purpose:** Uploaded and generated files — photos, motif images, monogram renders, exported PDFs
  and share images.
- **Likely ownership:** The wedding (uploads) or the platform (generated outputs).
- **Key relationships:** Attached to weddings/versions/outputs; stored in object storage with DB
  metadata only.
- **Important invariants:** Content-type validated and re-encoded where possible; **no
  user-supplied SVG or HTML ever rendered without the sanitiser boundary**; size limits enforced
  before storage; private buckets with time-limited signed URLs, never public URLs guessed from ids.
- **Sensitive/private:** Wedding photographs of minors and relatives, uploaded to a third-party
  object store. Requires: private-by-default, no public listing, deletion propagation to generated
  derivatives, and a stated retention period.
- **Table vs JSON:** **Table.** Object storage cannot enforce app-level permissions, and each asset
  needs lifecycle, scan state, and provenance.
- **Necessity challenge:** Necessary as soon as photos exist. Deferrable if V1 launch ships
  typography-only designs — worth testing, because photo handling is a large security surface.

## 16. `entitlements`

- **Purpose:** What this wedding is allowed to do (publish, guest volume band, premium services),
  derived from payment — never asserted by the client.
- **Likely ownership:** The wedding (or the owning account), written only by server paths.
- **Key relationships:** From `orders`/payment confirmations; read by publication and feature gates;
  referenced by an audit trail of state changes.
- **Important invariants:** **Entitlement activation must be server-authoritative** (ADR 0005 rule 4).
  Clients may never write entitlement state, on INSERT or UPDATE — and the guard must distinguish
  trusted callers by role, since a `BEFORE` trigger and `WITH CHECK` policy both run as the invoker.
  Least-privileged defaults: a new row's status must default to the *lowest* entitlement, mindful that
  a column `DEFAULT` resolves before checks run.
- **Sensitive/private:** Commercially sensitive. Also a trust surface — if a customer can mint an
  entitlement, we have both a revenue leak and a precedent.
- **Table vs JSON:** **Table.** Own lifecycle, own permissions, server-only writer, must be audited.
- **Necessity challenge:** Only needed when something is gated. If preview is entirely free, an
  entitlement table is premature — but the publish gate must then be unconditional, not a fake check.

## 17. `orders` / `payments`

- **Purpose:** A purchase attempt (`orders`) and the provider-confirmed money movements against it
  (`payments`, append-only, one row per provider event/refund).
- **Likely ownership:** The account/wedding; written only by server code and webhooks.
- **Key relationships:** Orders → entitlements; payments → orders, with provider event ids; both feed
  `activity`.
- **Important invariants:** Amounts are server-computed and stored as immutable integers with an
  explicit currency and scale — **never floats, never accepted from the client**. Provider event ids
  are unique so webhook replays cannot double-credit. State transitions are legal-only-forward, and
  every transition records who/what caused it. **No client route may set or change an order's paid
  state, including on creation.**
- **Sensitive/private:** Financial records. Store the minimum: no card data (out of PCI scope by never
  touching it), and keep provider tokens only as far as refunds need. Indian financial-record retention
  obligations must be checked with accounting before designing columns.
- **Table vs JSON:** **Table.** Both. Financial ledgers are the least JSON-shaped data in the product.
- **Necessity challenge:** The scaffold already has `orders`, `payments` and `printers` tables with
  unused, guessed shapes. Stage 2's decision is *delete or reshape*, deliberately — keeping plausible-
  looking dead money tables is an audit hazard, because someone will later assume they mean something.

## 18. `activity` / audit log

- **Purpose:** Who did what to which object: publish, unpublish, revoke link, approval recorded,
  entitlement change, guest data export/deletion, admin intervention.
- **Likely ownership:** Platform-written, append-only, not editable by any product user.
- **Key relationships:** Polymorphic subject (`wedding_id`, `version_id`, `publication_id`, …) plus
  actor (account, service, admin).
- **Important invariants:** Append-only, enforced by permissions (no update/delete grant), with an
  actor that cannot be forged by the client. Never store secrets or full guest lists in payloads.
  Retention period defined, then honoured.
- **Sensitive/private:** The log itself becomes a personal-data index; audit trails naming guests turn
  support visibility into a disclosure risk. Store object ids and summaries, not content.
- **Table vs JSON:** **Table** with a JSON `payload`. `activity_logs` already exists and is **not
  written by the app today** — either wire it purposefully or drop it.
- **Necessity challenge:** Genuinely valuable before money moves. Defensible to defer until
  publication exists, but not to skip past the first refund dispute.

## 19. `tokens` (approval, guest, RSVP access)

- **Purpose:** The credential behind every unauthenticated access path: family review link, guest
  invitation link, RSVP submission link.
- **Likely ownership:** Platform rows, bound to a wedding/publication/household.
- **Key relationships:** Points at exactly one scope: version, household, event set; carries expiry
  and revocation state.
- **Important invariants:** Detailed in §Token security design below. The short form: high entropy,
  opaque, server-resolved, revocable, expiring, and scoped so one token can never enumerate a list.
- **Sensitive/private:** A token is a bearer capability: anyone holding the URL sees what it exposes.
  Store a **hash** of the token, never the plaintext, so a database read cannot mint live links.
- **Table vs JSON:** **Table**, one row per token, deliberately independent of the objects it scopes.
- **Necessity challenge:** Unavoidable for sharing. Challenge instead whether tokens are *per
  household* or *per recipient* — the latter multiplies link counts and confused guests.

---

## Necessity challenges — what should NOT be a table

The blueprint is deliberately smaller than a feature list. Rejected or deferred as their own tables:

| Rejected noun | Why not a table |
| --- | --- |
| `sections`, `blessings`, `wording_lines` | They are rendered content inside an immutable version snapshot. Independent tables would break immutability and invite pack edits mutating sent invitations |
| `salutations` | Derived at render time from household + pack template |
| `tags`, `categories` on packs/templates | Premature taxonomy; encode as an array until a real query needs a join |
| `design_tokens` | Live in code/config as a versioned artifact, referenced by id from a version snapshot |
| `languages` | A static list in `src/lib/i18n.ts`, plus a DB enum if a constraint is needed |
| `guest_notes` | A field on the RSVP, not an entity |
| `vendor_directory`, `venues_global` | Marketplace scope — excluded from V1 |
| `seating_plans`, `travel_itineraries`, `budgets`, `checklists` | Excluded from V1 |
| `notifications`, `message_threads`, `whatsapp_broadcasts` | Mandatory messaging automation is excluded; delivery log can come later as operational data |
| `ab_tests`, `feature_flags` | Not a domain concept; would leak experiment scaffolding into the customer's data model |
| `roles`, `permissions` beyond `user_roles` | RLS plus an ownership column covers V1; a general RBAC system is a project of its own |
| `teams`, `organisations` | V1 is single-owner weddings. Revisit only when a co-host or planner actually needs shared access |

Two structural cautions:

1. **Do not model a `guest` and a `user` as the same row.** The scaffold's `profiles` and `guests`
   invite exactly that confusion.
2. **Do not store the invitation document twice** — one editable draft body plus one resolved
   snapshot per version is correct; a third "current published content" copy is how the PDF starts
   disagreeing with the page.

---

## Domain invariants (Stage 2 acceptance criteria)

These are written as testable statements because that is how they will be reviewed. Each one should
have either a database constraint, an RLS policy + trigger pair, a server-side check, or an explicit
"not enforced yet" marker in Stage 2's audit.

### Ownership and scope

- **I-01** Every wedding has exactly one owning account (or team context, if introduced). No
  accessible object exists without a resolvable owner.
- **I-02** Events belong to exactly one wedding. An event id from wedding A must not resolve under
  wedding B, including by a privileged-looking query.
- **I-03** Sharing a venue does **not** grant ownership, visibility, or discovery of another
  wedding's data. Venue rows are scoped to their wedding regardless of address equality.
- **I-04** Tradition packs and templates are platform-owned content; customers never edit them
  in place, and no customer row may be interpreted as declaring a customer's caste, religion or
  community.
- **I-05** Language and tradition are chosen by the host. Nothing in the schema may be *derived*
  from a name, phone country, location or guest list.

### Versioning and publication

- **I-06** A published invitation points to an **immutable** invitation version. A publication never
  references "the draft".
- **I-07** An invitation version is immutable after creation; policy and trigger both forbid update.
- **I-08** Editing after approval creates a new version; it cannot mutate an approved one.
- **I-09** Republishing a different version is an explicit, logged action; the previous link either
  moves or stops resolving per an explicit rule, never silently.
- **I-10** A superseded version remains readable for already-sent links until its publication is
  revoked, so a guest tapping an old message is not stranded.

### Approval

- **I-11** An approval belongs to a specific version, and its status is meaningless for any other.
- **I-12** A newer version supersedes older approvals: creating a successor version marks the pending
  approval as invalidated rather than leaving it looking valid. Editing after approval can never
  silently retain approval.
- **I-13** A reviewer cannot see data beyond their approval scope (notably: not the guest list).
- **I-14** Approval decisions are append-only, attributed, and cannot be written by the version's
  own host except in an explicitly allowed self-review mode.

### Guests and RSVP

- **I-15** A recipient link cannot expose the guest list: no household enumeration, no aggregate
  counts that leak invitee identity, no "other guests" affordance.
- **I-16** An event scope cannot grant cross-wedding access, and cannot be widened by a client
  request.
- **I-17** An RSVP only operates on an authorised, scoped recipient/event pair. Submitting for an
  event outside the token's scope is rejected, not clamped.
- **I-18** Guest-submitted data is host-visible and guest-invisible, and supports deletion on request.
- **I-19** One household sees only its own salutation. Per-recipient rendering must not cache or leak
  across households.

### Commerce and entitlement

- **I-20** Payment state cannot be set by a client, on INSERT **or** UPDATE, including via column
  defaults or omitted fields.
- **I-21** Entitlement activation is server-authoritative and follows verified provider confirmation.
- **I-22** Publishing requires the appropriate entitlement where one applies, checked server-side at
  publish time. UI gating is a convenience, not a control.
- **I-23** Order amounts, currency and package identity are computed server-side; provider event ids
  are unique so replays cannot double-grant.
- **I-24** Refunds and revocations reduce entitlement through the same server-authoritative path.

### Operations and privacy

- **I-25** Destructive and trust-relevant actions (publish, unpublish, revoke, export guest data,
  entitlement change, admin action) are recorded with a non-forgeable actor.
- **I-26** Deleting a wedding revokes all tokens, invalidates all links, and removes or archives guest
  personal data per a stated retention rule.
- **I-27** No user-supplied markup or SVG reaches the DOM without passing the sanitisation boundary.
- **I-28** Every trusted column (billing, entitlement, ownership, publication, generation metadata)
  has a passing attack test in the RLS suite, and the suite's assertion count only moves when a case
  is added deliberately.

---

## Invitation versioning design (conceptual — no DB implementation)

### Model

```text
wedding
 └── draft (single, editable)
       ├── content  : structured, host-edited
       └── styling  : direction + tokens + pack selection
              │
              │  create-version (explicit action)
              ▼
       version v1  ── immutable snapshot: resolved content + pack text + design + lineage
              ├── approval request → decision (approve / request changes)
              ├── publication → live URL + token
              └── outputs (page, image, PDF, QR target) rendered from this row
              │
              │  edit draft → create-version
              ▼
       version v2  ── supersedes v1 for new publications; v1 approvals become INVALID
```

### Required properties

| Concept | Requirement |
| --- | --- |
| Editable draft | Exactly one per wedding; freely mutable by the owner; nothing guest-facing may point here |
| Immutable version snapshot | Created by an explicit action; frozen content **with pack/template text resolved into it**; no update path |
| Approval against a version | An approval record names a version id; "approved" is never a property of the wedding or the draft |
| Publication against a version | A publication names a version id; republishing is a new action, logged |
| Superseded version | Lineage (`supersedes_version_id`), plus a computed state: `current`, `superseded`, `revoked`. Superseded versions stay readable for already-sent links until revoked |
| Audit metadata | Who created each version, when, from what, who approved it, when it was published/revoked — non-forgeable |

### Why editing after approval cannot silently retain approval

Because the approval is a statement about bytes that no longer exist. If a host changes a name, a
venue or a blessing after a grandparent approves, and the system keeps showing "approved", then the
thing that reaches 300 guests is a document **no human ever endorsed** — and the product has, with
full plausibility, misrepresented a family's agreement to itself. That is not a status-field bug; it
is the exact failure the approval feature exists to prevent, so the design makes it impossible in
three reinforcing ways:

1. Approvals are keyed to immutable version ids, so there is no referent left to approve.
2. Snapshots resolve pack/template text inward, so "the same version" cannot silently mean different
   text later.
3. Successor creation marks predecessor approvals `invalidated` (visible, historical, never deleted),
   and publication of an unapproved successor is refused server-side.

The UX consequence is a design requirement, not an implementation detail: re-approval must be cheap
enough that hosts actually do it. A one-tap "ask again" on the new version is part of the mechanism
that keeps the invariant honest; if it is painful, hosts will route around it and the invariant
becomes fiction.

---

## Token security design notes (conceptual — no implementation)

Applies to three future unauthenticated flows: **family approval link**, **guest invitation link**,
**RSVP submission link**.

### Principles

1. **High entropy, non-predictable.** Cryptographically random, at least 128 bits of entropy,
   standard URL-safe alphabet. Never sequential ids, never derived from names, dates, wedding ids or
   anything else enumerable — the identifier must not be a partial fact about the customer.
2. **Opaque and server-side looked up.** The token carries no authority itself. The server hashes it,
   resolves scope, and authorises from stored state, so a token cannot be decoded or edited into more
   access.
3. **Revocable, individually.** Each token has its own row and its own state. Revoking one household's
   link must not disturb others; "revoke all links" is a separate, deliberate operation.
4. **Expirable where the semantics allow.** Approval links and pre-event RSVP links expire. A
   guest-facing permanent link needs an explicit lifetime decision plus a renewal path, because a
   wedding invitation is a document people re-open for years.
5. **Avoid sensitive URL query strings.** The token lives in the **path** (`/i/<token>`), never in a
   `?token=` query. Query strings are logged by proxies, CDN and analytics, appear in `Referer`, and
   get pasted with their parameters intact. Path segments are also leak-prone, which is why the token
   must be capability-only and the page must send a `no-referrer` and `noindex` posture.
6. **No full guest-list disclosure by construction.** A guest token resolves one household's scope.
   Even with a valid token, the response contains no other household's name, count, or existence.
   Guess-another-token is infeasible by entropy, and rate limiting plus per-token anomaly signals
   cover the rest.
7. **Rate limiting.** Per IP and per token, on link resolution and especially on RSVP submission;
   submission endpoints need abuse controls because they write data on a public path.
8. **Version and event scope bound into the token.** The token's authority names a specific
   publication/version and event scope, so publishing a new version can invalidate old links as a
   decision, and a scoped link cannot drift into broader access.
9. **Store hashes, not tokens.** A read-only database leak must not yield working links. Plaintext
   exists only in the URL the host copies.
10. **Log metadata, never tokens.** Access logs record token *id*, not value.

### Additional requirements per flow

| Flow | Extra requirements |
| --- | --- |
| Family approval | Reviewer identity bound at first use (so a forwarded link is noticed); comments are private to the wedding; no guest-list access at all |
| Guest invitation | Per-household; renders only that household's salutation and scoped events; caching disabled; `noindex, nofollow` so a public link is never crawled |
| RSVP | POST endpoint authenticated by the same token, idempotent per household/event, no enumeration of who else replied, explicit abuse limits |

### Explicitly out of scope

JWT for guest access (bearer tokens in client storage are the wrong tool for a one-tap link);
encrypting the whole payload into the URL (stateless tokens cannot be revoked, and revocation is a
requirement here); short "vanity" slugs as security (a memorable link is fine for a *public* page, not
as the capability that protects a guest list).

---

## Output architecture notes (one design → many outputs)

Per ADR 0004, every output is a **rendering of an immutable version**. Nothing below is implemented in
this stage, and no render pipeline should be built until the version model exists.

| Output | Nature | Key requirements and risks |
| --- | --- | --- |
| **Live page** | Client/server rendered HTML at the published URL | Must be fast on mid-range Android inside a chat-app browser, reflow at 360px, work without JS where feasible, and never expose the guest list; `noindex` on token-bearing URLs |
| **OG preview** | Image + title/description served on link unfurl | Generated **server-side at publish/version time**, cached and version-pinned, sized for WhatsApp's crop; must not be personalised (a share image is public-ish and cannot reveal a household name) |
| **Static image** | Fixed-format render for family groups | Same token-derived type scale as the page; legible at chat thumbnail size before tap; aspect-ratio variants, not separate designs |
| **PDF** | Paginated document, archival and print-prep | Deterministic fonts (embedded Indic subsets), page sizes, hyphenation and text selection; server-rendered from the same snapshot; large-file generation must not block a request |
| **QR** | Encoding the published URL | Printed at real sizes with verified contrast; a QR is a promise about a *URL*, so revocation/persistence policy must be settled before anyone prints one |
| **Print-ready asset** | Bleed, crop marks, CMYK expectations, spot-colour/foil notes | The hardest output: colour management differs from screen. Allowed to adjust units/colour space only — **never** to fork layout truth |
| **Video** (later) | Timed render | Optional, never a dependency; cost and queue characteristics are entirely different; excluded from V1 |

Cross-cutting requirements:

1. **Determinism.** Same version + same inputs → same output. Reproducibility is what lets us answer
   "the PDF doesn't match the link" with evidence.
2. **Fonts are the shared risk.** Browser and server rendering must resolve the same font files, or
   Indic shaping and metrics diverge between screen and PDF. This must be proven early with a real
   Tamil sample, not assumed.
3. **A per-output manifest.** Each artefact records version id, output kind, render timestamp, render
   config hash and its own revocation/lifetime state.
4. **Generate at publish, render on demand for the page.** Immutable content should not be
   re-rendered per guest; the live page should be the only on-demand surface, and its cold-start cost
   is a design input.
5. **No new layout truth in renderers.** A renderer needing an off-token special case means the token
   set or the version schema is incomplete — fix that instead.
6. **Sanitisation stays at the boundary.** Any SVG or markup inside a version passes the existing
   sanitiser regardless of output target; a server-side renderer is not a weaker boundary than the
   client.

Stages 3 and 9 own the actual pipelines. This section exists so that stage does not start from
"the page is already a special case".

---

## What Stage 2 should decide first

1. `projects` → `weddings`: rename-in-place, or a fresh aggregate plus a migration path. (Everything
   else is downstream of this.)
2. Where the editable draft body lives, and the exact shape of a version snapshot.
3. Whether people/venues/recipients start as JSON, with the promotion criteria written down now.
4. Deletion of the unused scaffold tables (`guests`, `orders`, `payments`, `printers`,
   `activity_logs`) versus claiming them — decided explicitly, per table, with a reason.
5. The publication/token route contract, before any UI claims "share".
6. Which invariants above are enforced by constraint, by policy+trigger, by server code, and which are
   knowingly deferred — recorded as a table in the Stage 2 audit, with attack tests for every trusted
   column.

---

# Stage 2 outcome

Recorded after implementation and qualification. Nothing above this line was edited except the two
status notes at the top. Assertion counts below are the numbers the suites printed when they were
last run; [`../audits/stage-2-domain-database.md`](../audits/stage-2-domain-database.md) carries the
run context, and `supabase/tests/stage2/run.sh both` reproduces them.

## The six opening questions, answered

1. **`projects` → `weddings`: rename or fresh aggregate?** **Fresh aggregate, with the scaffold
   archived.** The blueprint's own necessity challenge ("if we do not need fields beyond
   title/language/guest_count, the honest answer is *alter `projects` into `weddings`*") was
   overtaken: the canonical `weddings` needed an owner column whose default could not be forged, a
   status vocabulary, a design link with referential meaning, and a style column with a type
   constraint — and `projects` carried `paid_status` whose whole history is a false-authority problem
   Stage 0 had already repaired twice. Altering that table in place would have kept the compromised
   column as the thing under edit. Instead `weddings` is new, ids are **preserved** from
   `projects.id` (M01, M06), and `projects` moved to the `legacy` schema unreadable by every API role.
   The cost of that choice is real and is stated in §Reversibility below.
2. **Where does the editable draft body live, and what is a version snapshot?** One
   `invitation_drafts` row per wedding with a jsonb `content` body (never a second copy of the
   document, per the blueprint's caution), and `invitation_versions.snapshot` as the frozen resolved
   document. Enforced shape: `UNIQUE (wedding_id)` on drafts, no UPDATE or DELETE policy plus a guard
   trigger on versions, and `supersedes_version_id` for lineage.
3. **Do people / venues / recipients start as JSON?** People and venues became **tables**
   (`wedding_people`, `venues`) because both are referenced by rows (`wedding_events.venue_id`,
   approval and RSVP flows) and both grow per wedding. **Recipients did not become anything**: the
   household is the V1 unit, and a per-recipient row would promise personalisation the renderer does
   not exist to deliver. The promotion criterion is written down in
   [`domain-model.md`](domain-model.md) §8 rather than left as a code comment.
4. **Delete or claim the unused scaffold tables?** Claimed unchanged: `profiles`, `user_roles`.
   Superseded by new canonical tables and then archived: `projects`, `templates`, `guests`, `orders`,
   `payments`, `printers`, `activity_logs`. Nothing was dropped, because the money and activity rows
   are evidence about claims already made to real people; deleting them would have been the same
   erasure the deletion guards in `1204`/`1208` exist to prevent.
5. **The publication/token route contract?** **Deliberately not decided here**, because Stage 2 does
   not render. What was fixed is the storage half: `private.access_tokens` holds a SHA-256 digest in a
   `UNIQUE` column with `id` as primary key (so rotation replaces a value without replacing a row),
   plus `token_kind`, `wedding_id`, `publication_id`, `household_id`, `expiry_policy`, `expires_at`,
   `revoked_at`. No route, no minting code, no guest flow.
6. **Which invariants are enforced by what?** The table below, which is the same classification the
   blueprint asked for.

## Invariant disposition

| Invariant | Stage 2 state | Mechanism, and the executed check |
| --- | --- | --- |
| I-01 one owning account | **enforced** | `weddings.owner_user_id` NOT NULL, no client-supplied default path; every scoped table NOT NULL `wedding_id` (C49); two-way owner isolation, group 4 (56 assertions across 13 tables) |
| I-02 an event cannot resolve across weddings | **enforced** | `UNIQUE (wedding_id, id)` pins plus composite FKs; group 12 rejects 12 cross-wedding references |
| I-03 a shared venue grants nothing | **enforced by construction** | venues are per-wedding rows; there is no global venue table to join through, so address equality carries no relationship |
| I-04 catalogue is platform-owned, no identity inferred | **enforced** | no write policy on `design_templates`/`tradition_packs` (C22) + guard triggers (groups 7, 8); identity-vocabulary scans C43/C44 and `scripts/domain-contract.test.mjs` |
| I-05 language and tradition are chosen, never derived | **enforced for the migration** | M11–M15: an unmapped language persists as NULL ("unknown"), no pack is inferred from a language or a template name; nothing in code sets `tradition_pack_id` at all yet |
| I-06 a publication names an immutable version | **enforced** | `publications.version_id` FK pinned to the wedding; no publication can name a draft (there is no draft column) |
| I-07 a version is immutable | **enforced** | no client write policy + `no_client_write_invitation_versions`; group 7 (the owner's own rewrite refused), group 8 (still refused with privilege and permissive policy granted), group 11b (a frozen version pins its wedding even for a trusted role) |
| I-08 editing after approval cannot mutate an approved version | **half enforced, by design** | mutation is impossible (I-07); *creating* the successor is the action no code performs yet, so the invariant currently has no actor. It is Stage 3's first obligation, not a Stage 2 gap to paper over |
| I-09 republishing is explicit and logged | **not enforced yet** | `publications` is append-only with `revoked_at`, so the state machine is representable; `private.audit_events` has **no writer in product code**, so "logged" is not true. No publish path exists at all |
| I-10 a superseded version stays readable until revoked | **representable, untested** | lineage + status columns exist; there is no link to resolve, so nothing can be observed. Stage 3 owns it |
| I-11 an approval names a version | **enforced** | composite FK `(wedding_id, version_id)`; group 12 rejects a request pinned to another wedding's version, and group 7 rejects the owner answering for their own reviewer |
| I-12 a successor invalidates pending approvals | **constrained, not performed** | `status IN (…,'invalidated')` with `CHECK (invalidated_at IS NULL OR status = 'invalidated')`; the marking action needs the version-minting path from I-08 |
| I-13 a reviewer sees no guest list | **not applicable yet** | there is no reviewer identity: no login, no token, no policy that could grant a reviewer anything. `reviewer_display_name`/`reviewer_contact_text` are labels on a server-authored row |
| I-14 decisions are append-only and attributed | **enforced, more strictly than asked** | `approval_feedback` has no client write policy *at all*, so the host cannot write a decision either; delete refused by group 11c |
| I-15 a recipient link cannot expose the guest list | **enforced by absence** | `anon` holds no privilege on any canonical table (group 1, C11) and no household read path exists. The render-time guarantee is Stage 3's |
| I-16 a scope cannot widen across weddings | **enforced** | `household_event_scopes` composite FKs, group 12 |
| I-17 an RSVP answers only a scoped pair | **enforced at the relational layer** | FK to the scope's full PK — an out-of-scope answer is unrepresentable, not merely disallowed; the token-scoped half is Stage 8 |
| I-18 guest data is host-visible, guest-invisible, deletable on request | **two-thirds** | visibility enforced (no guest read path exists); the deletion-on-request flow is Stage 13 and needs the retention decision that Stage 2 refused to invent |
| I-19 one household sees only its own salutation | **not applicable yet** | no per-recipient row exists by decision (§3 above), and no read path exists for any household |
| I-20 payment state is not client-settable on INSERT or UPDATE | **enforced, and the column is gone** | no monetary or billing column exists in `public` at all (C41); `entitlements` refuses client INSERT, UPDATE and DELETE (group 7, 19 probes) and its trigger refuses even a privilege-granted write (group 8). Stage 0's INSERT-path bypass is the reason both paths are attacked here |
| I-21 activation follows verified provider confirmation | **enforced by construction** | nothing can write `entitlements` from an API role, and no trusted path in this build ever sets a row `active`; `source` is restricted to `service`/`admin_manual` |
| I-22 publishing requires an entitlement, checked server-side | **not enforced yet** | there is no publish path to gate, and no gate was faked in advance. Stage 10 owns it |
| I-23 amounts, currency and package identity server-side; provider ids unique | **deferred deliberately** | no order or payment table exists in the canonical domain — the blueprint assumed one, and Stage 2 refused to introduce a money shape before a real provider. `package_code` is a code, never an amount; the replay case is covered only by `one_active_entitlement_per_wedding_package`, which is not a provider-event idempotency guarantee |
| I-24 refunds reduce entitlement on the same path | **representable, unwired** | `status`/`revoked_at` with `CHECK ((status = 'active') = (revoked_at IS NULL))`; no caller |
| I-25 destructive actions recorded with a non-forgeable actor | **partial** | non-forgeable attribution exists where the row is server-authored (`invitation_versions.created_by`, `private.access_tokens.created_by_role`, both unwritable by clients); the durable trail table exists with an `actor_user_id` and **no writer**. Recorded as the largest honest gap in this stage |
| I-26 deleting a wedding revokes tokens and archives guest data | **diverges from the blueprint, on purpose** | the blueprint said deletion should cascade to everything guest-facing. Measured behaviour: an owner may delete a wedding that is still only theirs (group 11 working data), but a recorded entitlement, a frozen version or a publication **refuses** the delete (11a, 11b, 11c) and existing credentials outlive the attempt (11e). Money-adjacent and evidence-bearing history does not vanish with the aggregate. The retention rule is Stage 13's |
| I-27 nothing un-sanitised reaches the DOM | **enforced, client-side** | `src/lib/sanitizeSvg.ts` + its tests; database-provided design artwork passes through it before insertion. There is no upload path and no server renderer yet, so there is no second boundary to hold |
| I-28 every trusted column has an attack test; counts move deliberately | **enforced** | group 7 + group 8 cover every server-authored table; totals are printed per run — **322 security assertions per chain is what Stage 2 closed with**, and the current head prints its own larger count as later stages add tables (see the Stage 3 audit's final battery) — and are recorded in the audit |

## What the blueprint got wrong, in its own words

Three places where reality disagreed with the proposal, kept visible because they are the useful part
of a decision record:

* **`recipients` (§10) was premature.** The blueprint's own table-vs-JSON rule rejected it as soon as
  the renderer was admitted not to exist. The household is the unit that V1's semantics support.
* **`orders` / `payments` (§17) were not promoted.** The blueprint treated a canonical order table as
  obviously needed. With no provider, no price and no checkout, a money table would have been a shape
  invented in the dark that later stages would have to migrate twice.
* **"Deletion cascades to everything guest-facing" (§1) was the wrong default.** It is the one
  invariant the executed suite overturned by measurement: a cascade deletes as the child table's
  owner, so a guard trigger named for the client can never see it. History that must survive a
  wedding now refuses the delete through referential integrity instead. See
  [`stage-2-migration-plan.md`](stage-2-migration-plan.md) §7.1 for the experiment.

## Reversibility

The migration is forward-only and no down migration exists. What that costs:

* **Reversible in principle:** the two retained tables (`profiles`, `user_roles`) were not reshaped;
  privilege and policy state is declarative and can be re-applied.
* **Not reversible without a restore:** rows were **moved** into `legacy`, not copied, so a rollback
  to the pre-Stage-2 schema needs the archived rows moved back, and any canonical row created after
  the move has no legacy counterpart to return to.
* **Actively hostile to rollback:** the deletion pins added in `1204`/`1208` mean an operator who
  wants to unwind a wedding's history must delete child rows in a specific order. That friction is
  the point; it is also something to know before an incident, not during one.
* `legacy` holds the scaffold's data with no reader anywhere in the product, so it is a growing
  archive whose disposal is undecided. Stage 13 owns that decision.

Do not read the above as "rollback is available". It is not, automatically. A restore from backup is
the rollback plan.
