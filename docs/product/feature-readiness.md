# Feature readiness matrix

This is the anti-delusion document. Its purpose is to stop a future contributor (human or agent)
from reading a table name, a UI label or an unused component and concluding that a capability
exists.

**Definitions**

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Works in this build **and was actually exercised here**. A user can do the thing today. |
| `FOUNDATION` | Real code or schema exists that the feature will be built on, but the user-visible capability is incomplete or placeholder. **Not shippable as a claim.** This also covers code that is complete in source yet depends on an external environment (a configured Supabase project, email delivery) that this stage never verified. |
| `PLANNED V1` | Designed in these documents. No meaningful implementation. |
| `LATER` | Deliberately after V1. |
| `EXCLUDED` | We have decided not to build this. Reintroducing it needs a scope change, not a feature PR. |

Verified against this repository as of the Stage 3 public-invitation audit
([`../audits/stage-3-public-invitation.md`](../audits/stage-3-public-invitation.md)), on top of the
Stage 2 domain and database audit
([`../audits/stage-2-domain-database.md`](../audits/stage-2-domain-database.md)) that replaced the
scaffold tables with the canonical domain. The app reads and writes `weddings` and
`design_templates` through `src/integrations/supabase/weddings.ts`, publication through
`publication.ts`, and a guest reads one invitation through `publicInvitation.ts` — three modules, and
`product:check` refuses a canonical-table query outside them. The scaffold tables it used to name
(`projects`, `templates`, `guests`, `orders`, `payments`, `printers`) are archived in the `legacy`
schema, which no API role — `service_role` included — can reach. Canonical tables that **no product
code reads or writes yet** still exist (`guest_households`, `rsvp_responses`, `approval_requests`,
`approval_feedback`, `household_event_scopes`, `wedding_assets`, `entitlements`, `user_roles`,
`tradition_packs`, …); reading rule 1 applies to every one of them.

**What "verified" means here, because it changed in Stage 3.** Stages 0–2 never ran a Supabase
instance, so anything needing one was `FOUNDATION` by definition. Stage 3 runs against a **real local
stack** — Kong, PostgREST 16.2, GoTrue, PostgreSQL 17.6 on the platform images — with real JWTs, real
RLS and real HTTP, driven from a browser and from `@supabase/supabase-js`. So a row below may now say
"exercised against the verified local stack": that is what closes Stage 2's declared gap. **Nothing is
deployed and no hosted project was touched**, so no row may claim a hosted customer can do anything
today, and reading rule 5 still refuses a row that says both at once.

## Accounts and shell

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Sign-up and log-in screens | `IMPLEMENTED` | `Signup.tsx` and `Login.tsx` render with labelled fields and autocomplete values — verified in the browser as public screens |
| Logout control | `FOUNDATION` | The header renders **Log out** only for a signed-in session; no session existed in this stage, so the control was never displayed or exercised |
| Sign-up, log-in and logout against a real project | `FOUNDATION` | Supabase Auth calls are wired in source. No configured Supabase project was verified in this stage, so no account was created or signed in end to end |
| Password reset | `FOUNDATION` | `ResetPassword.tsx` exists; needs a configured auth project plus working email delivery, neither of which was verified |
| Protected routes | `IMPLEMENTED` | `ProtectedRoute.tsx` guards dashboard/create/project routes — verified as redirects while signed out. The signed-in pass-through needs a verified backend and was not exercised |
| Session persistence | `FOUNDATION` | Supabase client defaults; refresh behaviour unverified in this stage |
| Dashboard listing invitations | `FOUNDATION` | `Dashboard.tsx` calls `listWeddings(user.id)` and renders empty/error states; the query is covered by 13 behavioural tests against a hand-written Supabase double, and was never loaded with real data against a verified project |
| Dark mode | `FOUNDATION` | `.dark` token overrides exist in `src/index.css`; there is **no user-facing theme switch** |
| Cookie consent | `IMPLEMENTED` | `CookieConsent` + `CookiePolicy.tsx` — public surface, verified rendering |
| Legal pages | `IMPLEMENTED` | Terms/Privacy/Cookies — written as provisional, deliberately claiming no payment or entity |
| 404 page | `IMPLEMENTED` | `NotFound.tsx` |

## Invitation creation

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Draft creation (title + language) | `IMPLEMENTED` (local stack only) | `CreateProject.tsx` calls `createWedding`, which inserts a `weddings` row with a nullable `design_template_id` so a draft can start with no design — and Stage 3's `weddings_have_draft` trigger guarantees the matching `invitation_drafts` row inside the same statement, verified through a REST `POST` on the local stack rather than only in SQL |
| Design direction selection | `FOUNDATION` | Landing shows six labelled *directions* (concepts, not usable designs); the create page selects a real `design_templates` row through `listDesignOptions()` if any exist |
| Design catalogue | `FOUNDATION` | `design_templates` is read by the adapter with a `status in (draft, approved)` filter. On a freshly migrated database the table is **empty** — E02 asserts every canonical table is, and nothing in the chain seeds reviewed design content; the five rows seen in the legacy-fixture qualification exist only because five of the six scaffold designs arrived and one
was refused with a recorded finding (M23–M28). An empty catalogue is handled explicitly in the UI |
| Structured couple/hosts/family | `IMPLEMENTED` (local stack only) | `ContentEditor.tsx` on the workbench adds, edits, reorders and removes `wedding_people` rows through `src/integrations/supabase/weddingContent.ts`; the row is saved on its own Save button, because a version freezes these tables and there is no draft copy of a person. It asks nothing about religion, caste, community or tradition and infers no role from a name — `role_key`/`group_key` are filled with one placeholder (`host_defined`) and the renderer prints no key, so an unlabelled person is shown by name alone. Writes ask for the affected row back, so a policy that matched nobody is reported as a failure rather than as Saved. Qualified in `contentEditor.test.tsx` (19) and `weddingContentQueries.test.ts` (23), and in the browser pass in the Stage 3 audit |
| Events / functions | `IMPLEMENTED` (local stack only) | The same editor writes `wedding_events`: a name the host types (no ceremony vocabulary is offered — the tradition-pack stage owns a reviewed one), start and optional end as wall-clock text with no conversion, a time zone written as typed, a venue chosen only from this wedding's own venues, an order, and an `enabled` switch that keeps the row for the host and leaves it out of the guest's document. `private.build_invitation_snapshot` already filtered on `enabled` and ordered by `display_order`, so the list on screen is the list a guest reads |
| Venues / maps | `IMPLEMENTED` (local stack only) (map link only) | The same editor creates, edits and removes `venues` rows: a name, an address whose line breaks reach the invitation, and a map link the adapter refuses unless it is a full `https://` address with no space — stricter than the column's own `CHECK`, measured refusing five other schemes through the browser's `UPDATE`. A venue a ceremony still points at cannot be removed (the composite `NO ACTION` foreign key answers `23503`, and the adapter turns that into one instruction rather than a constraint name). There is still **no** global venue directory, no Google Maps integration, and no geocoding: `latitude`/`longitude` are read and written by nothing in this build |
| Estimated guest count | `FOUNDATION` | The configure page writes `weddings.estimated_guest_count`; it is a planning number, **not** a guest list, and is in no way a billing quantity — no monetary column exists in `public` at all |
| Wording / blessings / invocations | `PLANNED V1` | No reviewed content exists |
| South-Indian language list | `IMPLEMENTED` | `src/lib/i18n.ts` ordered by rollout priority (en, ta, te, ml, kn) with native labels; used as invitation metadata |
| UI localisation into those languages | `PLANNED V1` | The product interface is **English only** today |
| Script-safe font stacks | `IMPLEMENTED` | Latin face then one Noto face per script, loaded via Google Fonts subsets |

## Design preview

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Font / size / colour / alignment controls | `IMPLEMENTED` (local stack only) | `EditProject.tsx` writes the whole editor object to `weddings.style_settings` through `updateStyleSettings`, and the value comes back out of the frozen snapshot into the DTO. The renderer treats each as hostile until it matches its own filter (`^#[0-9a-fA-F]{6}$`, `^[A-Za-z ]{1,40}$`, a 22–44 px clamp), which is tested; an explicit Save with `Saving…`/`Saved`/failed states and a dirty baseline was exercised in a browser against the local stack |
| Live design rendering | `IMPLEMENTED` (local stack only) | The canvas is `InvitationRenderer` fed by `api.preview_invitation` — the guest's own projection, not a picture of one, so preview and publication cannot drift. A sanitised catalogue `preview_svg` still shows beside it, labelled in-product as artwork guests do not see |
| Foil effect | `FOUNDATION` | Screen-only gradient overlay, labelled "simulated" in the UI. There is no print pipeline |
| Multi-output design consistency | `PLANNED V1` | Token system is the intended mechanism (ADR 0004) |
| Free element placement | `EXCLUDED` | See [`structured-creator.md`](structured-creator.md) |

## Publishing and guests

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Public invitation URL | `IMPLEMENTED` (local stack only) | `/i/:token` renders a published invitation to a visitor with **no session**: one argument-free RPC, the credential in the `x-invitation-token` header, 256-bit mint, SHA-256 digest stored, `{"available": false}` for every kind of bad credential. Exercised end-to-end in a real browser against the verified local stack and pinned by `API12`–`API26` plus 269 SQL assertions; nothing is deployed and no hosted project was touched |
| Invitation versions | `IMPLEMENTED` (local stack only) | `api.create_invitation_version` freezes the draft as an immutable row and the editor exposes that as an explicit action; `API07`/`API20` prove a frozen version keeps its own words while the draft moves underneath it, and append-only refusals remain executed (groups 7 and 8) |
| Publishing, rotation, revocation | `IMPLEMENTED` (local stack only) | Publish freezes-then-points and mints a credential exactly once; re-publishing repoints **the same address**; rotation revokes the old credential and keeps history; revocation is permanent. `API17`–`API19`, `API27`–`API32`. The panel cannot re-display a live address, says so, and never claims a message was sent |
| Public invitation renderer | `IMPLEMENTED` (local stack only) | One component, `InvitationRenderer`, drives the host preview *and* the guest page off the same SQL projection. Host text is never markup, absent facts draw nothing, dates are read from their own digits. Measured at 360×740 on six content shapes; **rendering verification only** — no native-speaker review, no WCAG claim, glyph fidelity unverifiable in this environment |
| Draft content model | `IMPLEMENTED` (local stack only) | `invitation_drafts.content` is written by the editor's four prose slots and read back through the preview; one draft per wedding is now a database guarantee (`weddings_have_draft`, and no browser role holds `INSERT`/`DELETE` on the table), qualified in SQL and over HTTP |
| Family approval flow | `PLANNED V1` | `approval_requests` and `approval_feedback` exist, with the reviewer identity held as a label rather than an account and feedback append-only; **no reviewer login, no screen, no request is ever created by this build.** Any earlier "approval" UI in this repo's history was fake and was removed in Stage 0 |
| Guest households | `PLANNED V1` | `guest_households` replaces the scaffold's `guests` table, which is archived and unreadable; no host-facing guest-list screen exists |
| Personalised salutations | `PLANNED V1` | `guest_households.salutation` is a column with no writer |
| Event scoping per recipient | `PLANNED V1` | `household_event_scopes` makes an out-of-scope RSVP unrepresentable at the foreign-key level (executed in group 12); nothing invites a household to an event yet |
| RSVP submission | `PLANNED V1` | No endpoint, no form, no guest credential |
| Manual RSVP entry by host | `PLANNED V1` | `rsvp_responses` has owner write policies and `response_source` distinguishes host from guest entry; no screen uses it |
| QR code | `PLANNED V1` | No generator |
| Image export | `PLANNED V1` | No renderer |
| PDF export | `PLANNED V1` | No generator |
| Open Graph preview for links | `PLANNED V1` | Static `og:title`/`og:description` exist on the landing page only; there is no per-invitation OG generation |
| Video invitation | `LATER` | Optional later; must never be a dependency |
| Print coordination | `LATER` | The scaffold's `printers` table is archived in `legacy` and reachable by no API role. Nothing in the canonical domain models printing |
| Asset registry | `PLANNED V1` | `wedding_assets` exists (`asset_kind` vocabulary CHECK, globally unique `object_key` that refuses absolute paths and `..`, non-negative `size_bytes`) and no Storage bucket, upload or key producer exists — the registry is empty |
| Tradition packs | `PLANNED V1` | `tradition_packs` exists with the catalogue contract executed (a customer may read it and cannot write it, groups 7 and 9), and the table is **empty** — `weddings.tradition_pack_id` is NULL in every row this build can create |

## Commerce and trust

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Payment collection | `PLANNED V1` | **None exists.** No provider integration, no checkout, no pricing UI |
| Entitlement / paid state | `FOUNDATION` | `projects.paid_status` **no longer exists**: `weddings` has no billing column of any kind, and entitlements live in `public.entitlements`, which refuses every client write (group 7) and whose guard trigger still refuses when a privilege is handed to it (group 8). Nothing in this build ever sets a row to `active`, so no customer has an entitlement |
| Legacy paid claims | `FOUNDATION` | The four paid-state claims in the scaffold were **recorded, not mapped**: they are readable in `legacy.projects` and in `legacy.migration_findings`, and produced no entitlement (M41, M42). Archived rows are unreachable to `anon`, `authenticated` and `service_role` alike (group 2) |
| GST / tax handling | `EXCLUDED` (this stage) | Not modelled, and no monetary column exists in `public` or `private` at all (C41). Target figures are `TARGET / SUBJECT TO PILOT VALIDATION` in [`commercial-model.md`](commercial-model.md) |
| Pricing display | `EXCLUDED` (for now) | Target figures live in [`commercial-model.md`](commercial-model.md) and must not be hardcoded into UI |
| Refunds | `PLANNED V1` | No money is taken, so there is nothing to refund |
| Per-guest sharing fee | `EXCLUDED` | Rejected on principle |
| Charge for maps / QR / CSV export | `EXCLUDED` | Rejected on principle |
| Micro add-on pricing | `EXCLUDED` | Rejected on principle |
| Fabricated social proof | `EXCLUDED` | "Trusted by N customers", fake testimonials and invented couple stories were removed in Stage 0 and are blocked by `npm run product:check` |

## Platform, data and operations

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Row-level security | `IMPLEMENTED` | 46 policies across the 18 canonical tables, all targeting `authenticated`, all permissive, one SELECT each. Executed as **322 security assertions per migration chain** on a real Postgres (both chains), plus 75 catalog assertions; see [`../audits/stage-2-domain-database.md`](../audits/stage-2-domain-database.md). Boundary: this proves Postgres RLS and grants, not the Supabase API layer on top of them — no configured Supabase project was contacted |
| Trusted-column write protection | `IMPLEMENTED` | Server-authoritative tables (`entitlements`, `invitation_versions`, `publications`, `approval_feedback`, `user_roles`, `design_templates`, `tradition_packs`) have **no write policy at all** (C22) and are additionally guarded by triggers that refuse a write even when a privilege and a permissive policy are deliberately granted (group 8, executed). The Stage 0 `paid_status` guard was retired with its table: that column no longer exists in `public` |
| SVG sanitisation boundary | `IMPLEMENTED` | `src/lib/sanitizeSvg.ts` + tests; database-provided design artwork passes through it before DOM insertion. There is no SVG upload feature |
| Canonical domain schema | `FOUNDATION` | 18 `public` + 2 `private` tables exist, are introspected and are constrained as [`../architecture/domain-model.md`](../architecture/domain-model.md) describes. Two of the eighteen are read by product code; the rest are a schema with no user-visible feature yet |
| Forward migration chain | `IMPLEMENTED` | 13 imperative migrations apply in order on an empty database and on the archived-scaffold fixture, with per-fixture row outcomes asserted (41 and 75 assertions respectively). No down migration exists; reversibility is documented per step, not assumed |
| Legacy archive isolation | `IMPLEMENTED` | Eight scaffold tables moved to `legacy` with row counts proven intact (M56–M62); `anon`, `authenticated` **and** `service_role` hold no privilege and no schema USAGE (group 2, C14, C16, C17b, C64) |
| Data-access adapter | `FOUNDATION` | `src/integrations/supabase/weddings.ts` is the only module naming a table; 13 behavioural tests drive four pages through it against a hand-written Supabase double. Never exercised against a live project |
| Database contract checker | `IMPLEMENTED` | `scripts/check-db-contract.mjs` reconciles migrations, generated types and the adapter's queries offline (11 + 6 tests in `npm test`), and fails loudly on SQL it cannot classify. Run as `npm run dbtypes:check` and in CI |
| Product-contract checker | `IMPLEMENTED` | `scripts/check-product-contract.mjs`, run as `npm run product:check` and in CI; 13 rules, and two of them now block the retired scaffold vocabulary from coming back |
| CI pipeline definition | `IMPLEMENTED` | `.github/workflows/ci.yml` — lint, typecheck, database contract, product contract, test, build, secret/env scanning, production audit. The same gates all pass locally. No CI job runs Postgres, which is why the offline contract checkers exist |
| Hosted CI verification | `FOUNDATION` | Workflow is correct; runs are **deferred by private-repo runner quota** — `EXTERNAL CI QUOTA DEFERRAL` |
| Deployment / production environment | `PLANNED V1` | No production Supabase project is connected to this repository, and no remote migration was applied in this stage |
| Admin / operations console | `PLANNED V1` | None. `user_roles` exists with no admin-facing surface, and self-granting is refused (group 7) |
| Activity / audit logging | `PLANNED V1` | The scaffold's `activity_logs` is archived and unreadable. `private.audit_events` exists with a documented shape and **no writer in product code** — reading rule 1 applies |
| Account deletion / data export | `PLANNED V1` | Supabase manages auth users; there is no product-level deletion flow. What Stage 2 changed is the *database* answer: an account holding paid history, or a wedding with a frozen version, now refuses to be cascade-deleted (group 11a, 11b, 14) instead of silently erasing that history |
| Error monitoring | `LATER` | Not present; console diagnostics only |
| Analytics | `LATER` | No third-party analytics is loaded, and the privacy and cookie policies say so |
| Third-party network requests | `IMPLEMENTED` | One: the Google Fonts stylesheet and font files requested from `index.html`. Disclosed in the privacy policy; no other third-party origin is contacted by the app |

## Reading rules

1. A table existing in `supabase/migrations/` does **not** make a feature `FOUNDATION` if nothing
   reads or writes it — say so, and keep it `PLANNED V1`.
2. A UI element that performs no persistence is `FOUNDATION` at best and must be labelled in-product
   as unavailable, not demo-able as working.
3. Moving a row from `PLANNED V1` to `IMPLEMENTED` requires: working code, a test or verified manual
   check, and an update to this matrix in the same change.
4. If this matrix and the UI ever disagree, the UI is wrong until proven otherwise.
5. `IMPLEMENTED` requires that the capability was **actually exercised in this build**. Code whose
   proof depends on an external environment we have not verified — a configured Supabase project,
   working email delivery, a live payment provider — stays `FOUNDATION` no matter how complete the
   source looks, and the note must name the missing verification. A row may never claim "a user can
   do this today" in the same breath as "not exercised against a live project".
