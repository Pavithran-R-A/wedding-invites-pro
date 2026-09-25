# VivaahVarnam — Digital Wedding Patrika

**Status: Preview.** VivaahVarnam is an early, development-stage product. The account-backed draft
flows are implemented in the source code but have not been exercised end to end against a verified
Supabase environment; sharing, RSVP, publishing, payment and printing do not exist yet.

**Brand status: preliminary working brand — not legally cleared.** The name may change before
launch. Nothing in this repository should be read as a trademark claim, and no trademark search
has been completed.

VivaahVarnam is a digital *patrika*: an invitation built to be read and accepted by a whole
family, in the language the family actually uses, on the phone where it will actually be shared.

## Purpose

Indian wedding invitations are designed for print and then squeezed into chat apps. VivaahVarnam
starts from the opposite assumption — the invitation is a living, readable document that a couple
and their relatives review together on mobile, in their own language, before anything is sent.

The product priority order is deliberate:

1. Emotional quality of the invitation itself
2. Family acceptance (a parent must be able to read and approve it)
3. Regional-language correctness
4. Guest mobile and WhatsApp experience
5. Low-friction creation
6. Trustworthy publication and payment
7. Premium human services

## Verified in Stage 1

Behaviour actually exercised in this stage, without depending on an external environment we do not
control:

- Public landing, privacy, terms and cookie pages render, and describe this build honestly
- The sign-up and log-in screens render with labelled fields and autocomplete values
- Protected routes redirect to the sign-in screen while unauthenticated
- The brand lockup, design tokens, script-safe font stacks and the South-Indian language list
- The SVG sanitisation boundary and its unit tests
- The SQL row-level-security regression harness (24 assertions, Docker `postgres:16-alpine`),
  including the trusted-column write guards on `paid_status`
- The product-contract checker, and the local gates: lint, typecheck, unit tests, production build
- Public pages laid out down to a 360px viewport

## Implemented foundations requiring a configured backend

Real code paths that compile and ship in this build, whose end-to-end behaviour was **not**
demonstrated against a verified Supabase environment during Stage 1:

- Sign-up, log-in, logout and password reset against a Supabase Auth project — the screens render,
  the round trip and email delivery were never exercised
- A **My invitations** dashboard that reads the signed-in user's drafts
- Draft creation: name, main language, optional design direction, inserted into `projects`
- A draft configuration page that stores an *estimated guest count* (planning only — there is no
  checkout, so it affects nothing commercial)
- A design preview that saves font, size, colour, alignment and a **simulated** foil overlay with
  the draft

No production Supabase environment was validated. Running the flows above needs a compatible
Supabase project with this repository's migrations applied, and the Stage 1 browser QA covered only
the public and unauthenticated surfaces. Treat them as implemented, not as proven live.

What deliberately does **not** exist yet: guest lists, RSVP collection, public invitation URLs,
QR codes, PDF/image export, publishing, payment, GST handling, print ordering, and admin tooling.
Where the UI mentions these, it labels them *Planned for V1*.

## Target V1

The first real release aims at one loop completed end to end:

- A couple builds a structured invitation (couple, families, events, venue, directions) instead of
  free-text fields
- One South-Indian language plus English, with wording reviewed by native speakers
- A private, reviewable link that family members can open on a phone and approve
- A trusted published state, with payment only where it buys something a guest actually receives

Anything outside that loop is staged behind V1 (see
[`docs/product/v1-scope.md`](docs/product/v1-scope.md) and
[`docs/product/feature-readiness.md`](docs/product/feature-readiness.md)).

## South India rollout

Language priority is a product decision, not an afterthought:

1. Tamil + English
2. Telugu
3. Malayalam
4. Kannada

Language is always chosen by the user. The app never infers a language, religion, caste, region or
tradition from a name or an identity, and it does not publish authoritative religious or
ceremonial wording produced by unreviewed generation.

## Product principles

- **Patrika-first**: the invitation document is the product, not a landing page around it.
- **Truthful UI**: a capability is shown only when it exists. Planned work is labelled planned.
- **Language-conscious**: script-safe font stacks and per-language review, not a translated string
  file.
- **Family-readable**: large type, high contrast, mobile-first, works in a chat-app browser.
- **No manufactured urgency**: no fake social proof, no countdown tricks, no micro-add-on
  nickel-and-diming.

## Architecture

React 18 + TypeScript single-page app, built with Vite (`@vitejs/plugin-react-swc`), routed with
React Router 6, server state through TanStack Query, UI primitives from Radix via shadcn-style
components, styled with Tailwind CSS over HSL design tokens. Supabase provides auth, the Postgres
database and row-level security. Database-provided template SVG passes through the central DOMPurify
sanitisation boundary before DOM insertion; there is no SVG upload feature.

```text
src/App.tsx                     routes (protected project screens behind ProtectedRoute)
src/pages/                      landing, auth, dashboard, create / configure / design-preview
src/components/landing/         landing sections
src/components/brand/           single brand lockup used by every header, footer and auth screen
src/components/auth/            auth provider + route guard
src/components/ui/              shadcn-style primitives
src/config/product.ts           the only place product name / descriptor / tagline / status live
src/lib/                        i18n language order, SVG sanitisation boundary
src/integrations/supabase/      client + generated database types
supabase/migrations/            schema and RLS history
supabase/tests/rls/             executable RLS assertions
scripts/check-product-contract.mjs  scope-aware brand/claims checker
docs/product/                   canonical product contract
docs/architecture/              ADRs and the Stage 2 domain blueprint
docs/audits/                    stage audit evidence
```

Brand copy belongs in `src/config/product.ts` and `src/components/brand/BrandLockup.tsx`. Changing
the name should not require editing twelve pages.

## Security baseline

Row-level security is verified, not assumed. `supabase/tests/rls/` runs the policies against a
throwaway Postgres container and asserts the trusted-only columns (paid state, ownership,
generation metadata) cannot be written by an authenticated client. The Stage 0 findings —
including the insert-path guard that closes the paid-status escalation hole — are recorded in
[`docs/audits/stage-0-truth-security.md`](docs/audits/stage-0-truth-security.md).

No secret belongs in this repository. The app only ever reads a browser-public publishable key;
`.env` files are untracked, and CI fails on tracked env files or credential-shaped strings.

## Product docs

- [`docs/product/README.md`](docs/product/README.md) — where to start
- [`docs/product/v1-scope.md`](docs/product/v1-scope.md) — what V1 is, and what it is not
- [`docs/product/invitation-semantics.md`](docs/product/invitation-semantics.md) — the patrika model
- [`docs/product/structured-creator.md`](docs/product/structured-creator.md) — the creation flow
- [`docs/product/content-governance.md`](docs/product/content-governance.md) — how tradition-pack wording becomes trustworthy
- [`docs/product/commercial-model.md`](docs/product/commercial-model.md) — target pricing, pilot-validated, not live prices
- [`docs/product/brand-clearance.md`](docs/product/brand-clearance.md) — brand status and remaining clearance work
- [`docs/product/design-principles.md`](docs/product/design-principles.md) — visual and editorial rules
- [`docs/product/feature-readiness.md`](docs/product/feature-readiness.md) — IMPLEMENTED / FOUNDATION / PLANNED V1 / LATER / EXCLUDED
- [`docs/architecture/decisions/`](docs/architecture/decisions/) — ADRs 0001–0005
- [`docs/architecture/stage-2-domain-blueprint.md`](docs/architecture/stage-2-domain-blueprint.md) — documentation-only domain design

## Local development

npm is the canonical package manager. Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run dev
```

Environment: copy `.env.example` to `.env` and point `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` at a Supabase project you own. Never commit `.env`, never use a
service-role key in this app, and never connect an unrelated or production project for local work.

Every gate, in the order CI runs them:

```bash
npm run lint
npm run typecheck
npm test
npm run product:check
npm run build
npm audit
npm audit --omit=dev --audit-level=high
```

`npm run product:check` is the contract guard: it scans active source surfaces for retired brand
names, fabricated social proof and per-guest pricing language. It intentionally ignores
`docs/audits/**`, which records historical evidence verbatim.

## Database testing

The RLS harness needs Docker and starts a disposable `postgres:16-alpine` container, applies the
migrations, runs the assertions and removes the container:

```bash
bash supabase/tests/rls/run.sh
```

Expected result: **24 passed / 0 failed**. If the count changes, investigate the policies and the
harness — do not edit the assertion count to make the run green.

- `bash supabase/tests/rls/run-baseline.sh` proves the pre-hardening baseline (only the two
  original migrations) still contained the exploit paths Stage 0 closes.
- `bash supabase/tests/rls/run-repro.sh` reproduces the paid-state INSERT bypass against the
  published schema; `REPAIRED=1 bash supabase/tests/rls/run-repro.sh` re-checks it with the repair
  migration applied. The probe is informational — read its notices, it never fails the script.

## GitHub CI note

`.github/workflows/ci.yml` runs `verify` (clean install, lint, typecheck, product contract check,
unit tests, build) and `security` (env-file and credential scanning, production `npm audit`) on
pushes and pull requests targeting `main`.

Hosted-runner verification is currently **deferred**: this private repository's monthly runner
allocation is exhausted, so some runs conclude `failure` after zero steps with no runner ever
starting. That is an infrastructure quota condition, not a code failure, and is recorded as
`EXTERNAL CI QUOTA DEFERRAL` in the stage audits. If a job *does* start and a step fails, that is
a real failure and gets investigated.

## License

Private and unpublished at this stage.
