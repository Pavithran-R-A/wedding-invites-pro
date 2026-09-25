# Feature readiness matrix

This is the anti-delusion document. Its purpose is to stop a future contributor (human or agent)
from reading a table name, a UI label or an unused component and concluding that a capability
exists.

**Definitions**

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Works in this build. A user can do the thing today. |
| `FOUNDATION` | Real code or schema exists that the feature will be built on, but the user-visible capability is incomplete or placeholder. **Not shippable as a claim.** |
| `PLANNED V1` | Designed in these documents. No meaningful implementation. |
| `LATER` | Deliberately after V1. |
| `EXCLUDED` | We have decided not to build this. Reintroducing it needs a scope change, not a feature PR. |

Verified against this repository as of the Stage 1 audit
([`../audits/stage-1-product-reset.md`](../audits/stage-1-product-reset.md)). The app reads only two
tables — `projects` and `templates` — despite nine tables existing in schema.

## Accounts and shell

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Email sign-up, log-in, logout | `IMPLEMENTED` | Supabase Auth via `AuthProvider`; not exercised against a live project during this stage (see limitations) |
| Password reset | `IMPLEMENTED` | `ResetPassword.tsx`; depends on the auth project's email delivery being configured |
| Protected routes | `IMPLEMENTED` | `ProtectedRoute.tsx` guards dashboard/create/project routes |
| Session persistence | `FOUNDATION` | Supabase client defaults; refresh behaviour unverified in this stage |
| Dashboard listing drafts | `IMPLEMENTED` | `Dashboard.tsx` lists the signed-in user's projects |
| Dark mode | `FOUNDATION` | `.dark` token overrides exist in `src/index.css`; there is **no user-facing theme switch** |
| Cookie consent | `IMPLEMENTED` | `CookieConsent` + `CookiePolicy.tsx` |
| Legal pages | `IMPLEMENTED` | Terms/Privacy/Cookies — written as provisional, deliberately claiming no payment or entity |
| 404 page | `IMPLEMENTED` | `NotFound.tsx` |

## Invitation creation

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Draft creation (title + language) | `IMPLEMENTED` | Inserts into `projects`; `template_id` is nullable so a draft can be created with no design |
| Design direction selection | `FOUNDATION` | Landing shows six labelled *directions* (concepts, not usable templates); create page selects a real `templates` row if any exist |
| Template catalogue | `FOUNDATION` | `templates` table read by `CreateProject.tsx`; no seeded, reviewed content — an empty catalogue is handled explicitly |
| Structured couple/hosts/family | `PLANNED V1` | See [`structured-creator.md`](structured-creator.md) |
| Events / functions | `PLANNED V1` | Nothing in schema or UI |
| Venues / maps | `PLANNED V1` | Nothing in schema or UI |
| Estimated guest count | `FOUNDATION` | Persists `guest_count` on the draft; it is a planning number, **not** a guest list, and affects no billing |
| Wording / blessings / invocations | `PLANNED V1` | No reviewed content exists |
| South-Indian language list | `IMPLEMENTED` | `src/lib/i18n.ts` ordered by rollout priority (en, ta, te, ml, kn) with native labels; used as invitation metadata |
| UI localisation into those languages | `PLANNED V1` | The product interface is **English only** today |
| Script-safe font stacks | `IMPLEMENTED` | Latin face then one Noto face per script, loaded via Google Fonts subsets |

## Design preview

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Font / size / colour / alignment controls | `FOUNDATION` | `EditProject.tsx` persists an `editor` object into `projects.selected_features` |
| Live template rendering | `FOUNDATION` | Renders a sanitised `preview_svg` if the draft's template has one; otherwise a placeholder text preview |
| Foil effect | `FOUNDATION` | Screen-only gradient overlay, labelled "simulated" in the UI. There is no print pipeline |
| Multi-output design consistency | `PLANNED V1` | Token system is the intended mechanism (ADR 0004) |
| Free element placement | `EXCLUDED` | See [`structured-creator.md`](structured-creator.md) |

## Publishing and guests

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Public invitation URL | `PLANNED V1` | No route, no token, no schema |
| Invitation versions | `PLANNED V1` | ADR 0004; blueprint only |
| Family approval flow | `PLANNED V1` | No approval tables or screens. **Any earlier "approval" UI in this repo's history was fake and was removed in Stage 0** |
| Guest households | `PLANNED V1` | A `guests` table exists in schema from the original scaffold and is **not read or written by the app** |
| Personalised salutations | `PLANNED V1` | — |
| Event scoping per recipient | `PLANNED V1` | — |
| RSVP submission | `PLANNED V1` | No endpoint, no form |
| Manual RSVP entry by host | `PLANNED V1` | — |
| QR code | `PLANNED V1` | No generator |
| Image export | `PLANNED V1` | No renderer |
| PDF export | `PLANNED V1` | No generator |
| Open Graph preview for links | `PLANNED V1` | Static `og:title`/`og:description` exist on the landing page only; there is no per-invitation OG generation |
| Video invitation | `LATER` | Optional later; must never be a dependency |
| Print coordination | `LATER` | A `printers` table exists in schema and is **unused by the app** |

## Commerce and trust

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Payment collection | `PLANNED V1` | **None exists.** No provider integration, no checkout, no pricing UI |
| Entitlement / paid state | `FOUNDATION` | `projects.paid_status` exists and is **server-authoritative and RLS-verified**; nothing sets it above `unpaid` in this build |
| GST / tax handling | `PLANNED V1` | Not modelled; deliberately unstated in the commercial doc |
| Pricing display | `EXCLUDED` (for now) | Target figures live in [`commercial-model.md`](commercial-model.md) and must not be hardcoded into UI |
| Refunds | `PLANNED V1` | No money is taken, so there is nothing to refund |
| Per-guest sharing fee | `EXCLUDED` | Rejected on principle |
| Charge for maps / QR / CSV export | `EXCLUDED` | Rejected on principle |
| Micro add-on pricing | `EXCLUDED` | Rejected on principle |
| Fabricated social proof | `EXCLUDED` | "Trusted by N customers", fake testimonials and invented couple stories were removed in Stage 0 and are blocked by `npm run product:check` |

## Platform, data and operations

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Row-level security | `IMPLEMENTED` | Policies + 24-assertion Docker regression suite; see [`../audits/stage-0-truth-security.md`](../audits/stage-0-truth-security.md) |
| Trusted-column write protection | `IMPLEMENTED` | `paid_status` guarded on both UPDATE and INSERT paths |
| SVG sanitisation boundary | `IMPLEMENTED` | `src/lib/sanitizeSvg.ts` + tests; every `dangerouslySetInnerHTML` of user/template SVG goes through it |
| Product-contract checker | `IMPLEMENTED` | `scripts/check-product-contract.mjs`, run as `npm run product:check` and in CI |
| CI pipeline | `IMPLEMENTED` | `.github/workflows/ci.yml` — lint, typecheck, test, build, secret/env scanning, production audit |
| Hosted CI verification | `FOUNDATION` | Workflow is correct; runs are **deferred by private-repo runner quota** — `EXTERNAL CI QUOTA DEFERRAL` |
| Deployment / production environment | `PLANNED V1` | No production Supabase project is connected to this repository |
| Admin / operations console | `PLANNED V1` | None |
| Activity / audit logging | `FOUNDATION` | `activity_logs` table exists in schema and is **not written to by the app** |
| Account deletion / data export | `PLANNED V1` | Supabase manages auth users; there is no product-level deletion flow |
| Error monitoring | `LATER` | Not present; console diagnostics only |
| Analytics | `LATER` | No third-party analytics is loaded, and the cookie policy says so |

## Reading rules

1. A table existing in `supabase/migrations/` does **not** make a feature `FOUNDATION` if nothing
   reads or writes it — say so, and keep it `PLANNED V1`.
2. A UI element that performs no persistence is `FOUNDATION` at best and must be labelled in-product
   as unavailable, not demo-able as working.
3. Moving a row from `PLANNED V1` to `IMPLEMENTED` requires: working code, a test or verified manual
   check, and an update to this matrix in the same change.
4. If this matrix and the UI ever disagree, the UI is wrong until proven otherwise.
