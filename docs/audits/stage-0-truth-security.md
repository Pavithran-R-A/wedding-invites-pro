# Stage 0 — Truth, Security and Re-Baseline

**STATUS: PASS — after one post-publication security repair (§11)**

The original PASS recorded below was **wrong about one acceptance criterion**:
client-created projects could carry trusted paid state, because the paid-status
guard only covered `UPDATE`. An independent GitHub review caught it, it was
reproduced against the published schema, and it is fixed in §11. Read §11 first.

Repository: `Pavithran-R-A/wedding-invites-pro` (private)
Date: 2026-09-24 (repair 2026-09-25 UTC / late 2026-09-24 local)
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
| DB security suite | `bash supabase/tests/rls/run.sh` | PASS — **24 / 24** assertions on live Postgres (§6, §11) |
| CI | `.github/workflows/ci.yml` | Accepted by GitHub; run created but no runner allocated (account billing) — see §8 |

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
   > ⚠️ **This first attempt was incomplete.** It fired `BEFORE UPDATE` only, so
   > it could not protect an `INSERT`, and the broad `FOR ALL` project policy let
   > a client create a project that was *already* marked paid. See §11 for the
   > reproduced bypass and the repair; do not read this bullet as the current
   > behaviour.
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

**Hardened suite as originally published** (`STAGE0 RLS TESTS PASSED (13)`,
psql exit 0 — now 24, see §11; the 13 are kept listed because they were the
evidence behind the original PASS):
1 anon guest-token update blocked · 2 client `paid_status` escalation frozen ·
3 cross-user project update blocked · 4 client payments INSERT denied ·
5 client orders INSERT denied · 6 client activity_logs INSERT denied ·
7 anon printer read blocked · 8 non-admin printer read blocked ·
9 owner can still edit own project · 10 owner can still manage own guests ·
11 service_role backend path intact (paid_status + money rows) ·
12 signup trigger still provisions profile + user role ·
13 SECURITY DEFINER helpers pinned to empty `search_path`.

Because the RLS/security behaviour was actually exercised against a live
Postgres, these results are evidence rather than notes. They were also, on their
own, **insufficient**: the suite only proved the paths it happened to test, and
it tested paid state on `UPDATE` only — which is exactly how the §11 bypass
survived a green run. Executing tests is necessary, not sufficient; coverage has
to match the threat.

---

## 7. Dependency / supply-chain audit (Phase 0C) and residual findings

`package.json`: 52 production dependencies, 21 dev-only. Both audit scopes were
run.

```bash
npm audit                    # 6 vulnerabilities (5 moderate, 1 high)
npm audit --omit=dev         # 2 moderate
```

Production tree (shipped to customers):

| Severity | Package | Direct/Transitive | Exploit relevance here | Action |
|---|---|---|---|---|
| moderate | `react-router@6.30.6` (via `react-router-dom`) | transitive of a direct dep | Open redirect via backslash in `<Link>`/`useNavigate`: reachable only if a route target comes from untrusted input; this app navigates to static, in-app paths. SSR `deserializeErrors` is **not** exploitable — this is a client-only SPA with no SSR. | **Recorded, not upgraded.** Only fix is `react-router-dom@7` (breaking major) → out of Stage 0. Tracked as a Stage 1+ upgrade. |
| moderate | `react-router-dom@6.30.6` | direct | Same advisory chain as above. | Same. |

Dev/build tree (never shipped; `dist/` is static):

| Severity | Package | Direct/Transitive | Exploit relevance here | Action |
|---|---|---|---|---|
| **high** | `vite@5.4.21` | direct (dev) | `server.fs.deny` bypass on Windows alternate paths — a **dev-server-only** file-read issue; requires the attacker to reach the dev server. | **Not upgradable safely** (`vite@8`, breaking). Mitigation available and recommended: bind the dev server to loopback (see residual note below). |
| moderate | `esbuild@0.21.5` (via `vite`) | transitive | Dev-server cross-origin request/read; dev-only. | Recorded; same `vite@8` path. |
| moderate | `@vitest/mocker@3.2.7` (via `vitest`) | transitive | Path traversal via redirect mock — test-time only, no production exposure. | Recorded; fix requires `vitest@5` (breaking). |
| moderate | `vitest@3.2.7` | direct (dev) | Same chain. | Recorded. |

`npm audit fix` (dry-run) confirms **none** of these resolve without a breaking
major. Per the stage rules, no `npm audit fix --force` and no major upgrades
were run to make a report look green. The two moderate production advisories
are the reason CI gates production deps at `--audit-level=high` (currently
exit 0) rather than failing on everything.

Generator-only dependency check: `lovable-tagger` is a **dev-only** plugin used
in `vite.config.ts` under `mode === "development"`. `grep -rli lovable dist/`
returns no matches, so it contributes nothing to shipped code. Retained;
removing it is optional cleanup, not a Stage 0 security need.

Other residuals (not fixed in Stage 0, with rationale):
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

Status of the workflow itself: GitHub accepted the file and created a run for
the pushed `main` (run `36038783004`, head `9fd7ca8`), so the YAML, triggers and
job graph are valid. **No job ever started** — both died in ~2s with an empty
`runner_name`, no log, and the annotation "The job was not started because
recent account payments have failed or your spending limit needs to be
increased." That is an account billing condition, not a repository defect, so
nothing was changed to chase it. CI therefore has **not** been observed green;
every command it would run passed locally. Re-run it after the billing state is
fixed:

```bash
gh run rerun 36038783004 --repo Pavithran-R-A/wedding-invites-pro
```

---

## 9. How to reproduce

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm audit
npm audit --omit=dev --audit-level=high   # the gate CI enforces

# Database security tests (needs Docker; uses a throwaway container):
bash supabase/tests/rls/run.sh           # assertion suite -> STAGE0 RLS TESTS PASSED (24)
bash supabase/tests/rls/run-baseline.sh  # pre-hardening snapshot (informational)
bash supabase/tests/rls/run-repro.sh     # paid-state INSERT probe, published schema
REPAIRED=1 bash supabase/tests/rls/run-repro.sh  # same probe, repaired schema
```

---

## 10. Git safety

No history was rewritten and no force-push was used at any point. The Stage 0
commits were published to `origin/main` on the owner's explicit
authorisation: `68dbeed` (baseline), `8c9a6df` (CI), `9fd7ca8` (audit doc),
pushed as a fast-forward from `cf71d14`. Unrelated untracked
`pnpm-lock.yaml` / `pnpm-workspace.yaml` were deliberately left unstaged and
unpushed.

---

## 11. Post-publication repair — paid-state INSERT bypass (2026-09-25)

### What was wrong

Stage 0's acceptance criterion says a browser client must not be able to
self-activate trusted paid/payment state. The published baseline did **not**
meet it.

Two facts combined:

1. The historical policy `20260222071941…sql:180` is
   `CREATE POLICY "Users CRUD own projects" … FOR ALL TO authenticated
   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`. The
   `WITH CHECK` constrains **ownership only**. For an `INSERT` there is no
   "old row", so this was the entire gate.
2. `projects_paid_status_guard` was declared `BEFORE UPDATE`, and
   `protect_paid_status()` only ever assigned from `OLD.paid_status` — so it
   never saw an insert at all.

Result: `POST /projects {user_id: <self>, paid_status: "fully_paid"}` created a
project that the database itself attested as paid, with no money movement. The
original 13-assertion suite missed it because its paid-state test (#2) used an
`UPDATE` on an existing row.

### How it was found

Independent review of the published GitHub state by ChatGPT
(`origin/main` at `9fd7ca8`), after Stage 0 had been declared complete. The
record above is left as it was written rather than edited to look correct.

### Reproduced before being fixed

`supabase/tests/rls/03_paid_state_insert_probe.sql` + `run-repro.sh` run the
same probe against the published schema (repair migration excluded) and against
the repaired one. Executed on live Postgres 16 in a throwaway container:

| Case (as `authenticated`, own user id) | Published schema | Repaired schema |
|---|---|---|
| INSERT `paid_status = 'fully_paid'` | **VULNERABLE — stored as fully_paid** | REJECTED 42501, no row |
| INSERT `paid_status = 'base_paid'` | **VULNERABLE — stored as base_paid** | REJECTED 42501, no row |
| INSERT `paid_status = NULL` | **ACCEPTED — stored as NULL** | REJECTED 42501, no row |
| INSERT omitting `paid_status` (real create path) | works, stored `unpaid` | works, stored `unpaid` |
| INSERT for another user | REJECTED 42501 | REJECTED 42501 |
| `service_role` INSERT paid state | accepted | accepted (unchanged) |

### Repair

Forward-only, `supabase/migrations/20260924213540_stage0_protect_project_paid_state.sql`.
The published baseline migration was **not** rewritten.

1. `DROP POLICY "Users CRUD own projects"` and replace it with four
   operation-specific policies. Ownership scoping is the identical predicate
   (`auth.uid() = user_id`), so nothing is broadened:
   - SELECT — own rows;
   - INSERT — own rows **AND `paid_status = 'unpaid'`**;
   - UPDATE — own rows (billing still frozen by the trigger);
   - DELETE — own rows.
   A client that omits `paid_status` is unaffected: the column `DEFAULT
   'unpaid'` is resolved before `WITH CHECK` runs. An explicit `NULL` is
   rejected, because `NULL = 'unpaid'` is not true.
2. `protect_paid_status()` is now `BEFORE INSERT OR UPDATE`, with a `TG_OP`
   branch (mandatory — `OLD` does not exist for an insert), and it no longer
   uses the discouraged `auth.role()` JWT claim. It checks the real executing
   role via `current_user` against a **trusted allowlist**
   (`service_role`, `supabase_admin`, `postgres`) and fails closed: any other
   caller on `INSERT` gets `RAISE … ERRCODE 'insufficient_privilege'`, and on
   `UPDATE` keeps the previous behaviour of restoring `OLD.paid_status`.

Two deliberate decisions:

- **Reject, don't normalise.** A malicious paid-state insert is refused rather
  than quietly rewritten to `unpaid`, so a client or integrator bug that tries
  to mint billing state stays visible instead of half-working.
- **Same SQLSTATE at both layers.** The trigger raises `42501`, identical to an
  RLS violation, so the observable contract does not depend on which layer
  evaluates first (PostgreSQL evaluates RLS `WITH CHECK` and BEFORE-row triggers
  in an order callers should not rely on).

### Defence in depth actually verified

With `ALTER TABLE projects DISABLE ROW LEVEL SECURITY` — i.e. RLS removed
entirely — the trigger alone still rejected `authenticated` inserting
`fully_paid` (`client role authenticated may not create a project with
paid_status fully_paid; only the trusted backend may set billing state`) while
the legitimate create stored `unpaid`. The protection does not depend on the
policy alone.

### Other trusted fields checked for the same INSERT/UPDATE gap (step 6)

| Field | Client write path today | Evidence |
|---|---|---|
| `projects.paid_status` | none — INSERT pinned to `unpaid`, UPDATE frozen | tests 14–19, 23 |
| `payments.status`, `payments.amount_paise` | none — no INSERT policy since baseline, no UPDATE policy at all | tests 4, 22 (0 rows) |
| `orders.status`, `cost_printer_paise`, `price_platform_paise` | none — same shape as payments | tests 5, 22 (0 rows) |
| `user_roles.role` (authorisation, not money) | none for non-admins — only `Admins manage roles`, whose `USING (has_role(auth.uid(),'admin'))` is also the `WITH CHECK` for a `FOR ALL` policy, so a client cannot self-grant | test 21 |
| `activity_logs` | none — client INSERT policies dropped | test 6 |
| `profiles` | self-scoped, no trusted field (name/phone/language/last_login) | policy review |

No second equivalent hole was found; none of these required a change, and no
payment functionality was designed or built.

### Tests added

`supabase/tests/rls/01_rls_attacks.sql` grew from 13 to **24** assertions, all
executed. New ones assert the **final stored state** and that no row exists on
rejection — never merely that something threw:

14 `fully_paid` project INSERT rejected, no row · 15 `base_paid` rejected, no
row · 16 explicit `NULL` rejected, no row · 17 legitimate create still works and
stores `unpaid` · 18 cross-user paid create rejected, no row · 19 owner
UPDATE+DELETE intact with `paid_status` still frozen · 20 `service_role`
paid-state INSERT still works · 21 client cannot self-grant `admin` ·
22 client cannot update `payments`/`orders` rows (0 rows) · 23 `anon` project
INSERT rejected · 24 migration/seed (`postgres`) context can still set paid
state.

Tests 23–24 exist to pin the new `current_user` boundary in all four contexts
that matter: `anon`, `authenticated`, `service_role`, and the
migration/maintenance role.

### Result

`STAGE0 RLS TESTS PASSED (24)`, psql exit 0 under `ON_ERROR_STOP`.
The criterion "browser clients cannot directly self-activate trusted
paid/payment state" now holds on both `INSERT` and `UPDATE`, with the trusted
backend path preserved.

### Assumption carried by this repair

The allowlist trusts database **roles**, not JWT claims. In hosted Supabase,
`anon` and `authenticated` cannot `SET ROLE service_role` (no membership
granted), so a browser request cannot reach an allowlisted role. The local
harness enforces the same shape by granting those roles only to the superuser.
This is inherited from the shim assumption already documented in §6 and has not
been re-proved against a hosted project.

### CI after the repair push

The repair was pushed normally (`9fd7ca8..8210c43`, fast-forward, no force).
GitHub created run `36063845026` for head `8210c43`; both jobs again finished in
~2s with 0 steps executed, an empty `runner_name` and "log not found" — the
same runner-allocation failure recorded in §8, i.e. the account billing
condition rather than anything in this diff. The annotations API returned
`404` for this run, so the message text was not re-readable, but the outcome
signature is identical. CI has therefore **still** not been observed green for
either commit; it was not repeatedly re-triggered, and every command it would
run passed locally.
