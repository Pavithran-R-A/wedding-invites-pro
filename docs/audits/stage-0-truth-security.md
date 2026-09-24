# Stage 0 — Truth, Security and Re-Baseline

**STATUS: PASS**

Repository: `Pavithran-R-A/wedding-invites-pro` (private)
Date: 2026-09-24
Scope: Stage 0 only — make the existing repo truthful, safe, auditable and
technically reproducible **in place**. No rebrand, no Stage 1 product features.

---

## 1. What Stage 0 was and was not

**Was:** remove false functionality and claims, restore a reproducible and
green toolchain, fix env/secret hygiene, harden the database so it cannot be
used to fake money/RSVP/order state, add a real sanitisation boundary for
untrusted SVG, and prove all of the above with executed tests.

**Was not (explicitly deferred):** rebranding to any new product name, the
"VivaahVarnam" identity, and every Stage 1 surface — real pricing/entitlement,
checkout, payments, publishing, public invite pages, guest RSVP, tradition
packs, print ordering. The product name in code/UI remains **YourInvite**; the
browser tab now reads "YourInvite — Wedding Invitation Designer (Preview)".

---

## 2. Reproducible toolchain (executed, not assumed)

| Check | Command | Result |
|---|---|---|
| Clean install | `npm ci` | PASS (exit 0) — after lockfile re-sync |
| Typecheck | `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`) | PASS (exit 0) |
| Lint | `npm run lint` | PASS — **0 errors**, 8 warnings |
| Unit tests | `npm test` | PASS — **9 tests / 2 files** |
| Production build | `npm run build` | PASS (exit 0) |
| Audit (production tree) | `npm audit --omit=dev --audit-level=high` | PASS (exit 0) — the gate CI enforces |
| Audit (full tree) | `npm audit` | 6 advisories (5 moderate, 1 high) — all require breaking majors (see §7) |
| CI | `.github/workflows/ci.yml` | Newly added; commands verified locally, not yet run on GitHub (see §8) |

A `typecheck` script was added to `package.json` (it did not previously exist).
The lockfile was regenerated with `npm install` because the committed
`package-lock.json` was out of sync with `package.json` (missing transitive
deps made `npm ci` fail); the resulting diff is a re-sync, not a version bump.

The 8 remaining lint warnings are all `react-refresh/only-export-components` in
pre-existing shadcn/ui primitives and `AuthProvider`; they are non-blocking and
out of Stage 0 scope. Three pre-existing lint **errors** were fixed:
`ui/command.tsx` and `ui/textarea.tsx` empty-interface → type alias, and
`tailwind.config.ts` `require()` → ESM import.

---

## 3. Environment & secret hygiene (Phase 0D)

- `.env` was tracked in Git. It is now **untracked** (`git rm --cached .env`),
  the local file is preserved, and `.gitignore` ignores `.env` / `.env.*` while
  keeping `!.env.example`.
- `.env.example` documents that the three `VITE_*` values are **browser-public**
  Supabase settings, not secrets, and must never hold a `service_role`/DB/
  payment secret.
- **Whole-history scan** (all 12 commits, every blob) for privileged-secret
  patterns (service_role JWTs, private keys, AWS keys, Razorpay live keys,
  `postgres://user:pass@`, generic JWTs) returned exactly one hit: `.env`.
- Decoding only the `role` claim of the JWT in the committed `.env` yields
  **`"role":"anon"`** — the public browser key. The committed `.env` held only
  `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
  **No `service_role` secret exists anywhere in history.**

Per the operating rules, a deliberately-public anon key is not equivalent to a
service-role secret and does **not** gate Stage 0. It still should not have been
committed, which is now fixed. **No credential rotation is required** for Stage 0
to pass; rotating the anon key is optional hygiene left to the owner.

> This scan and every DB test below were run **locally**. No Supabase Cloud
> project was created, deployed to, or mutated.

---

## 4. False functionality removed (Phases 0E–0I, 0N, 0O)

Removed rather than disguised:

- **Checkout UI** — `src/components/checkout/` deleted entirely (ElderApproval,
  FeatureToggle, GuestCountInput, InvoicePreview, PriceMeter, PrintOptions,
  TrustBadges). These simulated a payment/approval flow with no backend.
- **Landing** — `PricingSection.tsx` and `TestimonialsSection.tsx` deleted
  (invented prices and fake testimonials). Hero/Trust/HowItWorks/Header/Footer/
  CookieConsent/TemplateGallery copy rewritten to honest draft-preview language;
  no "Trusted by", "₹199", "Secure Checkout", "256-bit", or testimonial claims.
- **Legacy pricing model** — `src/lib/pricing.ts` and `src/test/pricing.test.ts`
  **deleted** (per-guest price catalog, GST, `PRICE_PER_GUEST`, feature prices).
  Nothing imported them except their own test. A "LEGACY" banner would have
  disguised dead commerce code, so it was removed.
- **Dead i18n dictionary** — `src/lib/i18n.ts` contained an unused `t()`
  translation map full of false claims (`hero.startingAt ₹199 · No hidden fees`,
  `checkout.payAndCreate 'Pay & Create Project'`, "manage RSVPs … order prints").
  The unused map/`t()` were deleted; only the `Language` type and `LANGUAGES`
  list (imported by CreateProject) remain.
- **Fake "paid" state** — `CreateProject` no longer inserts `paid_status`;
  projects are created as drafts (DB default `unpaid`). `Dashboard` no longer
  shows a `paid_status` badge (a billing lifecycle that does not exist); it shows
  an honest "Draft" label and only metrics backed by real data (project count,
  planned guests).
- **ConfigureProject** reduced to truthful draft config (planning guest count +
  edit design), with an explicit "coming in a later stage" note.
- **Edge function** `supabase/functions/pricing-quote/` deleted (returned a
  fabricated quote; no UI depended on it); `supabase/config.toml` updated.
- **index.html** head cleaned: removed `yourinvite.in` canonical/og:url,
  missing `/og-image.png`, the ₹199 JSON-LD offer, and feature claims; favicon
  reference added.
- **Legal pages** (Privacy/Cookie/Terms) rewritten as provisional dev-stage
  documents that state plainly the build is not a commercial service yet and
  lists what it actually stores.

---

## 5. Untrusted-input sanitisation (Phase 0M)

New central boundary `src/lib/sanitizeSvg.ts` (DOMPurify, `svg`+`svgFilters`
profiles, explicit `FORBID_TAGS` incl. `foreignObject`/`animate`, and an
`afterSanitizeAttributes` hook that strips absolute `href`/`xlink:href`/`src`/
`action` URLs so template SVG cannot exfiltrate or track). Every DB-supplied
`templates.preview_svg` injection now passes through it
(`CreateProject.tsx`, `EditProject.tsx`). Covered by `src/test/sanitizeSvg.test.ts`
(8 tests: script, event handlers, `javascript:`/external URLs, `foreignObject`,
`animate`, and preservation of harmless presentational SVG).

The only remaining `dangerouslySetInnerHTML` outside the sanitizer is
`src/components/ui/chart.tsx` (shadcn recharts CSS-variable helper, no
user/DB content).

---

## 6. Database security hardening (Phases 0J–0L) — executed

Forward-only migration:
`supabase/migrations/20260924000000_stage0_truth_security_baseline.sql`
(never rewrites the two historical migrations).

Changes:
1. **`paid_status` guard trigger** `protect_paid_status()` — for `anon`/
   `authenticated` callers it resets `NEW.paid_status := OLD.paid_status`, so a
   client can never self-escalate billing state; `service_role` and non-JWT
   contexts keep control.
2. Dropped **`Public RSVP via token`** (anon guests UPDATE) — no real RSVP flow.
3. Dropped **`Users create orders`** and **`Users create payments`** — money
   rows are backend-only; owner/admin read policies kept.
4. Dropped **`Public read active printers`** — anon could read `api_endpoint`,
   `contact`, `payment_terms`; admins keep full access.
5. Dropped client **`activity_logs` INSERT** policies — audit log is server-only.
6. Re-created `has_role`, `is_project_owner`, `handle_new_user` as
   `SECURITY DEFINER` with **`SET search_path = ''`** and fully schema-qualified
   bodies (closes search_path hijack); signup trigger behaviour preserved.
7. Least-privilege `EXECUTE`: revoked from `PUBLIC`/`anon`, granted to
   `authenticated` only for the two RLS predicates.

### Evidence — real Postgres, executed in Docker

Test harness under `supabase/tests/rls/` (`run.sh`, `run-baseline.sh`) boots a
throwaway `postgres:16-alpine`, applies a minimal Supabase auth/role shim
(`00_bootstrap.sql`), then the migrations, then asserts behaviour. No remote
project is touched.

**Baseline snapshot** (only the two original migrations, pre-hardening):
- (A) anon token RSVP write: **not directly effective (0 rows)** — anon had no
  guests SELECT policy making rows visible to an updater; the grant was still an
  over-broad anonymous write path and is removed defensively. *(Reported honestly
  rather than claimed as an open exploit.)*
- (B) owner self-set `paid_status = fully_paid`: **OPEN**
- (C) client `INSERT` into `payments`: **OPEN**
- (D) anon read printers incl. `api_endpoint`: **OPEN**

**Hardened suite** (`STAGE0 RLS TESTS PASSED (13)`, psql exit 0):
1 anon guest-token update blocked · 2 client `paid_status` escalation frozen ·
3 cross-user project update blocked · 4 client payments INSERT denied ·
5 client orders INSERT denied · 6 client activity_logs INSERT denied ·
7 anon printer read blocked · 8 non-admin printer read blocked ·
9 owner can still edit own project · 10 owner can still manage own guests ·
11 service_role backend path intact (paid_status + money rows) ·
12 signup trigger still provisions profile + user role ·
13 SECURITY DEFINER helpers pinned to empty `search_path`.

Because the RLS/security behaviour was actually exercised against a live
Postgres, Stage 0 is **not** downgraded to a note — it is verified.

---

## 7. Residual findings (not fixed in Stage 0, with rationale)

`npm audit` reports 6 vulnerabilities (5 moderate, 1 high). `npm audit fix`
(dry-run) shows **none** are fixable without a breaking major, so they were
recorded, not force-applied (force-upgrading would destabilise the build and is
outside Stage 0):

- `esbuild ≤0.24.2` (via `vite@5.4.21`) — dev-server-only advisory; production
  build is static. Fix requires `vite@8` (breaking).
- `@vitest/mocker@3.2.7` (via `vitest@3.2.7`) — test-time only. Fix requires
  `vitest@5` (breaking).
- `react-router(-dom)@6.30.6` — open-redirect-via-backslash and SSR-hydration
  `deserializeErrors`. This SPA has no SSR and uses static `<Link>` targets; fix
  requires `react-router-dom@7` (breaking).

Other residuals:
- **Authed data flows not browser-verified end-to-end.** Landing (desktop +
  390px mobile), login, terms, cookie policy and the protected-route redirect
  were verified in a real browser with zero console errors. The logged-in
  create/dashboard/configure/editor data flows were **not** exercised because
  that needs a live authenticated Supabase session, and Stage 0 must not create
  or mutate a remote project. This is stated, not glossed over.
- **Vite dev server binds all interfaces** (`vite.config.ts` → `server.host:
  "::"`). Combined with the two open dev-server advisories above, this widens
  local exposure during development. Left unchanged because it is a deliberate
  LAN/mobile-testing convenience and has **zero** effect on the static
  production build; recommend `host: "127.0.0.1"` unless device testing needs it.
- `NavLink.tsx` and other unused scaffold left in place (harmless; removing is
  optional cleanup).
- The historical `paid_status`/`app_role`/payment/order **enums and columns
  remain** in the schema (dropping them would be a destructive, non-forward
  change and is a Stage 1 design decision). They are now unreachable for
  client writes.

---

## 8. CI baseline (Phase 0P)

`.github/workflows/ci.yml` runs on pushes to and PRs against `main`, with
`permissions: contents: read` and no deployment step.

| Job | Steps |
| --- | --- |
| `verify` | `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` |
| `security` | `npm ci` (lockfile must satisfy `package.json`) → env-file tracking guard → credential-shape guard → `npm audit --omit=dev --audit-level=high` → non-blocking full audit artifact |

Design constraints honoured:

- **No production secrets.** CI injects only two obviously-fake public
  placeholders (`https://example.supabase.co`,
  `sb_publishable_EXAMPLE_PUBLIC_PLACEHOLDER`); the build and tests do not
  contact a backend.
- **No false positives on public placeholders.** The credential guard skips
  `.env.example` and `docs/`, and its patterns target JWT-shaped tokens
  (two long base64url segments), PEM private keys and AWS access-key IDs —
  not the deliberately public publishable key. Verified against a synthetic
  JWT (detected) and the public placeholder form (not detected).
- **No credentials printed.** The guard reports matching *file paths* only,
  never the matched text.
- **Not flaky via third parties.** No external audit/sca service is called;
  `npm audit` runs against the bundled advisory data. Only the *production*
  dependency tree is gated (`--omit=dev --audit-level=high`, currently exit
  0). The known dev-tooling advisories are uploaded as an artifact for
  inspection instead of turning CI permanently red.

CI has not been executed on GitHub in this stage — the workflow is committed
locally and its individual commands were all run locally (see §2). Its first
green run happens when this branch is pushed, which requires owner
authorisation (§10).

---

## 9. How to reproduce

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm audit
npm audit --omit=dev --audit-level=high   # the gate CI enforces

# Database security tests (needs Docker; uses a throwaway container):
bash supabase/tests/rls/run.sh          # hardened suite -> STAGE0 RLS TESTS PASSED (13)
bash supabase/tests/rls/run-baseline.sh # pre-hardening snapshot (informational)
```

---

## 10. Git safety

No history was rewritten. No force-push. The Stage 0 changes are committed on
the current branch. **Push is not performed** — it requires explicit owner
authorisation, which has not been given.
