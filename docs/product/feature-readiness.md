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

Verified against this repository as of the Stage 2 domain and database audit
([`../audits/stage-2-domain-database.md`](../audits/stage-2-domain-database.md)), which replaced the
scaffold tables with the canonical domain. The app now reads and writes `weddings` and
`design_templates` through one module, `src/integrations/supabase/weddings.ts`; the scaffold tables
it used to name (`projects`, `templates`, `guests`, `orders`, `payments`, `printers`) are archived in
the `legacy` schema, which no API role — `service_role` included — can reach. Sixteen further
canonical tables exist that **no product code reads or writes yet**; reading rule 1 below applies to
every one of them. No Supabase project was verified during this stage, so any capability whose proof
needs one is `FOUNDATION`, not `IMPLEMENTED`.

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
| Draft creation (title + language) | `FOUNDATION` | `CreateProject.tsx` calls `createWedding`, which inserts a `weddings` row with a nullable `design_template_id` so a draft can start with no design. The insert was not exercised against a verified Supabase project in this stage |
| Design direction selection | `FOUNDATION` | Landing shows six labelled *directions* (concepts, not usable designs); the create page selects a real `design_templates` row through `listDesignOptions()` if any exist |
| Design catalogue | `FOUNDATION` | `design_templates` is read by the adapter with a `status in (draft, approved)` filter. On a freshly migrated database the table is **empty** — E02 asserts every canonical table is, and nothing in the chain seeds reviewed design content; the five rows seen in the legacy-fixture qualification exist only because five of the six scaffold designs arrived and one
was refused with a recorded finding (M23–M28). An empty catalogue is handled explicitly in the UI |
| Structured couple/hosts/family | `PLANNED V1` | Canonical tables `wedding_people` and `wedding_events` exist with constraints and policies, and **no screen reads or writes them** — see [`structured-creator.md`](structured-creator.md) and reading rule 1 |
| Events / functions | `PLANNED V1` | `wedding_events` exists in schema (ordered, venue-linked, `event_key` deliberately unconstrained); nothing in the UI touches it |
| Venues / maps | `PLANNED V1` | `venues` exists in schema with `latitude`/`longitude` as `numeric`, no map or geocoding code reads them |
| Estimated guest count | `FOUNDATION` | The configure page writes `weddings.estimated_guest_count`; it is a planning number, **not** a guest list, and is in no way a billing quantity — no monetary column exists in `public` at all |
| Wording / blessings / invocations | `PLANNED V1` | No reviewed content exists |
| South-Indian language list | `IMPLEMENTED` | `src/lib/i18n.ts` ordered by rollout priority (en, ta, te, ml, kn) with native labels; used as invitation metadata |
| UI localisation into those languages | `PLANNED V1` | The product interface is **English only** today |
| Script-safe font stacks | `IMPLEMENTED` | Latin face then one Noto face per script, loaded via Google Fonts subsets |

## Design preview

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Font / size / colour / alignment controls | `FOUNDATION` | `EditProject.tsx` writes the whole editor object to `weddings.style_settings` through `updateStyleSettings`; the control surface renders, the write is unverified against a project |
| Live design rendering | `FOUNDATION` | Renders a sanitised `preview_svg` if the wedding's design has one; otherwise a placeholder text preview |
| Foil effect | `FOUNDATION` | Screen-only gradient overlay, labelled "simulated" in the UI. There is no print pipeline |
| Multi-output design consistency | `PLANNED V1` | Token system is the intended mechanism (ADR 0004) |
| Free element placement | `EXCLUDED` | See [`structured-creator.md`](structured-creator.md) |

## Publishing and guests

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Public invitation URL | `PLANNED V1` | No route, no renderer, and nothing mints a token. `private.access_tokens` exists as digest-only storage that no code path writes; its policy surface is not exposed to any browser role |
| Invitation versions | `PLANNED V1` | `invitation_versions` exists and is append-only by executed test (group 7: the owner's own rewrite and delete are refused; group 8: the guard still refuses when a privilege and a permissive policy are deliberately handed over), but **no product code creates a version** — ADR 0002's freeze-on-publish action does not exist yet |
| Draft content model | `PLANNED V1` | `invitation_drafts.content` (jsonb, one row per wedding) exists with owner policies; no editor reads or writes it. The design preview still works from `weddings.style_settings` |
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
