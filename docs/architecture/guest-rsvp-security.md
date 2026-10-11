# Guest households, personalised links and event-scoped RSVP — the Stage 8 contract

> Status: **design**. This file is written before the migration it describes, because the directive for
> Stage 8 requires the policies, immutable/history boundaries, abuse resistance, data minimisation and
> teardown strategy to be settled before coding. Every claim about the state this stage inherits is a
> reading of a file at `333803f85293050d7282a55af5ceda67caed11c0`, with its path and line range, not a
> recollection of an earlier stage. Where a decision here refuses a convenient option, the reason is
> recorded next to it, because the next reader needs the reason more than the ruling.
>
> Related: [`public-invitation-security.md`](public-invitation-security.md) (Stage 3's wedding-level
> door), [`family-approval-review-security.md`](family-approval-review-security.md) (Stage 7's
> relative-level door), [`domain-model.md`](domain-model.md) (the aggregate),
> [`decisions/0005-server-authoritative-commerce.md`](decisions/0005-server-authoritative-commerce.md).
> The execution record, including what was measured rather than assumed, is
> [`../audits/stage-8-guest-rsvp.md`](../audits/stage-8-guest-rsvp.md).

---

## 1. What Stage 8 opens, and what it inherits already built

Stage 8's product shape is: a host keeps a list of guest *households*, decides which of the wedding's
events each household is invited to, sends each household its own link, and that link's bearer — a
relative with a phone, no account, no app — reads the published invitation and answers for the events it
was invited to. The host can also record an answer that arrived by phone, and can read and manage what
has come back.

The schema for all of that already exists. Stage 2 wrote it as reserved shapes and no later stage used
them, which is the reason this design is mostly a *credential and door* design rather than a table
design:

| inherited object | where it was created | what it already guarantees |
| --- | --- | --- |
| `public.guest_households` | `supabase/migrations/20260925120300_stage2_guests_approvals_rsvp.sql:18-30` | `display_name` non-blank (`:21`), `salutation` deliberately free text (`:22-24`), `expected_party_size` NULL-or-positive (`:25`), `host_notes` on the same row (`:26`), `UNIQUE (wedding_id, id)` (`:29`) as the FK target that makes "this household belongs to this wedding" unforgeable |
| `public.household_event_scopes` | same file `:46-58` (its index `:60-61`) | PK `(wedding_id, household_id, event_id)` (`:51`); two composite FKs (`:55-57`) so a scope row cannot pair one wedding's household with another wedding's event |
| `public.rsvp_responses` | same file `:70-95` (its index `:97`) | `attending IN ('attending','declined')` (`:78`), `party_size >= 0` (`:79`), `response_source IN ('guest','host_manual')` with the note that `'guest'` "is only writable by the backend (Stage 8)" (`:80-83`), `answers` a jsonb **object** (`:84-87`), `UNIQUE (wedding_id, household_id, event_id)` (`:90-92`) — one current answer per household and event — and a FK from that triple onto `household_event_scopes` (`:93-94`), which is what makes an out-of-scope answer unrepresentable rather than merely disallowed |
| host write policies | `20260925120500_stage2_rls_and_grants.sql:222-299` | household and scope rows: owner `SELECT`/`INSERT`/`UPDATE`/`DELETE` (`:222-268`); RSVP: owner `SELECT` (`:270-273`), `INSERT` and `UPDATE` **only where the new row says `response_source = 'host_manual'`** (`:278-294`), `DELETE` (`:296-299`) |
| table privileges | same file `:27-46` (SELECT list) and `:50-61` (write list) | `authenticated` can already select and write these three tables under those policies; `anon` holds nothing at all (`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` at `:19-21`, `REVOKE ALL ON SCHEMA public FROM anon` at `:21`) |
| the guest credential kinds | `20260926130000_stage3_publication_resolution_boundary.sql:180-214` | `token_kind IN ('public_invitation','guest_invitation','rsvp','approval_review')` (`:184` — Stage 3 added only the first), and a `guest_invitation` row is already required to carry `publication_id IS NOT NULL AND household_id IS NOT NULL AND approval_request_id IS NULL` (`:203-205`). Stage 3's reason for adding a kind instead of narrowing `guest_invitation` is at `:175-179` |
| the credential store | `20260925120400_stage2_assets_entitlements_secrets.sql:120-199` | `token_hash` 64-hex CHECK and never the secret (`:122-125`), `household_id` (`:137`) with `FOREIGN KEY (wedding_id, household_id) REFERENCES public.guest_households(wedding_id, id)` (`:169`), `expiry_policy` in its three-value vocabulary (`:143`) under the `fixed ⇔ expires_at IS NOT NULL` biconditional (`:149`), client-write and client-delete refusal triggers (`:183-186`), RLS enabled with **no policies** so a later accidental `GRANT` reveals nothing (`:188-194`), and DML granted only to `service_role` (`:198`) |
| the frozen document | `20260925120200_stage2_versions_and_publication.sql:10-54`, `20260927120000_stage4_tradition_pack_releases.sql:1172-1391` | `invitation_versions.snapshot` is immutable by trigger, `publications` is not client-writable at all, and `private.public_invitation_dto(integer, jsonb)` is the one guest-facing projection of that snapshot — schema version 2, twelve-name whitelist, all-or-nothing |

Two things in that table decide most of the shape of this stage. The first is that `guest_households` is
**not** part of the frozen snapshot: Stage 3's projection comment lists it among what the snapshot omits
(`20260926130000...:273`), so personalisation cannot be put into the published document and does not need
to be. The second is that the host's own write path for households, scopes and manual replies is already
policy-covered, so Stage 8 adds **no table privilege to any role** — the whole claim that Stage 7's audit
had to prove about `approval_requests` ("no new table privilege to any client role") is a property this
stage inherits rather than one it needs to create.

## 2. Three credential families, and the separation made structural

The directive asks that family-approval credentials, guest credentials and cultural-authority review stay
fully separated. Three kinds, three doors, three headers — and then the separation stated as something a
schema can check rather than something code can remember:

| family | kind | bound to | door functions | header | who holds the secret |
| --- | --- | --- | --- | --- | --- |
| the wedding's own link | `public_invitation` | `(wedding, publication)` | `api.resolve_public_invitation` | `x-invitation-token` | anyone the host forwarded one URL to |
| a household | `guest_invitation` | `(wedding, publication, household)` | `api.resolve_guest_invitation`, `api.submit_guest_rsvp` | `x-guest-token` | that household alone |
| a relative's review | `approval_review` | `(wedding, approval_request, approval_version)` | `api.resolve_family_review`, `api.submit_family_review` | `x-review-token` | that reviewer alone |
| cultural authority | *no token at all* | a maintainer's local session | `internal_api.approve_tradition_pack_release`, `internal_api.submit_tradition_pack_review` — `SECURITY INVOKER`, revoked from `PUBLIC, anon, authenticated, service_role` with no browser grant (`20260929120000_stage5_pack_driven_authoring_review.sql:2056, 2171-2173, 2175, 2233`) | — | the maintenance CLI, offline |

Three separations are enforced by construction, and one is not:

* **Pointer separation.** Each kind's row-shape CHECK names which scope columns may be set
  (`20260926130000...:199-212`), and each door's lookup pins `token_kind` in the predicate
  (`20260926130000_stage3_publication_resolution_boundary.sql:1005-1009` for the wedding-link door today;
  Stage 7 `:394-408` and `:567-580` for the review door). A
  household's secret presented at the review door is not "rejected after thought" — it is a row that
  does not satisfy that door's join, and it answers with the same bytes as a forged one.
* **Cross-wedding separation.** Every scope pointer is a *composite* FK whose first column is
  `wedding_id` (`20260925120400...:168-171`), so no statement can point wedding A's credential at
  wedding B's household.
* **Authority separation.** The cultural-authority path has no credential, no anonymous door and no
  browser grant at all; Stage 7 §7 (`20261008120000_stage7_family_approval_review.sql:779-796`) already
  forbids merging the anonymous review door with pack-release status, and this stage adds nothing to it.
* **What is *not* separated today, and is fixed here.** The `guest_invitation` and `rsvp` branches of the
  shape CHECK (`20260926130000...:203-208`) each say `approval_request_id IS NULL` but are silent about
  `approval_version_id`, unlike the `public_invitation` branch which says both (`:199-202`). With
  `MATCH SIMPLE` FK semantics, a `guest_invitation` row can therefore be written that also carries an
  `approval_version_id` — a household credential pointing at a family-approval version, which is exactly
  the cross-family state the directive forbids. Nothing can produce that row through any function that
  exists today (no mint path sets it), so this is a latent gap rather than a live defect, and the honest
  repair is forward: `2.` below.

**Ruling 2.1 — tighten the two guest branches forward.** Stage 8's migration adds
`AND approval_version_id IS NULL` to the `guest_invitation` and `rsvp` branches, reproducing the other
three branches word for word, in the same style Stage 3 used when it replaced `access_tokens_check3`
(`20260926130000...:186-214`) — including Stage 3's discipline of measuring the constraint's real name
from `pg_constraint` rather than guessing it. No historical migration is edited. The tables are empty on
every chain (measured: `guest_households`, `household_event_scopes` and `rsvp_responses` appear in
neither `20260925120600_stage2_migrate_legacy_projects.sql` nor
`20260925120700_stage2_archive_legacy_scaffold.sql`), so `VALIDATE` has no row to fail on and the
tightening cannot strand an existing deployment.

**Ruling 2.2 — one credential per household, of kind `guest_invitation`; `rsvp` stays unused.** The
vocabulary offers two guest kinds. Minting both would mean two secrets per family, and would create a
state the product does not want — a household that can read its invitation but cannot answer it, or the
reverse. One kind, like Stage 7's `approval_review` which serves its door's read and its door's write,
keeps "who may answer" identical to "who may read". `rsvp` therefore remains an unused vocabulary value
whose shape CHECK this stage still tightens; a battery case asserts that no verb Stage 8 exposes can
produce a row of that kind, so the unused value is a documented state, not a forgotten one.

## 3. The household credential

**Minting.** `api.issue_guest_invitations(p_wedding_id uuid, p_household_ids uuid[], p_expires_at timestamptz DEFAULT NULL)`,
`authenticated` only, owner-gated with the uniform host refusal Stage 3 established for "not signed in",
"not your wedding", "no such wedding" — one SQLSTATE and one message for all three
(`20260926130000...:539-548`), so the shape of a wedding the caller does not own is not discoverable.
For each requested household it does one of three things and says which:

* no live credential exists → revoke nothing, mint one, return `status: 'issued'` with `path`;
* a live credential exists → mint nothing, return `status: 'already_live'` with `path: null`.

The second arm is the load-bearing one. It exists because a raw credential is legible exactly once —
`private.mint_public_invitation_token` returns the value and stores only its SHA-256 digest
(`20260926130000...:505-533`), and Stage 7 built the same one-shot property for review links
(`20261008120000...:127-133`, "shown once" in the audit's terms). Re-running "send the links" must not be
a way to see a secret a second time, and must not be a way to make a second live secret for one family.

**Ruling 3.3 — no household link can exist before the wedding has an active publication, and the verb
says so in those words.** The kind shape is not Stage 8's to loosen: the `guest_invitation` branch of
`private.access_tokens`' shape CHECK reads `publication_id IS NOT NULL AND household_id IS NOT NULL AND
approval_request_id IS NULL` (measured from the live `pg_constraint` row for `access_tokens_kind_shape`,
as `20260926130000_stage3_publication_resolution_boundary.sql:203-205` writes it), because Stage 2 pinned
a household credential to a *publication* rather than to a wedding. So "create the families, then send the
links" is not a sequence this schema can express before the couple has published: the mint would have no
`publication_id` to store. `api.issue_guest_invitations` and `api.rotate_guest_invitation` therefore check
for the active publication and refuse without one — `publish the invitation before sending household links`
— in the same shape Stage 3's rotate uses for the wedding link ("there is no published invitation to
rotate", `20260926150000...:388-391`). The host screen states the prerequisite rather than discovering it
through a greyed-out button, and the batteries count it as a named case rather than an empty array.

**Uniqueness.** A partial unique index, matching the two that exist:
`one_live_public_token_per_publication` (`20260926130000...:219-223`) and
`one_live_token_per_approval_request` (`20261008120000...:900-904`).

```sql
CREATE UNIQUE INDEX one_live_guest_token_per_household
  ON private.access_tokens (household_id)
  WHERE revoked_at IS NULL
    AND token_kind = 'guest_invitation'
    AND household_id IS NOT NULL;
```

Its purpose is the one Stage 3 stated for its own index (`:215-218`): if a bug double-mints, the bug
surfaces as a `unique_violation` in a battery rather than as a second live secret that no screen can list.

**Secret arithmetic.** 32 random bytes, base64url without padding, 43 octets, stored only as a SHA-256
hex digest — `rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=')` and
`encode(extensions.digest(convert_to(v_raw,'UTF8'),'sha256'),'hex')` (`20260926130000...:515`, `:520`),
with the lookup-side digest computed identically (`:992`; Stage 7 `:394`, `:567`). No timing-safe
comparison is added, for the reason recorded at `20260926130000...:487-504`: the probe is a unique-index
equality on a digest, not a string walk.

**Ruling 3.1 — the digest is written inline in the new bodies, not in a new `private` helper.** Stage 7
made the same choice and recorded the reason (`20261008120000...:346-352`): `private`'s function
inventory is counted by head-aware catalogue assertions, and a helper added here shifts a census that
every earlier stage's battery reads. The cost is two copies of a two-line expression — one in the issue
body, one in the rotate body — and the batteries pin both by making a credential minted by one arm
resolve at the door and the other arm's replacement resolve instead, so a divergence cannot hide.

**Expiry.** `p_expires_at` is host-supplied or absent, and absent means `no_expiry`, reusing the
derivation `CASE WHEN p_expires_at IS NULL THEN 'no_expiry' ELSE 'fixed' END` (`:524`) and the
`fixed ⇔ expires_at IS NOT NULL` biconditional (`20260925120400...:149`). Liveness is the same single
predicate the wedding door uses — `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
(`20260926130000...:1007-1008`) — and the host-side state read mirrors the correction Stage 3 had to make
when `link_active` once lied about an expired-but-unrevoked credential (`20260926150000...:477-487`).

**Ruling 3.2 — `expiry_policy = 'event_date'` stays unused.** It is in the vocabulary
(`20260925120400...:143`) and nothing implements it, because there is no wedding date to point at:
`public.weddings` has no date column (measured at `20260925120100_stage2_canonical_domain.sql` — the
aggregate's own columns are `title`, languages, pack, template, `style_settings`,
`estimated_guest_count`, `lifecycle_status`); dates live on `wedding_events.starts_at_local` as
wall-clock facts without a time zone ("a muhurtham is a wall-clock fact", `:145-153`). Implementing
`event_date` would mean deriving an expiry from the *event rows of a particular version*, which is a
second liveness rule sitting beside the one every existing door asserts against. A guest link that
outlives the wedding is a housekeeping matter for the host — who can revoke it, and who is told its state
— and it is recorded as such in §12 rather than quietly presented as handled.

**Revocation and replacement.** `api.revoke_guest_invitation(p_household_id uuid)` sets `revoked_at =
now()` on that household's live row and reports whether there was one, in the captured-boolean style
Stage 3 had to adopt for its own takedown (`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:74-99`
for the story of what `FOUND` did wrong, `:345-359` for the fixed body: whether a credential
row existed must not decide whether the thing it guards stops being live). `api.rotate_guest_invitation(p_household_id uuid)`
is the one-shot replacement: revoke first, then mint, in that order and in one transaction, as rotation
already works at the wedding door (same file `:407-410`) — so a failed mint can never leave two live
secrets, and a successful one never leaves the old link resolving.

What rotate carries across is the household's deadline, not a fresh one — with one case it cannot
carry. A successor row is written with `created_at = now()`, and `access_tokens` requires
`expires_at > created_at` (`20260925120400_stage2_assets_entitlements_secrets.sql:150`), so copying an
already-expired instant onto it would abort the call with a `23514` from a constraint no host has ever
seen, after the transaction had already taken the old row `FOR UPDATE`. Rotate therefore refuses a link
whose deadline has passed, in the same actionable register as its "no live link to rotate" arm, and the
host's answer is the pair of verbs that already exists: `api.revoke_guest_invitation`, then
`api.issue_guest_invitations`. Silently turning an expired link into an un-expiring one would be the
host's decision made by a button labelled "new link", so the code does neither.

**Host-side state read.** `api.get_guest_invitation_state(p_wedding_id uuid)` returns, per household:
`display_name`, `salutation`, the `link_state` vocabulary Stage 7 already published for its queue
(`never_issued` / `live` / `revoked` / `expired`, computed at `20261008120000...:264-267` and spelled out
in the COMMENT at `:916`), `expires_at`, `last_used_at`, the count of events scoped and the count of
replies received. It returns **no token material of any kind**, the same rule its sibling documents
verbatim ("No token material of any kind is returned", `20260926130000...:877`). It is an RPC rather than a
client query for one reason only: the link state comes from `private.access_tokens`, which no browser role
may read (`20260925120400...:188-199`).

**`last_used_at`, and why this stage writes it.** Stage 7 was the first thing in the product to use the
column Stage 2 declared, and it stated the purpose exactly: the stamp is written on each successful review
read so that "the link was opened, and when" is evidence the host can see
(`20261008120000...:340-343`, stamped at `:427`). The guest door takes the same rule, for the same
reason and with the same honesty about what it does not prove. A host who wonders whether Aunt Bea ever
saw the invitation gets a real answer; a host who wants to know whether *she personally* was the one at the
phone does not get one, because a household link is held by a household and the page never claims
otherwise. `api.resolve_guest_invitation` therefore stamps `last_used_at = now()` on the credential row it
just matched, as part of the same transaction that reads the document, and it does so **only on a
successful read** — a forged, revoked or expired token cannot move the field, so the value cannot be
poisoned by someone probing for live links. That last clause is a battery case (L-series), not an
assumption.

## 4. The two anonymous doors

Both follow Stage 7's door exactly, because that door is the shape this repository has already qualified
at three tiers.

**`api.resolve_guest_invitation()` takes no arguments.** Deliberately, and the reason is measured rather
than stylistic: PostgREST v16.3 answers a `GET` that names a parameter with HTTP 200 against an
argument-taking volatile function, so a credential in a query string would *work* — which is the failure
Stage 3 removed by deleting the parameter (`20260926130000...:937-958`, with the `PGRST202` behaviour
recorded at `:953`). With zero arguments, a request that names one cannot reach SQL. The credential
arrives in `current_setting('request.headers', true)::jsonb ->> 'x-guest-token'` (the live read is at
`20260926150000...:528-529`, Stage 7's equivalent at `20261008120000...:388`), and
the client-side shape gate `/^[A-Za-z0-9_-]{43}$/` runs before any request is made, so a hopeless link
earns zero round trips (`src/integrations/supabase/publicInvitation.ts:38-42`, its test at
`src/test/publicInvitationTransport.test.ts:39-57`).

The read door also stamps `last_used_at` on the credential row it matched, on success only, for the
reason and with the limits recorded in §3.

**`api.submit_guest_rsvp(p_answers jsonb)` takes answers but never a credential.** The credential is
header-only even in the write; that is the whole content of the two contract rules Stage 7 added for its
own door (`scripts/check-product-contract.mjs:204-225`, `guest-door-called-with-arguments` and
`reviewer-door-called-with-arguments`), and Stage 8 adds the household pair to the same list: a call site
that passes the credential as an argument becomes a build failure, not a review comment.

**Refusal bytes.** Both doors answer, for every credential problem, the same indistinguishable thing the
existing doors answer: `{"available": false}` on read, `{"recorded": false, "reason": "unavailable"}` on
write, with missing header, malformed shape, unknown digest, revoked, expired, cross-household and
withdrawn-publication all producing those bytes (`20260926130000...:960-964` for the rule, Stage 7
`:371-464`, `:507-641` for the shape as built). A guest cannot learn which of those states a link is in,
which is what makes the *count* of households and the *existence* of an event undiscoverable through
probing.

**Ruling 4.1 — the guest door's answer-shape is separate from its credential-shape.** Invalid *input*
(a party size above the household's expected size, an event the household was not shown) is an
actionable problem for the guest and must be distinguishable; invalid *access* is not. So the write
response has exactly two families: `reason: 'unavailable'` (a single token covering every credential,
scope and publication state, including a named-but-unscoped event id, so no probe can tell "not yours"
from "does not exist"), and a bounded vocabulary for correctable answers
(`'party_size_too_large'`, `'answers_not_accepted'`). The set is closed by CHECK in the body, and the
battery asserts that no message from the second family can be produced by a credential problem.

**Ruling 4.2 — a malformed *body* is a third thing, and it is refused before the credential is looked at.**
The paragraph above lists "malformed shape" among the credential problems because that is what it means at
the *read* door, where the only malformed thing is a header that is not 43 characters. At the write door a
malformed body is not a credential state and must not wear `unavailable`'s bytes: the guest's own page has
to be able to tell "this form was filled wrong" from "this link is dead", and a refusal that cannot be
named is a refusal nobody can act on. So `api.submit_guest_rsvp` raises `23514` with one sentence —
`the answers submitted are not in the shape this invitation records` — for a body that is not an object,
that names no `events` array, that names an empty one, or whose cards miss or mistype `event_id`,
`attending` or `party_size`, and it does so before reading `request.headers`. Two consequences are part of
the ruling rather than accidents of it: a probe learns nothing about a credential from a body it refused
(`22` malformed bodies × 2 header states all raise the body's own sentence, asserted as group A's `A0`),
and no malformed body can ever reach a table constraint, because the guard that would have caught it reads
the type of a key that is *absent* as `jsonb_typeof(NULL)` = SQL NULL, which is not `<>` anything.

That last clause is the reason this ruling is written down as a ruling. The first body of the function
tested each key with `jsonb_typeof(x) <> 'string'`, which is NULL — not true — for a missing key, so the
four guards were silent on exactly the input they existed to refuse. The results were a `{}` body returning
`{"recorded": true, "events_recorded": 0}` (a thank-you for an answer that named nothing), and a card
missing `attending` or `party_size` passing every guard and aborting inside the `INSERT` on that column's
own `NOT NULL` (`20260925120300...:78-79`) — a `23502` naming a table and a column, delivered to an
anonymous caller, which is the same disclosure the uuid-as-text test at `:797-802` exists to close,
arriving by a different route. Each guard now names absence itself (`:760`, `:793`, `:805`, `:815`).

## 5. Personalisation without touching the frozen document

The obvious implementation of "personalised invitation" is to freeze a document per household. This
stage does not do that, and the reasons are structural rather than economical:

1. `one_active_publication_per_wedding` (`20260925120200_stage2_versions_and_publication.sql:90-92`)
   makes "the published invitation" singular. N per-household publications would either break that index
   or require it to be narrowed, and narrowing it changes what Stage 3 and Stage 7's batteries assert.
2. `invitation_versions.snapshot` is immutable by trigger (`:50-54`), so a greeting written into it
   could only be changed by minting a new version — which is a *publication event*, with all the
   host-visible consequences that has, every time a host corrects a spelling in a salutation.
3. The snapshot is the document the wedding link and the reviewer's page render too
   (`src/pages/PublicInvitation.tsx:101`, Stage 7's reviewer payload `20261008120000_stage7_family_approval_review.sql:371-464`), so
   putting one household's name into it would show that name to every other bearer of a link. That is
   the inverse of the privacy requirement.
4. Guest personal data in an immutable, versioned, host-editable document means a wrong guess about a
   family's name is preserved forever in a structure the product cannot rewrite (the whole forward-only
   discipline, stated in `decisions/0006-database-rpc-publication-boundary.md:130`: "No historical
   migration was edited").

**Ruling 5.1 — the guest page is the frozen invitation plus a live overlay of one household's own
facts.** `api.resolve_guest_invitation` returns
`{ available: true, guest: <overlay>, invitation: <the schema-v2 DTO> }`, where `invitation` is produced
by the *unmodified* `private.public_invitation_dto` (`20260927120000_stage4_tradition_pack_releases.sql:1172-1391`)
and `guest` is hand-built here with the same whitelist discipline. Consequences that are the point of
the ruling: preview/freeze/publication parity survives exactly as Stage 5 built it; a household's
greeting is never visible to another household; a corrected salutation needs no republish; and the
snapshot schema version stays 2, so no historical publication becomes unreadable by this build and this
build's documents stay readable by an earlier renderer.

**The overlay's contents, and why each is there.**

| field | source | justification |
| --- | --- | --- |
| `greeting` | `guest_households.salutation`, falling back to `display_name` when null (`20260925120300...:22-24`) | the "personalised greeting", from a column Stage 2 made free text precisely so no schema would encode an assumption about family structure |
| `events[]` | this household's live `household_event_scopes` rows joined to their enabled `wedding_events`, in the same order the document lists events (`display_order, starts_at_local, id`), each carrying the household's own current answer (§6) | the household's own invitation list, and nothing else |
| `expected_party_size` | the household row | needed to explain a refusal, and to let the guest answer honestly about who is coming |
| `can_respond`, `responds_until` | derived: publication active ∧ credential live ∧ the household has at least one scoped, enabled event, plus `expires_at` | the page must not offer a form that will refuse; Stage 3's `link_state` correction is the precedent for deriving rather than assuming (`20260926150000...:477-487`) |
| `responded_at` per answered event | `rsvp_responses.responded_at`, folded into the event item it belongs to | "when did we say" is the guest's own fact |

**Measured correction, 2026-10-09, taken before any code was written — the frozen document cannot carry
the join this section first described.** The first draft of this table said the household's events were
"live scopes *intersected* with the frozen snapshot's events, by event id", and §6 said "the answer *key*
is the event id, which is a uuid the guest was given". Both rest on a premise that measurement refutes:
**the frozen document contains no event id.** `private.build_invitation_snapshot` writes each event item
as `event_key, display_name, starts_at_local, ends_at_local, timezone, venue`
(`20260927120000_stage4_tradition_pack_releases.sql:1127-1142`) and the schema-v2 projection passes those
names through unchanged (`:1366-1380`) — `invitation_versions.snapshot` never carries
`wedding_events.id`. And `event_key` is not a per-event identity: the host editor writes the same constant
into every event row, `HOST_DEFINED_KEY = 'host_defined'`
(`src/integrations/supabase/weddingContent.ts:53-57, :371`), precisely because a key derived from what the
host typed "would read as a claim about somebody's relative". So neither name in that sentence can be
resolved, and a design that intersected by `event_key` would have paired one household's answer with
*every* event of the wedding.

Three ways out existed, and the third is the one taken:

1. **Put `event_id` into the snapshot and the DTO.** Rejected: it edits the payload all three consumers
   render (`§13`'s own warning that a payload change moves every door's battery), it makes a machine
   identifier part of a frozen cultural document, and every version published before this stage would
   still lack the key — so the household door would need a second, weaker matching rule for them anyway.
2. **Match frozen items to live rows positionally.** Rejected: the snapshot's order is the live order at
   freeze time, so any event added, removed or re-ordered after publication silently mis-pairs a guest's
   answer with the wrong ceremony. That is a correctness bug in the privacy-critical direction, and it is
   undiscoverable from the guest's side.
3. **The overlay lists the household's live scoped events; the frozen document stays the document.**
   Adopted. The invitation the guest reads is `private.public_invitation_dto` untouched, and the answer
   panel underneath it is this household's own `household_event_scopes` rows joined to their enabled
   `wedding_events` rows, with the live uuid issued by the server and accepted only on that household's
   own credential. §6's one-sentence rule survives intact and is now expressible: the scope table was
   always declared to be "the authority on *may this household answer*", and it is also the authority on
   *what they may answer*.

Consequences of the third, stated as plainly as the mechanism: an event scoped after publication **is**
offered an answer control (its own live name and time are shown in that control, so the guest is never
asked to answer an unlabelled question) even though the frozen document does not describe it — the host's
move is to republish, and §6's table now says so; and an event whose `display_name` was edited after
publication shows its live name in the answer panel while the document above shows the published one.
That divergence is visible on one screen, which is the honest place for it: the couple's remedy is a
republish, and nothing here silently rewrites either side.

**What the overlay must never contain, stated as a rule with teeth:** another household's name,
salutation, answer, or existence; the count of households or invitees; `guest_households.host_notes` (the
host's private notes *about* a family — which the guest must not read, and which no guest-facing
projection may name); `wedding_people` (the couple's own people list); any other event than this
household's; entitlements or `estimated_guest_count`; every approval request and every piece of approval
feedback; and token material of any kind. Two of these are the reason the door is an RPC and not a
`SELECT` with a join the client can steer: `host_notes` sits on the same row as the greeting, so a
projection that "just returns the household row" would hand the host's private notes to the guest. The
battery checks for this by writing a recognisable marker into `host_notes` and asserting the marker is
absent from the response bytes and from the rendered page.

**Ruling 5.2 — the overlay is built in SQL, one hand-built `jsonb_build_object`, never a row.** This is
Stage 3's posture for the anonymous path ("the anonymous path is read-only and returns one hand-built
projection, never a row", `20260926130000...:90-91`) and it is kept, because a row-shaped return would
make `host_notes` one `SELECT *` away under a future edit. The all-or-nothing rule is inherited too: if
the invitation projection is `NULL`, the door answers `available: false` rather than serving a greeting
with no invitation behind it (`20260927120000_stage4_tradition_pack_releases.sql:1387-1389` for the
`WHEN OTHERS THEN RETURN NULL` posture — a different file from the one cited just above, and the only
place that exception handler exists).

## 6. Event scope, and the five places live and frozen disagree

`household_event_scopes` is live; the invitation the guest reads is frozen. The directive asks for
"correct frozen-version, event-scope and publication behaviour", and the honest design has to say which
side wins in each case where they differ. The ruling is one sentence, applied five times: **the guest
sees the frozen document; the guest may answer only what is both frozen and scoped; the record is the
live scope's.**

| disagreement | behaviour | why |
| --- | --- | --- |
| an event is scoped after the version was published | it **is** offered an answer control, labelled with that event's live name and time (§5's correction), while the frozen document above it still does not describe it; the host's screen shows the household as not-yet-replied for it | the scope row is the host's act of inviting that family to that event, and refusing the answer would strand a family the host has already included; the host's answer to the document not describing it is to republish, which is a decision they own |
| an event in the frozen document is removed from the household's scope | it still *appears* in the invitation (the document is frozen) but carries no answer control; a reply row that already exists stays, because deleting it would be a silent rewrite of what the household said | the scope table is the authority on "may this household answer", not on "what does the document say" |
| an event row is deleted | the scope FK is `NO ACTION` (`20260925120300...:57`), so the deletion is refused while a reply row references it; the host screen must surface that as "replies exist for this event" | a host losing a family's answer by deleting a card is data loss through a UI click |
| a household has zero scoped events | the door still reads (the invitation is public to that household) but `can_respond` is `false`, and the host's panel flags the zero-event scope as a data error to fix | Stage 2's own comment: a zero-event scope "is treated by later stages as a data error to surface, not a silent 'invited to nothing'", and a CHECK cannot express "at least one row exists" (`:43-45`) |
| an event is disabled (`enabled = false`) after publication | it is not offered and not answerable — the write door answers the same `unavailable` it answers for an unscoped event — while the frozen document still describes it, and any answer already given stays on the record | `enabled` is the host taking a card out of the running; a reply for an event the host has disabled is kept because deleting it would rewrite what the family said, exactly as the removed-scope row above is treated |

`responds_until` is the credential's own `expires_at` [MEASURED CORRECTION, 2026-10-09: this paragraph
first said the event list and the answer key "come from the intersection above" and that "the answer *key*
is the event id, which is a uuid the guest was given". There is no such intersection to take them from —
see §5's correction — and no uuid was ever in the document. The sentence below is the repaired version],
and the event list is this household's live scope. The answer *key* is the `wedding_events.id` uuid the
door put in front of the guest, so a submitted answer cannot name an event by a guess: an id that was not
issued to this household either is not a scope row (refused with the generic `unavailable`) or does not
exist (refused with the same bytes). The FK from
`rsvp_responses` onto `household_event_scopes` (`:93-94`) is then the last line of defence: even a bug in
the body cannot write an out-of-scope answer, because the row's own key would not exist to point at.
Stage 2 called this "enforced by making a response key itself an existing scope row, instead of a
cross-table CHECK (which PostgreSQL cannot evaluate over other tables)" (`:67-69`), and Stage 8 relies on
it as written.

## 7. RSVP write semantics

* **One current answer.** `UNIQUE (wedding_id, household_id, event_id)` is the whole model, and Stage 2
  chose it with this stage in mind: "One current answer per household/event: a repeat submission
  overwrites, and UNIQUE doubles as the index PostgreSQL will not create for a referencing FK"
  (`20260925120300...:90-92`). `api.submit_guest_rsvp` therefore upserts the household's rows for the events
  it names, in one transaction, all-or-nothing — a partially applied set of answers would leave the host
  holding a split household.
* **Revision is allowed; that is not a defect.** A guest who mis-taps must be able to correct it, and
  the only record that matters is the household's latest position. This is the answer to the directive's
  "replayed credential" requirement, and the distinction is worth stating plainly: a review credential
  spends an *ask* (Stage 7's `submit_family_review` refuses a second answer to the same request, and its
  battery counts one row), while a household credential answers a *question that stays open*. Replay of
  a **revoked, expired or withdrawn** household credential is refused, and that is what the battery
  measures; replay of a live one overwrites, and the row keeps `responded_at` from the latest write.
* **No answer history.** The directive asks for immutable/history boundaries, and the boundary here is:
  the *invitation* is immutable, the *household's answer* is not. Adding an append-only revision table
  would retain personal data the product does not use — a superseded party size, an earlier "attending"
  that the family withdrew — against a stated requirement to treat RSVP details as private personal
  information. Stage 2's own reserved design has no history for answers while it does for approval
  feedback (`approval_feedback`, `:154-182`), and the difference between the two is not an oversight:
  a reviewer's verdict is evidence about a document, a guest's headcount is a fact about who is coming.
* **Party size.** A guest answer is capped at `expected_party_size` when the host set one (the CHECK's
  other arm is NULL, meaning no expectation and therefore no cap — `:25`). The refusal is the actionable
  `'party_size_too_large'`, worded so the guest can act on it. **The cap is not applied to host manual
  entries**: when a family phones to say three more are coming, the host is transcribing a fact rather
  than exercising a permission, and `expected_party_size` is an expectation, not a quota. The asymmetry
  is deliberate and is one of the cases the battery must name rather than merely cover.
* **Source authority, and who may change what.** The guest's own submission is the more authoritative
  record, so upserting over a `host_manual` row is allowed and the row's `response_source` becomes
  `'guest'`. The reverse is blocked by inherited policy and stays blocked: `owners_update_manual_rsvps`
  requires `response_source = 'host_manual'` in its **WITH CHECK**
  (`20260925120500_stage2_rls_and_grants.sql:285-294`, a different file from the column definitions
  quoted above), which is PostgreSQL's way of saying a host cannot save an edit that presents a guest's
  answer as the host's own, and cannot write a `'guest'` row from the client at all (the matching INSERT
  policy at `:278-283` for that file). The host who genuinely needs to
  correct a family's answer does it where the correction is honest — delete the reply (`:296-299` in the
  same file) and
  record a manual one — and the host screen will say so in those words rather than offering a silent
  overwrite. **No Stage 2 policy is edited or weakened for convenience in either direction.**
* **`answers` stays small and stays an object.** The column is reserved for optional questions
  ("meal, transport, accommodation", `:84-87`). This stage asks no such question, and will not let a
  guest write arbitrary prose into a host's database: the body accepts `attending` and `party_size`
  only, and writes `answers` as the empty object. A forward CHECK then bounds the column that will carry
  those later answers — object-typed (already `:87`) and bounded in total stored size.
  [MEASURED CORRECTION, 2026-10-09: this first promised "at most eight keys, each value a string of at
  most 200 characters", which no CHECK can say. A table CHECK may not contain a subquery and
  `jsonb_object_keys` is a set-returning function, so neither a key count nor a per-value type test is
  expressible in a constraint — the same limitation Stage 2 cites for "at least one row exists"
  (`:43-45`). The implementable form is a ceiling on the column's stored text,
  `octet_length(answers::text) <= 2000`, which stops the object becoming a megabyte the way
  `invitation_drafts_section_length_bound` (`20260926130000...:158-169`) stops prose doing so, at the cost
  of being a total bound rather than a per-key one. The per-key rule belongs to the body: this stage's
  body accepts no answers and writes `'{}'`, and whichever later stage starts accepting them owns the
  key-by-key discipline in the RPC that validates them.]
* **Deletion of a household is not a way to delete its answers silently.** `household_event_scopes`
  cascades from the household (`:55-56`), but `rsvp_responses` references it with `NO ACTION`
  (`:93-94`), so removing a family that has replied is refused until the replies are removed. The screen
  shows the count first. (Ruling: no schema change. Making the delete cascade would turn one click into
  an irreversible loss of a family's answer, which is the opposite of what a "manage replies" screen is
  for.)
* **And a household that has ever been sent a link cannot be deleted at all, by the rule this schema
  already states.** `private.access_tokens` pins a household with
  `FOREIGN KEY (wedding_id, household_id) REFERENCES public.guest_households(wedding_id, id)` and no
  `ON DELETE` clause (`20260925120400_stage2_assets_entitlements_secrets.sql:169`), which is `NO ACTION`,
  and the rows it writes are evidence rather than working data: Stage 2 chose that action for exactly this
  reason at the wedding level — "a minted credential is evidence of who was let in, so it does not vanish
  as a side effect of a wedding removal" (`:129-131`), with the refusal "verified rather than assumed" as
  an accepted consequence (`:132-134`) — and `20_attacks.sql` group 11e asserts it as *refused, and
  destroys nothing* (`docs/architecture/stage-2-migration-plan.md:188`). Before Stage 8 no household row
  could be on the receiving end of that rule, because nothing minted the kind; from this stage one sent
  link freezes one family's row. Ruling: no schema change and no seventh verb. A verb that deleted
  credential rows would be a browser-reachable way to erase the record that a link was issued, which is
  the thing group 11e exists to keep, and it would be the only erase path in this product that takes a
  secret's history with it.
* **What the host can still do, and what the screen must therefore say.** `revoke` the link — the family's
  address stops resolving immediately, which is the outcome "remove this family" is usually asked for —
  rename them, change their salutation, scope and un-scope their events, and delete their replies, all
  through the policies at `20260925120500...:222-299`. What is not available is removal of the row, and a
  control that promised it would be a button that fails. So the household panel offers **withdraw link**
  and offers **delete family** only where `link_state` is `never_issued` — a UI rule with its battery case
  in §14 item 6, and the same honesty rule that stopped Stage 7 from labelling a bearer token an identity.
  The refusal is a `23503` naming a table the browser can see, so the battery asserts its cleanliness and
  not only its code: household row, scope rows and replies all still present afterwards, the way group
  11e proves it for the wedding.

## 8. Where the new verbs go, and the surface rule that decides it

Stage 6 and Stage 7 landed on the same sentence from opposite directions, and Stage 8 inherits it as the
test for each new capability: **secrets and cross-row computations go behind `api` wrappers; host-owned
content moves through table grants and owner policies.** So the new surface is six functions, and every
one of them either mints/reads a credential or serves an anonymous door:

| new `api` wrapper | roles | why it is an RPC and not a table read |
| --- | --- | --- |
| `issue_guest_invitations(uuid, uuid[], timestamptz)` | `authenticated` | returns raw secret material |
| `rotate_guest_invitation(uuid)` | `authenticated` | same |
| `revoke_guest_invitation(uuid)` | `authenticated` | writes `private.access_tokens` |
| `get_guest_invitation_state(uuid)` | `authenticated` | reads `private.access_tokens` link state |
| `resolve_guest_invitation()` | `anon, authenticated` | anonymous door; zero arguments (§4) |
| `submit_guest_rsvp(jsonb)` | `anon, authenticated` | writes `rsvp_responses` with `response_source = 'guest'`, which no client may do |

Household CRUD, event-scope editing, manual RSVP recording, and the host's reply list are **not** new
functions. They are the three tables under the twelve owner policies that already exist — four each,
`20260925120500...:222-244` for households, `:246-268` for scopes, `:270-299` for replies — reached from
one new adapter module (`src/integrations/supabase/`), which is what `canonical-table-read-outside-the-adapter`
(`scripts/check-product-contract.mjs:252-263`) is built to keep in one place. The thirtieth reason for
the split is the one Stage 7 recorded about its own minting surface: the smaller the set of paths that
can write a credential table, the shorter the list a reader must trust
(`docs/architecture/domain-model.md:402` — "the whole minting surface" is enumerable because it is).

Each implementation body is `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''` behind a one-line
`LANGUAGE sql SECURITY INVOKER` wrapper, in `internal_api`, which is not served by PostgREST
(`supabase/config.toml:32` lists `public` and `api`; `20260926150000...:101-105`), with the single
`GRANT USAGE ON SCHEMA internal_api TO anon, authenticated` that the wrapper layout forces
(`:111`, whose measured rationale is at `:54-72`). Grants follow the house grammar exactly — revoke from
`PUBLIC, anon, authenticated` by exact identity, then grant to the exact list, with `service_role` absent
from both halves of every `api`/`internal_api` pair because "it is not a browser"
(`:628-660` in that same file, Stage 7's restatement at
`20261008120000_stage7_family_approval_review.sql:859-861`, its grant block at `:868-886`).

**Ruling 8.1 — `publish_invitation_version` and `revoke_invitation_publication` are re-declared to move
household credentials with the publication they govern.** Today the retarget in publish touches only
`token_kind = 'public_invitation'` (`20260926150000...:264-286`) and the takedown revokes only that kind
(`:339-342`). Without a change here, a host publishing a corrected version would strand every household
link on a revoked publication — each family's link would answer `available: false` while the wedding's own
link worked. That is a wrong behaviour, not merely an unwritten one, and the direction of each fix is set
by the precedent it extends:

* **publish re-pins** every live `guest_invitation` row of that wedding to the new publication, in the
  same statement style as the existing retarget, so a family's saved link keeps working across a revision
  — which is precisely the property Stage 3 argued for when it chose retargeting over re-minting
  (`20260926130000...:98-107`). `api.rotate_invitation_token` keeps its kind filter, so rotating the
  wedding link cannot touch a household's.
* **takedown revokes** every live credential of that wedding, both kinds. Revoking a publication means
  the *content* is withdrawn; leaving 40 household links live after a takedown would be a breach of the
  host's decision, so the widening here is a security tightening, not a relaxation, and `tokens_revoked`
  counts it honestly.

**Ruling 8.2 — no new table privilege, no new role grant, no new exposed schema.** The count of
`api`-reachable schemas stays two (`config.toml:32` untouched), `private` keeps zero grants to browser
roles, and the SELECT/write lists in `20260925120500...:27-61` are not edited. The catalogue assertions
in `stage2/40_catalog.sql` that watch for exactly this kind of drift are widened for the new head, not
silenced, and Stage 8's own battery re-asserts the negative: `anon` still holds nothing, and no
household-scoped table is reachable by a browser role except under an owner policy.

## 9. Privacy invariants, named so a test can hold each one

| # | invariant | how it is enforced | which tier can actually see it |
| --- | --- | --- | --- |
| P1 | A household credential reaches only its own household's overlay and answers | the door's lookup pins `token_kind`, `household_id` comes from the credential row, never from an argument | SQL, HTTP, browser |
| P2 | No guest ever sees another household, its name, its answer, or that it exists | hand-built projection with no aggregate over other households; refusal bytes identical for every access failure | SQL (count-shaped probe), HTTP, browser |
| P3 | `host_notes` never crosses the guest door | the projection names no such key; a marker written into the column is asserted absent from response and DOM | HTTP, browser |
| P4 | A guest link never reveals approval requests, feedback, or the couple's people list | the overlay is built from household rows only; the invitation half is the same DTO the wedding link renders, which already omits them (`20260926130000...:273`) | SQL, HTTP |
| P5 | RSVP details are written by the guest or by the host's own hand, never conflated | `response_source` pinned in the policy WITH CHECK (`20260925120500...:278-294`) and set only inside the DEFINER body | SQL, HTTP, unit |
| P6 | A credential appears in a response exactly once, at the call that minted it | `path` returned only when minted; `get_guest_invitation_state` names no token column | SQL, HTTP, browser |
| P7 | The secret never reaches an **API** request URL, a function argument, a stored key, or a log line — the paragraph under this table states the URL it *does* reach | zero-argument resolver + header transport. Stage 3's wedding door and Stage 7's review door are pinned by two contract rules (`check-product-contract.mjs:204-225`) and this door is the third of the three (`household-door-called-with-arguments`, `:226-239`), which sends `x-guest-token` | unit, HTTP, browser (network observation) |
| P8 | Nothing about a guest is inferred into anything ceremonial | `guest_households` has no ceremony-bearing column; the projection cannot name a section it was not given; the checker's Stage 4/5 identity rules already forbid a derivation from name/place/language to a tradition (`check-product-contract.mjs:288-373`) | unit, checker self-test |
| P9 | A guest's own data is the only personal data its page can hold | overlay fields enumerated in §5 and asserted key-by-key; a new key in the response is a battery failure | HTTP |
| P10 | A withdrawn or republished invitation refuses on both doors at once | ruling 8.1's takedown widening, plus `revoked_at`/`status` predicates in the one liveness join | SQL, HTTP |

[MEASURED CORRECTION, 2026-10-11: P7 was written as "the secret never reaches a URL", and that sentence
is false as stated — this stage's own §11 journey and `src/lib/guestInvitation.ts:78-81` contradict it on
every run, because the product mints the household's address as `/g/<credential>` and
`src/pages/GuestDoor.tsx:408` reads the credential back out of that route parameter (`const { token } = useParams…`).
The correction narrows the claim to the hop the mechanism actually governs, in the words Stage 3 already used for the
wedding link: "The **browser address** is still `/i/<token>` — a shareable link has to carry its own
credential, and there is no other channel to the guest" (`docs/architecture/public-invitation-security.md:85-89`).
What is eliminated here is the *API* hop repeating the secret, which is a real and measured difference:
`api.resolve_guest_invitation` takes zero arguments, so no request line of any call to PostgREST carries
it, whereas a parameter-taking function would have accepted `GET /rest/v1/rpc/…?p_raw_token=…` (§4). The
residual is the same size as the wedding link's and is disclosed rather than argued away: the household's
credential sits in that guest's **browser history**, in any **same-origin log that records request
paths**, and in **hosting/CDN request logs** for `/g/<token>`, which is the limit Stage 3 stated for its
own path (`public-invitation-security.md:109-113`, restated at `docs/audits/stage-3-public-invitation.md:1024`
and `:1527`) and the limit ADR 0006 recorded as a design cost at
`docs/architecture/decisions/0006-database-rpc-publication-boundary.md:63`. A referrer policy changes what
leaves the browser toward other origins; it cannot unwrite a URL from the places a URL is written.
Consequently two things follow rather than one. The household link is a bearer credential in the strictest
sense — anyone holding that guest's history or the hosting logs holds one household's view, which is the
blast radius §10 already states — and the Stage 8 browser tier must re-measure the `/g/` page's outgoing
requests for this shape rather than inherit Stage 3's `no measured request carried the credential in
Referer` (`public-invitation-security.md:101`), because that measurement was taken of a different route
and different page. **That re-measurement is not yet run:** the browser tier needs the local stack and a
production build, and both were blocked for the whole of this segment (Docker engine not running, engine
start human-only). P7 is therefore recorded as unit- and HTTP-qualified on the API hop and unmeasured on
the guest page's own request surface, not as a passed invariant.]

## 10. Abuse resistance, stated with its limits

Mechanically present: 256-bit secrets with digest-only storage and a unique-index equality probe; the
43-octet shape gate on both sides; refusal bytes that give a prober nothing; a partial unique index that
turns a double-mint bug into a visible `unique_violation`; per-household event scoping that makes an
out-of-scope answer a key that does not exist; a party-size cap that stops a guest inflating the host's
headcount; an `answers` bound that stops prose being written into a host's database; grants that make the
credential table invisible over REST; the FK-composite discipline that makes cross-wedding pointers
inexpressible; and a browser-tier observation that no credential leaves the loopback interface (Stage 7's
tier already measures this shape: "no credential of this pass reaches a host outside this machine").

Mechanically **absent**, and a non-claim of this stage: there is no rate limiter, no lockout, no CAPTCHA
and no per-IP throttle, because every one of them sits behind an edge function, a paid provider or a
hosted configuration that the directive forbids, and the repository has no application server of its own.
What a leaked household link therefore grants is exactly one household's own view and one household's own
answers, which is the blast radius this design aims at; and what it does not grant — another family's
data, a host's notes, the ability to raise the count beyond the household's expected size — is what P1,
P3 and the cap are for. Stating this as a limitation rather than presenting the credential as an identity
is required by the same honesty rule Stage 7 closed on: possession of a link is not verified human
identity.

One further limit is not about missing machinery but about where a bearer credential has to live, and it
is stated here so §9's P7 cannot be read as a clean claim: the household's address is `/g/<credential>`,
so the secret is in that guest's browser history and in any log that records request paths, exactly as the
wedding link's is (§9's correction of 2026-10-11, citing `public-invitation-security.md:85-89`). Rotating
the link retires the old secret at the door but does not remove it from those places, so a withdrawn
household's past address stops *resolving* while remaining *legible as a string* to whoever kept it. No
mechanism in this repository — and none a static frontend can have — takes it back.

## 11. Mobile-first and accessible, as a contract rather than a wish

Guests open this link in a WhatsApp or Chrome in-app browser on a phone, often one-handed, often outdoors.
The requirements Stage 3 and Stage 6 established for that same page are inherited rather than restated:
the guest route mounts no auth provider (`src/App.tsx:81-85` carries Stage 3's repair and the wedding
route, and the household's own `/g/:token` sits beside it at `:95`), the page renders the
same `InvitationRenderer` as the host preview so what the couple checked is what the guest reads, tap
targets are at least 44 px (Stage 6 closed 18 sub-44 px targets and the browser tier re-measures them),
and the sweep runs at Android-representative widths — 320, 360, 393, 430 — on the shipped `dist/`, not on
a dev server.

For the form specifically: each event's answer is a `fieldset` with a `legend` naming the event;
`attending`/`declined` are radio inputs, not clickable divs, so the state is reachable by keyboard and
announced by a screen reader; `party_size` is a numeric input with an accessible name and an explicit
range hint carrying `expected_party_size` when set; every error is associated with its control by
`aria-describedby` and also announced in an `aria-live` region, because a refusal that appears only as red
text is not a refusal the guest can find; submitting moves focus to the confirmation rather than leaving
it under a vanished button; a slow door shows a disabled-in-form state rather than a dead button; and
`prefers-reduced-motion` is respected by the inherited token set. The greeting is rendered as **text**:
`salutation` is host-authored free text, so a family's name containing `<` must appear as `<`, and the
markup-sink rule (`check-product-contract.mjs:436-452`) already fails a build that writes HTML — a unit
test puts a hostile salutation through the shape layer and asserts it neither becomes markup nor is
dropped.

## 12. Teardown, and what each tier may leave behind

Three tiers write real rows against real databases, so teardown is a design item rather than a cleanup
habit:

* **SQL tier** runs on a throwaway `postgres:16-alpine` container built by the runner and destroyed by
  its own `EXIT` trap, the pattern `stage7/run.sh:74-75` exists for. Its batteries wrap in transactions
  that roll back where the suite's own contract says so, and where they must commit — because a later
  file reads what an earlier one wrote — the runner says which, as Stage 7's `90_review_boundary.sql`
  does for the rows `80_family_review.sql` committed.
* **HTTP tier** runs serially against the shared local stack, which is the only place a leak check has
  teeth: `supabase/tests/api/run.sh` censuses named tables before and after and compares
  (`:88-105`, `:166-190`). Stage 8 extends that census with `guest_households`,
  `household_event_scopes`, `rsvp_responses` and a filtered count of `private.access_tokens` where
  `token_kind = 'guest_invitation'`. Both the total and the filtered line are wanted, for different
  reasons: the unfiltered `access_tokens=` line already catches a leftover row by arithmetic, but with 40
  rows on the table it cannot say *which kind* leaked, and "a household credential was left live" is a
  different finding from "a review token was left live". The suite tears down its own fixtures so before
  equals after on every line.
  The comparison must stay honest under a stable pre-existing baseline — Stage 7 measured that a
  1/1/1 baseline produced by an interrupted earlier run still gives the leak check teeth, because both
  sides are the same numbers (`docs/audits/stage-7-family-approval.md` §21).
* **Browser tier** creates accounts, a wedding, households, links and answers through the shipped UI on
  `127.0.0.1:4173`, and its teardown reports the counts it removed, the way Stage 7's did
  ("0 weddings, 0 asks, 0 feedback, 0 credentials, 0 accounts"). Stage 8's line adds households, scopes
  and replies. If a tier is interrupted mid-run — as the shared engine's death interrupted one Stage 7
  run — the residue is reported, not silently deleted, and never removed by resetting the shared stack.
  Teardown order is a consequence of §7 rather than a convenience: because a credential pins its household
  and its publication with `NO ACTION`, and `private.access_tokens` refuses client deletes by trigger
  (`20260925120400...:183-186`), no fixture family that received a link can be cleared through the UI at
  all. So every tier's removal runs in Stage 2's stated erasure order — credentials first, by the trusted
  role; then replies and households; then the wedding — and the tier asserts the order by reporting a
  non-zero residue when a step is skipped, rather than discovering it as a `23503` mid-cleanup. The same
  sentence is why the census in the HTTP bullet can promise before equals after: it is only true of a suite
  that deletes in that order.
* **Containers**: this stage creates only containers named for this stage, on the engine a human started;
  it removes them by the name it printed, and proves absence with a presence count taken *after* the
  removal, because `docker rm -f` against an absent name prints nothing and exits 0 on this engine
  (measured and recorded in Stage 7's §21). The six `supabase_*_localvivaahvarnam` containers are not
  reset, restarted or removed; the `_dueweave` and `p3c-*` containers are not touched at all.

## 13. Deliberate non-changes

Recorded because a reader who looks for them next stage will otherwise assume they were overlooked:

* **No `invitation_recipients` table.** Stage 2's phase-19 decision promotes an individual to a row only
  "when it needs its own token or its own answer" (`20260925120300...:8-12`). A household link answers
  for the household and carries one party size, so the criterion is not met, and adding identities now
  would create a second identity space with no query that needs it.
* **No snapshot schema version bump.** The overlay lives outside the document (§5), so
  `snapshot_schema_version` stays 2 and `private.public_invitation_dto` is not touched — which is also
  why Stage 7's warning that "both doors' batteries have to move together" (`20261008120000...:469-483`)
  does not fire in this stage: it fires on a *change to the payload*, and Stage 8 changes none. What
  Stage 8 does is make that payload three-consumer instead of two — wedding link, review door, and now
  the household door — so the coupling Stage 7 named keeps growing, and the household battery becomes one
  of the suites that has to move with any future payload edit. That is a cost of the reuse, and it is
  recorded as a cost rather than as a benefit.
* **No new language codes, packs, sections or renderer kinds.** Nothing in the guest door needs one.
* **No guest-facing uploaded media.** Stage 6's private asset protections are inherited unchanged; the
  guest page shows the frozen document, which already carries what the host published, and a
  household-specific image would need its own reviewed access model — a separate stage's work, not a
  clause added here.
* **No email/SMS delivery of household links.** There is no provider and no edge function. The host
  screen reveals each link once, to be copied; it does not claim delivery it cannot perform.
* **No rate limiting, no expiry by event date, no answer history** — each for the reason given in its
  section, and each listed again in §14 so they are not mistaken for oversights.

## 14. What qualification must prove, written before it is run

The batteries are the contract's test, so the obligations are listed here rather than discovered later.
Nothing in this list is a re-statement of an inherited suite; the inherited ones (Stage 2's 464 RLS
attacks, Stage 3's publication and transport groups, Stage 4's document battery, Stage 5's review
binding, Stage 6's registry and policy batteries, Stage 7's family-review and boundary batteries) are
re-run at every Stage 8 head that can affect them, on both migration chains.

1. **Shape.** The credential row that `issue` writes satisfies the tightened kind CHECK; a
   `guest_invitation` row cannot carry an approval pointer (2.1); a second live mint for one household
   raises `unique_violation` rather than producing a second secret.
2. **Both doors, every failure mode, at all three tiers**: no header, malformed shape, well-formed but
   never-issued, forged, expired-by-setting, revoked, rotated-away, household deleted, publication
   revoked, publication re-pinned by a new version. Each produces the one refusal shape and writes
   nothing — which for the read door includes `last_used_at`, a field only a successful read may move
   (§3).
3. **Cross-door**: a household secret at the wedding door, the wedding secret at the household door,
   either secret at the review door — all refused with identical bytes, all with zero writes.
4. **Cross-tenant**: household B, credential B, event of wedding A, another host's wedding — every
   combination refuses, and no probe distinguishes "not yours" from "does not exist".
5. **Scope**: an answer for an unscoped event cannot be written (the key does not exist); the five
   live/frozen disagreements in §6 each behave as ruled.
6. **Semantics**: revision overwrites and keeps one row; a guest upsert over a `host_manual` row takes the
   source; a client cannot write or edit a `'guest'` row; party size above `expected_party_size` refuses
   actionably, and the host's manual entry is not capped (7); and the deletion freeze §7 rules holds —
   `DELETE` of a household that has ever been issued a credential refuses, and destroys nothing (the
   household row, its scope rows and its replies all still present afterwards), the way Stage 2's group
   11e proves the same for a credential-bearing wedding.
7. **Privacy**: P1–P10 each have a named case, including the `host_notes` marker and the household-count
   probe; no response of the guest door names a token column.
8. **Publication behaviour**: publish re-pins live household credentials; takedown revokes both kinds;
   rotating the wedding link leaves household links alone; the guest page shows the *published* version
   after a re-publish and never a draft.
9. **Bundle and render**: the guest chunk measured from `dist/`, the four-journey browser tier on those
   same bytes, the viewport and tap-target sweep, the network observation that a credential crosses no
   host outside loopback, and the masking of every 43-octet run in every capture before it reaches the
   evidence directory.
10. **No gate is called green without running it, and the final SHA has its own green run.**

## 15. What this design does not settle

Three items are genuinely open and are named rather than smoothed over. First, the wording of guest-facing
refusals — the one sentence — is a product-copy decision that must pass the same truth rules as the rest
of the interface, and it is settled in the implementation pass with its own assertions, not here. Second,
whether a household link's default lifetime should be finite at all is a host-workflow question this stage
answers only by making it settable; §3.2 records why nothing derives it from the calendar. Third, the
expected interaction between `weddings.estimated_guest_count` and the household list is unmodelled today:
the count is the host's own rough number and nothing reconciles it with households actually created, and a
later stage that shows both on one screen will have to decide which one is authoritative rather than
letting the two disagree on a customer's page.
