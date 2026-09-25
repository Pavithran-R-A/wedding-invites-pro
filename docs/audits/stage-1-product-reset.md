# Stage 1 — Product reset, UX foundation and architecture handoff

Audited surface: the whole repository, read as a product contract rather than as a page list.
This report records what changed, what was verified, and what was deliberately **not** done.

---

## Baseline

| Field | Value |
| --- | --- |
| Repository | `Pavithran-R-A/wedding-invites-pro` |
| Baseline branch | `main` |
| Baseline SHA (start point) | `5fa8db35b97d36c9141137b316e051eb80d80024` |
| Working branch | `stage1/vivaahvarnam-product-reset` |
| Branch created from | `origin/main` at the SHA above, no rebase, no history rewrite |
| Package manager | `npm` (canonical). `package-lock.json` is the lockfile of record |
| Environment | Windows 10.0.26200 / x64, Node v24.18.0, Git Bash |
| `core.autocrlf` | `true` — produces benign "LF will be replaced by CRLF" warnings; no line-ending churn appeared in any diff |

The baseline already carried the Stage 0 truth-and-security repair (paid-state guard migrations
and the 24-assertion RLS suite). Stage 1 started from that state and did not touch it.

## Exact branch

`stage1/vivaahvarnam-product-reset`. Single branch, dedicated to this stage. Nothing was merged,
tagged, released or deployed.

## Exact start SHA

`5fa8db35b97d36c9141137b316e051eb80d80024` (`5fa8db3` abbreviated). Verified with
`git merge-base HEAD origin/main` before any edit and again after the final edit.

## Files reviewed

Every tracked file was read or diffed, not sampled. The change surface:

| Group | Count | Notes |
| --- | --- | --- |
| Tracked files modified or deleted | 38 | +902 / −1428 lines |
| New files added | 24 | 16 docs (including this report), 2 scripts, 4 source, 2 tests |
| Total files touched | 62 | |

Areas read in full during the inventory pass: `src/pages/**` (11 routes), `src/components/**`
(landing, auth, brand, ui), `src/lib/**`, `src/hooks/**`, `src/integrations/**`, `src/config/**`,
`index.html`, `tailwind.config.ts`, `src/index.css`, `vite.config.ts`, `vitest.config.ts`,
`package.json`, `.github/workflows/ci.yml`, `supabase/migrations/**`, `supabase/tests/rls/**`,
`README.md`, `.env.example`.

## Old brand cleanup

The retired working name and its owner-platform references were removed from every **active**
surface. Classification of every remaining occurrence, by file:

| File | Occurrences | Classification |
| --- | --- | --- |
| `docs/audits/stage-0-truth-security.md` | several | **Historical evidence.** The Stage 0 report records what the product used to claim. Rewriting it would destroy the audit trail. |
| `scripts/check-product-contract.mjs` | several | **Rule literals.** The strings are the detection patterns themselves; excluding them is what makes the checker able to run. |
| `scripts/product-contract.test.mjs` | several | **Test fixtures.** Negative cases that prove the rules fire. |
| `src/**`, `supabase/**`, `.github/**`, `index.html`, `package.json`, `README.md`, `docs/product/**`, `docs/architecture/**` | **0** | Clean. |

Structural removals:

- `.lovable/plan.md` deleted; the `.lovable/` directory no longer exists.
- `lovable-tagger` removed from `devDependencies`.
- `vite.config.ts`: the tagger import and the `mode === "development" && componentTagger()` plugin
  entry removed; the config no longer needs the callback form.
- `package.json` `name`: `vite_react_shadcn_ts` → `vivaahvarnam-web`.
- `bun.lockb` deleted. The template shipped a Bun lockfile next to `package-lock.json`; `npm` is
  the canonical package manager and `package-lock.json` is the only lockfile retained. This is
  leftover removal, **not** a package-manager conversion.
- `supabase/tests/rls/run*.sh`: Docker container-name prefixes `yourinvite-*` → `vivaahvarnam-*`.
- `index.html`: `<title>`, `description`, `author`, `og:*` and `twitter:*` metadata rewritten.
- `src/App.css` deleted (empty template leftover).

## VivaahVarnam identity

Single source of truth: `src/config/product.ts`.

| Key | Value |
| --- | --- |
| `name` | `VivaahVarnam` |
| `descriptor` | `Digital Wedding Patrika` |
| `tagline` | `Tradition, beautifully invited.` |
| `status` | `Preview` |
| `brandStatus` | `PRELIMINARY WORKING BRAND — NOT LEGALLY CLEARED` |

`PRODUCT_STATUS_LABEL` (`VivaahVarnam — Preview`) is derived, not duplicated. Nothing in `src/**`
carries a hardcoded brand string any more; `BrandLockup` even derives its two-tone wordmark split
from `PRODUCT.name` via `splitWordmark()`, so a rename touches one file.

No trademark or registered-mark symbols, no legal-entity claim, no address, no domain, no email
address, no social handle, and nothing was purchased or registered. See
[`../product/brand-clearance.md`](../product/brand-clearance.md) — status `NOT CLEARED`.

## Visual reset

`src/index.css` now defines brand primitives as HSL channels and aliases the shadcn tokens onto
them, so a component can consume either name and get the same colour:

- Primitives: `--paper`, `--ink`, `--ceremonial`, `--gold`, `--success`, plus `--line` and
  `--surface`.
- Aliases: `--background: var(--paper)`, `--primary: var(--ceremonial)`,
  `--muted-foreground: var(--ink-muted)`, and the rest of the shadcn set.
- `.dark` overrides the primitives only. **There is no user-facing theme switch** — no toggle
  exists in the UI, so the dark block is a foundation, not a shipped feature, and is described
  that way in the docs.

`tailwind.config.ts` exposes the primitives as `paper`, `ink`, `ink-muted`, `surface`, `line`,
`ceremonial`, `gold`, `success` and the display/body font families.

Removed with the template gallery: the shimmer and float keyframe animations and the
image/emoji-based gallery markup.

Five `overflow-hidden` uses remain in application code: the design-direction card frame and the
invitation-preview frames in `CreateProject` / `EditProject` (rounded-corner clipping), the
mobile-menu disclosure (height-transition clipping), and the hero section (decorative background
flourish). None of them is masking a layout bug — measured, not assumed: at 360px every
`overflow-hidden` element on all eight public routes was checked for `scrollWidth > clientWidth`
and the result was **0 overflowing containers on every route**.

## Typography

Latin faces load first, then one Noto face per supported script, so an unsupported glyph falls
through to a face that can draw it rather than to a tofu box:

`Playfair Display` (display) → `DM Sans` (body) → `Noto Sans Tamil` → `Noto Sans Telugu` →
`Noto Sans Kannada` → `Noto Sans Malayalam`, loaded as one Google Fonts CSS2 request with
`preconnect` hints in `index.html`.

This is **stack wiring, not typographic QA.** No native-speaker review of rendered invitation
copy was performed, and the docs say so.

## Landing changes

The landing page was repositioned to describe the product that exists, in this order: hero →
product idea → how it works → design directions → footer.

- Hero: tagline, descriptor overline, `Preview` status chip, and body copy that states plainly
  that today the product creates and previews a draft. Primary CTA is
  `Create an Invitation Draft`; secondary CTA jumps to the design directions.
- `HowItWorksSection` splits the flow into three explicitly separate panels: a numbered
  **target** flow, **Available in this preview**, and **Planned for V1** captioned
  "Not built yet. No date to promise you."
- `TemplateGallerySection` was deleted and replaced by `DesignDirectionSection`: six labelled
  directions — Tamil + English Traditional, Telugu Ceremonial, Malayalam Elegant, Kannada Classic,
  Contemporary South Indian, and Bilingual Family Invitation — each carrying a `Preview concept`
  badge and showing a real script sample (`தமிழ் · English`, `తెలుగు`, `മലയാളം`, `ಕನ್ನಡ`,
  `English`, `தமிழ் · తెలుగు · English`) rather than stock imagery. A closing line states the
  directions are not the designs currently loaded in the preview and none is purchasable.
- `ProductStorySection` closes with: "These are design commitments for the product, not a claim
  that every one is fully implemented today."
- `TrustSection` retains only claims that are true of the code today.
- Footer: brand lockup, absolute fragment links, and the standing disclosure
  "Sharing, RSVP, publishing and payment are not available yet."

## Application terminology

The template vocabulary was replaced with the product's own, in code and in copy:

| Retired | Now |
| --- | --- |
| "template" (as the user-facing unit) | design direction; `projects` remains the storage name and is documented as foundation |
| "designer" / "editor" (as a finished feature) | invitation draft, draft editor (labelled foundation) |
| "buy" / "pay and create" / "checkout" | removed — no payment surface exists |
| "guest list" (implying per-guest records) | guest household (target V1 term, marked planned) |
| generic "wedding invitation" | digital wedding **patrika** |

`src/lib/i18n.ts` carries the language set: `en`, `ta`, `te`, `ml`, `kn`, with native-script
labels distinct from the English labels.

## Docs produced

| Path | Purpose |
| --- | --- |
| `README.md` | Rebuilt: status, brand status, purpose and priority order, what works today, target V1, rollout order, principles, code map, security baseline, local development, database testing, CI note, license |
| `docs/product/README.md` | Doc index, the "current implementation ≠ target V1" rule, shared vocabulary |
| `docs/product/v1-scope.md` | Host and guest journeys, 20-row V1 IN, 12-row V1 OUT, the five-question gate for anything new |
| `docs/product/invitation-semantics.md` | Patrika section order, "there is no universal religious order", tradition-pack controls |
| `docs/product/structured-creator.md` | Structured / freeform / hybrid table and the governing rule |
| `docs/product/content-governance.md` | Pack statuses, review metadata, six hard rules |
| `docs/product/commercial-model.md` | Target price bands, rejected patterns, legitimate premium sources |
| `docs/product/brand-clearance.md` | `NOT CLEARED`, nine-row open checklist, rename procedure |
| `docs/product/design-principles.md` | Ten principles, UI accessibility targets, measured deviations |
| `docs/product/feature-readiness.md` | Every capability marked IMPLEMENTED / FOUNDATION / PLANNED V1 / LATER / EXCLUDED |
| `docs/architecture/decisions/0001..0005` | Five ADRs |
| `docs/architecture/stage-2-domain-blueprint.md` | Documentation-only domain design |
| `docs/audits/stage-1-product-reset.md` | This report |

## V1 scope

Read `docs/product/v1-scope.md`. In short, V1 is the complete host-and-guest loop for one
invitation: create → choose direction and languages → enter structured details → preview as a
patrika → family approval pinned to an exact version → publish one link → households see only
their scope and reply → export.

Explicitly **not** V1: a wedding super-app, a Canva competitor, a planner replacement, a seating
planner, a travel app, an automated religious-advice system, an AI ceremonial-wording authority,
or a generic website builder.

## Commercial targets

Every figure in `docs/product/commercial-model.md` is labelled
**TARGET / SUBJECT TO PILOT VALIDATION**: ₹0, ~₹999, ~₹2,499, ~₹4,999, ~₹9,999+.

- No price is exposed as current or live anywhere in the product.
- No price is hardcoded in `src/**`; the product checker fails the build on the retired ₹199 copy.
- No GST, tax, invoice or payment-provider treatment is implemented or claimed. Tax treatment is
  stated as deliberately unstated.
- Rejected and recorded as rejected: per-guest charging, charging for maps/QR/CSV export, and
  micro add-ons.
- No payment integration exists, and none was added.

## Tradition-pack principle

A tradition pack is **data, reviewed and versioned**, never code and never an inference:

- Selection is always explicit. A name, a surname, a community label or a location is not
  evidence of a tradition, and nothing may be auto-applied from one.
- No caste assumption, no religious assumption, no tradition assumption and no language
  assumption is derived from identity anywhere in the design or the docs.
- Packs carry a status (`draft` / `reviewed` / `approved` / `deprecated`) and named human review.
- AI-generated translation or religious/ceremonial wording never silently becomes authoritative
  pack content.
- Stage 1 produced the **document model and governance rules only**. There is no tradition-pack
  runtime engine, and the blueprint says so on its first line.

## Design principles

Ten principles in `docs/product/design-principles.md`; the load-bearing ones are patrika-first
composition, elder accessibility, script support as a requirement rather than a skin, and honest
status labelling everywhere.

The accessibility table states thresholds (4.5:1 body contrast, ≥16px base body, ≥44×44px touch
targets, usable at 360px, visible focus, motion off under `prefers-reduced-motion`) and is
immediately followed by: **these are internal design targets, not a compliance certification.**

A `Known deviations measured in the Stage 1 QA pass` subsection now records the three gaps found
during this stage rather than leaving the table overstated: text inputs and buttons render at
40px, inline in-sentence links stay at text height, and `lang` is set on the document only.

## ADRs

| ADR | Decision |
| --- | --- |
| 0001 | Patrika-first composition, not a freeform canvas |
| 0002 | Structured creator; freeform only where meaning is expressive |
| 0003 | Data-driven, human-reviewed tradition packs |
| 0004 | One canonical invitation record, many derived outputs |
| 0005 | Server-authoritative commerce and entitlement state |

ADR 0005 memorialises the Stage 0 finding in full: a `FOR ALL` policy reuses its `USING` clause as
its `WITH CHECK`, so the first UPDATE-only guard left the INSERT path open; a column `DEFAULT`
resolves before `WITH CHECK` and before a `BEFORE` trigger; the repair uses a
`SECURITY INVOKER` guard with a `current_user` allowlist and raises `42501`. Eight binding rules
follow, including "every trusted column gets an attack test."

## Stage 2 blueprint

`docs/architecture/stage-2-domain-blueprint.md`, headed **THIS IS DOCUMENTATION ONLY.**

19 entity entries (purpose, ownership, relationships, invariants, sensitivity, table-vs-JSON, and
a necessity challenge for each), a section on the 13 nouns that should **not** become tables,
28 numbered invariants (I-01 … I-28), the version-and-approval design with an ASCII model and the
explanation of why editing after approval cannot silently retain approval, ten token-security
principles (path not query string, hashed at rest, revocable, expirable, rate limited, scoped to
version and event), an output-architecture table for the live page, OG image, raster image, PDF,
QR, print and video surfaces with six cross-cutting rules, and a closing "what Stage 2 should
decide first."

No migration, no table, no SQL and no runtime code was produced from it.

## Product checker

`scripts/check-product-contract.mjs` — a scope-aware Node ESM CLI, both importable and executable.

- 9 rules: `retired-brand-name`, `retired-brand-phrase`, `retired-domain`,
  `retired-per-guest-pricing`, `retired-payment-cta`, `retired-payment-confirmation`,
  `retired-price-point-copy`, `fabricated-social-proof`, `fabricated-testimonials`.
- `MUST_NOT_MATCH` guards against over-banning: the checker asserts that `Razorpay`, `payment` and
  `entitlement` are *not* blanket-forbidden, so honest architecture prose can still name them.
- Scope awareness: `docs/audits/**` and `scripts/**` are excluded, so historical evidence and the
  rule literals themselves cannot self-trigger.
- `Trusted by` is digit-constrained, so honest prose ("trusted by default") does not fail.
- `resolveRepoRoot()` falls back to `process.cwd()` because jsdom rewrites `import.meta.url` to an
  http URL under test.
- The CLI body is guarded by an `isMain` check, so importing the module has no side effects.

Wired in as `npm run product:check` and as a CI step between typecheck and unit tests.
Self-test: 9 rules loaded. Live scan: **121 active files, 0 violations.**

## Dependency and package cleanup

- `npm` remains canonical. No package-manager conversion was performed and no new package manager
  was introduced.
- Lockfiles: `package-lock.json` is the only lockfile tracked. `bun.lockb` was deleted as template
  leftover. `pnpm-lock.yaml` and `pnpm-workspace.yaml` appeared in the working tree from an outside
  tool and are **unrelated to this stage — they were left untouched and are not staged or
  committed.** They remain untracked.
- `lovable-tagger` removed from `devDependencies`; no dependency was added anywhere in Stage 1.
- `src/components/ui/**` retains vendored shadcn primitives the application does not currently
  import. Measured rather than guessed: **33 of 48** have no import from application code
  (accordion, alert, alert-dialog, aspect-ratio, avatar, breadcrumb, calendar, carousel, chart,
  checkbox, collapsible, command, context-menu, drawer, dropdown-menu, form, hover-card, input-otp,
  menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area,
  sidebar, slider, switch, table, tabs, textarea, toggle-group). They were **not** deleted: they
  are the design-system layer Stage 2 builds on, the 8 remaining lint warnings live inside them,
  and removing a third of the component library is a broad change that belongs in its own reviewed
  pass, not in a brand reset. Recorded here as known dead weight.
- Pre-commit repository inspection: `git status --short`, `git diff --check`,
  `git diff origin/main` and the untracked enumeration were all reviewed. No `.env`, no credential,
  no build output, no release artifact and no migration is in the change surface.

## Browser QA

Run against the Vite dev server on `http://localhost:8080` in Chrome, desktop 1440×900.

| Route | Result |
| --- | --- |
| `/` | Renders; title `VivaahVarnam — Digital Wedding Patrika`; hero, product idea, how-it-works, design directions, footer all present; Available/Planned panels correct |
| `/login` | `h1` "Welcome back"; both inputs labelled; `autoComplete` present |
| `/signup` | `h1` "Create your account"; three labelled fields |
| `/reset-password` | `h1` "Reset Password" |
| `/privacy-policy` | `h1` "Privacy Policy"; footer fragment links resolve |
| `/terms-of-service` | `h1` "Terms of Service"; no dead fragment anchors |
| `/cookie-policy` | `h1` "Cookie & Storage Policy" |
| unknown route | 404 page, `h1` "We could not find that page", single recovery link |
| `/dashboard` | Redirects to `/login` |
| `/create-project` | Redirects to `/login` |
| `/project/:id/configure` | Redirects to `/login` |
| `/project/:id/edit` | Redirects to `/login` |

Defects found and fixed during this pass:

1. Hero descriptor overline used `text-gold` on `paper` — measured **2.54:1**, the only genuine
   contrast failure. Changed to `text-ceremonial` with the reason left as a comment.
2. Footer product links used bare `#design-directions` fragments, which resolve to nothing when the
   footer renders on a legal page. Now absolute (`/#design-directions`).
3. The mobile menu could not be dismissed with the keyboard. Escape now closes it and resets
   `aria-expanded`.
4. Auth inputs had no `autocomplete`, producing a browser console usability warning. Added
   `email`, `current-password`, `new-password` and `name`.
5. Touch targets: footer nav links, the header lockup, mobile-menu items and links, the cookie
   banner buttons and the 404 lockup measured 16–36px against the documented 44px target. All
   raised to ≥44px.
6. Two essential disclosure lines and the `Preview concept` badge sat at 11–12px; raised, and the
   size rule in `design-principles.md` was sharpened to distinguish running copy from badge
   microcopy rather than quietly restating the old rule.

The contrast probe used is WCAG relative luminance with **alpha compositing** of both the
foreground colour and the element opacity over a resolved ancestor background stack. An earlier
version of the probe ignored alpha and derived backgrounds from `parentElement`, which produced
four false failures and would have missed real ones; it was rewritten before any conclusion was
drawn. Final run: 92 text nodes on the landing page, **0 failures**.

## Mobile QA

Widths 360×740 and 390×844, `deviceScaleFactor: 3`, `isMobile`, `hasTouch` — real viewport
emulation, not a resized window.

Checked at both widths on all twelve routes above: horizontal overflow, elements extending past the
viewport, clipped text (`scrollWidth > clientWidth` on non-scrollable containers), touch-target
heights, form-label association, and heading content.

**Result: 0 overflow offenders, 0 clipped elements, 0 unlabelled inputs, 0 contrast failures on
every route.** `documentElement.scrollWidth` equals the viewport width on every page.

Specifically confirmed:

- Brand lockup renders on one line, no wrap, no clipping; the long descriptor
  "Digital Wedding Patrika · Preview" fits at 360px.
- Hero tagline wraps to two lines cleanly at 360px; CTA buttons are full-width and stack.
- Design-direction cards collapse to a single column; the `PREVIEW CONCEPT` badge, Telugu, Tamil,
  Kannada and Malayalam samples all render without clipping.
- Available/Planned panels stack; list text wraps inside the card.
- Mobile menu: hamburger is 44×44, `aria-expanded` toggles `false → true → false`, all four items
  are ≥44px tall, Escape closes it, and no item overflows.
- Forms: inputs span the container, labels stay above their fields, no horizontal scroll.
- Footer: three columns collapse to one; the two disclosure paragraphs reflow without clipping.
- Legal copy: long headings such as "Cookie & Storage Policy" wrap; no overflow.

Screenshots were reviewed at 360px for the hero, the design-direction cards, the open mobile menu
and the desktop footer.

## Accessibility review

Manually checked in this pass: heading order and one `h1` per page; programmatic names on every
input; `aria-label` / `aria-expanded` / `aria-controls` on the menu disclosure; `role="status"` on
loading and empty states; focus-visible rings on the lockup, buttons and toggles; contrast across
every route with the composited probe; keyboard dismissal of the menu; touch-target heights;
reflow at 360px; and the brand name announcing as a single string rather than two tones
(`sr-only` full name plus `aria-hidden` decorative halves, covered by `brandLockup.test.tsx`).

**No formal WCAG audit was performed and no compliance or conformance claim is made here.**
The honest status is "designed against internal targets, partially verified manually." Per-script
`lang`, screen-reader pass with a real reader, and 200% zoom reflow were **not** tested.

## Performance and bundle review

From `npm run build` on the final tree — 2178 modules, 20.8s:

| Artifact | Raw | Gzip |
| --- | --- | --- |
| `dist/index.html` | 1.97 kB | 0.72 kB |
| `dist/assets/index-*.css` | 67.34 kB | 11.90 kB |
| `dist/assets/index-*.js` | 742.51 kB | 228.56 kB |

Vite warns above 500 kB for a single chunk. Assessment: this is pre-existing dependency-graph
weight, not Stage 1 growth. Stage 1 **removed** a dev-only plugin (`lovable-tagger`) and its
runtime hook, deleted an image/emoji gallery section and two keyframe animations, and added roughly
10 kB of source across four small components. No dependency was added. CSS shrank slightly.

Code-splitting the router and the editor is a legitimate follow-up, deliberately not attempted
here: it would be a broad refactor of unverified screens, and the brief says not to
premature-optimize. **No Lighthouse run, no field metrics and no Core Web Vitals claim** — none
was measured.

### Bundle figures are install-state sensitive

A later rebuild reported **2186 modules and 817.68 kB / 248.75 kB gzip** from the *same* source
tree, a 75 kB swing with an unchanged CSS hash. Root cause was the environment, not the code: an
unpruned `node_modules` left by earlier install activity resolved extra transitive copies into the
graph. Deleting `node_modules` and running `npm ci` against the committed lockfile reproduced the
table above exactly (2178 modules, `index-Ckuecta3.js` 742.51 / 228.56 kB).

The lockfile-clean numbers are therefore the figures of record, and any future comparison must be
made from `rm -rf node_modules && npm ci` — a build from a drifted install will look like a
75 kB regression in code that never changed.

## Test counts

`npm test` → **4 files, 26 tests, all passing.**

| File | Tests | Covers |
| --- | --- | --- |
| `src/test/productConfig.test.ts` | 5 | Brand config equality, no pricing/contact/domain keys, status label, language codes, native labels distinct from English |
| `src/test/brandLockup.test.tsx` | 5 | Single announced name, decorative halves, full variant shows descriptor and status, link and non-link forms |
| `src/test/sanitizeSvg.test.ts` | 8 | SVG/XSS sanitization boundary (Stage 0) |
| `scripts/product-contract.test.mjs` | 8 | Self-test, all 9 rules fire, exact line/column, honest text untouched, `MUST_NOT_MATCH`, exclusions, inclusions, live repo scan clean |

`src/test/example.test.ts` was deleted — it asserted nothing about the product and existed only to
raise the count. No replacement snapshot tests were written to pad the total.

## RLS result

`bash supabase/tests/rls/run.sh` on `postgres:16-alpine` via Docker, applying all four migrations
with `ON_ERROR_STOP`:

**24 passed / 0 failed — `RESULT: PASS`.** Expected count unchanged.

Includes the Stage 0 INSERT-path repair: #14 `fully_paid` INSERT rejected, #15 `base_paid` rejected,
#16 `NULL` rejected, #17 legitimate create still stores unpaid, #18 cross-user paid INSERT rejected,
#20 `service_role` paid-state INSERT intact, #23 anon INSERT rejected, #24 migration/seed context
still able to set paid state.

## Local gate results

All run from a clean `npm ci` **after** the final edit, so this verification postdates every change
recorded above.

| Gate | Command | Result |
| --- | --- | --- |
| Clean install | `npm ci` | Pass |
| Lint | `npm run lint` | **0 errors**, 8 warnings |
| Typecheck | `npm run typecheck` | Pass |
| Product contract | `npm run product:check` | 121 files, **0 violations** |
| Unit tests | `npm test` | 4 files, **26 passed** |
| Build | `npm run build` | Pass |
| Audit (prod, high+) | `npm audit --omit=dev --audit-level=high` | **exit 0** |
| Audit (prod, any) | `npm audit --omit=dev` | exit 1 — 2 moderate |
| Audit (all) | `npm audit` | exit 1 — 6 (5 moderate, 1 high) |
| Database RLS | `bash supabase/tests/rls/run.sh` | **24 / 24** |
| Whitespace | `git diff --check` | Clean |

The 8 lint warnings are all `react-refresh/only-export-components` inside vendored
`src/components/ui/**` shadcn primitives. Pre-existing, not errors, and not touched.

## Known limitations

1. **Brand not cleared.** `VivaahVarnam` is a preliminary working name. No search was performed
   and none is claimed. See `docs/product/brand-clearance.md`.
2. **Protected screens verified only as redirects.** `.env` points at the historical Supabase
   project and no account was created, so `/create-project`, `/project/:id/configure` and
   `/project/:id/edit` were verified to redirect to `/login` — not exercised. No backend state was
   fabricated to reach them. Their correctness is unverified.
3. **No production Supabase project** was created, and no unrelated project was connected.
4. **Dependency advisories.** `npm audit` reports 6: one high in `vite` (dev-server path traversal
   and `launch-editor` NTLMv2 disclosure — dev-time surface only, not in the shipped build), and
   moderates in `vitest`/`@vitest/mocker`, `esbuild`, and `react-router`/`react-router-dom`.
   The production-scope high-and-above gate passes. The `react-router` pair is the one that ships:
   the open-redirect advisory concerns dynamically-built navigation targets, and every `Link` in
   this app takes a static literal path; the `deserializeErrors()` SSR-hydration advisory does not
   apply because there is no server rendering. Both fixes require `react-router-dom` 7.x, a
   breaking major version, so they are recorded rather than performed.
5. **Bundle exceeds Vite's 500 kB chunk warning** for a single un-split JS chunk. Cause and
   non-regression are documented above; code-splitting is a follow-up.
6. **Typography is stack wiring, not script review.** No native-speaker verification of rendered
   copy.
7. **Form controls render at 40px** against the 44px internal target — a shared-component-library
   default left alone deliberately, since changing it re-densities screens that cannot be reviewed
   without a backend. Recorded in `docs/product/design-principles.md`.
8. **No analytics, no monitoring, no error reporting** is configured. Nothing was claimed.
9. **Unused scaffold remains.** `guests`, `orders`, `payments`, `printers` and `activity_logs`
   exist in the schema from the earlier prototype but are not read or written by any application
   code. This is stated in `docs/product/feature-readiness.md` rather than silently left out; the
   Stage 0 RLS suite proves they are client-inaccessible.
10. **Independent subagent review was not performed** for this stage's documentation set; the
    claims were verified against repository state directly.

## External CI quota deferral

The repository's `verify` workflow is filtered to `main`, so pushing `stage1/vivaahvarnam-product-reset`
does not itself run it. Runs observed on the historical branch that failed during **runner
allocation** — zero steps executed, the runner never started — are classified
`EXTERNAL CI QUOTA DEFERRAL`. This is a private-repository Actions minutes condition, not a code
result.

Per instruction, CI was **not** weakened, **not** removed, and no good repository code was changed
to chase those red runs; no self-hosted runner was configured, no billing was touched, and the
runs were **not** repeatedly re-triggered.

Every gate that the workflow would have run was executed locally instead, from a clean install,
after the final edit — see the table above. No zero-step run was counted as a code failure, and no
code failure was labelled as quota-related.

## Stage 2 boundary confirmation

Explicitly confirmed: **no Stage 2 migration, schema or runtime code was created.**

`git diff --name-status origin/main -- supabase/migrations/` returns **empty**. The migrations
directory still contains exactly the four files present at the start SHA. Nothing in Stage 1 adds
a table, column, policy, trigger, index or function.

Not produced, by design: real event, venue, approval, guest-household, RSVP or entitlement schema;
any domain migration; payment or Razorpay integration; a public invitation route; the
tradition-pack runtime engine; a QR generator; a PDF generator; a publishing system; a live OG
image generator; a video renderer; an admin system. The Stage 2 blueprint is prose and tables
only, and says so on its first line.

`npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run product:check`,
`npm run build` and the RLS suite all pass on the tree as committed, with no Stage 2 code present.

## Commit and push record

Three substantive commits, on `stage1/vivaahvarnam-product-reset` only, from a clean index. Every
path was staged explicitly by name; `git add .` and `git add -A` were never used.

| Commit | Message | Surface |
| --- | --- | --- |
| `31cc947` | `feat: establish VivaahVarnam product identity` | 41 files, +1081 / −1389 |
| `9054dbf` | `docs: define VivaahVarnam v1 product architecture` | 17 files, +2495 / −37 |
| `78cc704` | `chore: add scope-aware product contract verification` | 4 files, +356 / −2 |
| | **Substantive total vs `main`** | **62 files, +3932 / −1428** |

Two further commits amend this audit record alone — this commit and
`docs: record Stage 1 commit, push and CI outcome` — adding the CI/push evidence above and the
install-sensitivity note in the bundle review. Neither touches application code, so the 62-file
substantive surface above is unchanged by them. The branch tip is the commit that contains this
file — `git rev-parse HEAD` and `git ls-remote origin` were confirmed identical after the final
push, and the exact tip SHA is stated in the Stage 1 handoff report rather than here, because a
document cannot record its own commit hash.

Author identity was supplied per-invocation with `git -c user.name=… -c user.email=…`; no git
config was created or modified. No history was rewritten, rebased, amended or force-pushed.

Push and remote verification, at first push `78cc704` and again after each audit-record push:

| Check | Result |
| --- | --- |
| `git push -u origin stage1/vivaahvarnam-product-reset` | New remote branch, normal fast-forward push, no `--force` |
| Local vs remote SHA, `git ls-remote` | identical |
| Local vs remote SHA, `gh api …/branches/…` | identical |
| `origin/main` after every push | `5fa8db35b97d36c9141137b316e051eb80d80024` — unchanged, not merged into |
| Tags on the repository | `0` |
| Releases on the repository | `0` |
| Pull request | **Not created** — not requested by this stage |

The remote tree at the pushed SHA was enumerated with `gh api …/git/trees/…?recursive=1` (138 blobs)
and checked path by path. All 23 required paths are present: the product config, the brand lockup,
the two new landing sections, the rebuilt README, all nine `docs/product/` documents, all five ADRs,
the Stage 2 blueprint, this report, and both checker files. All six retired paths are absent:
`.lovable/plan.md`, `bun.lockb`, `src/App.css`, `public/placeholder.svg`,
`TemplateGallerySection.tsx`, `src/test/example.test.ts`. `pnpm-lock.yaml` and
`pnpm-workspace.yaml` are **absent from the remote tree** — left untracked and untouched as
instructed — and the only `.env`-shaped path in the tree is `.env.example`, which holds
placeholders.

Re-verification performed **after** the final edit, against a lockfile-clean install:

| Check | Result |
| --- | --- |
| `rm -rf node_modules && npm ci` | exit 0 |
| `git diff --check origin/main..HEAD` | exit 0 — no whitespace errors in the pushed range |
| `npm run lint` | 0 errors, 8 warnings (`react-refresh` in vendored `src/components/ui/**`) |
| `npm run typecheck` | exit 0 |
| `npm run product:check` | 121 active files scanned, 0 violations |
| `npm test` | 4 files, 26 tests passed |
| `npm run build` | 2178 modules; `index-Ckuecta3.js` 742.51 kB / 228.56 kB gzip — matches the table of record above |
| `npm audit --omit=dev --audit-level=high` | exit 0 |
| `npm audit --omit=dev` | 2 moderate (`react-router` / `react-router-dom`); the only fix is a breaking v7 major — recorded, not performed |

After all commits the working tree reports only the two untracked pnpm files, exactly as it did
before this stage began.

### Actions inspection after the push

Inspected once; not re-triggered.

- `gh run list --branch stage1/vivaahvarnam-product-reset` returns **no runs**. This is expected
  from the trigger filter, not a failure: `.github/workflows/ci.yml` runs on `push` to `main` and
  on `pull_request` targeting `main`, and this stage neither merged to `main` nor opened a PR.
- The most recent historical run on `main` (`36064058542`, predating this stage) was inspected at
  job level: both jobs concluded `failure` with **`steps: 0`** and an empty step summary, started
  `2026-09-24T21:51:25Z`. Zero steps means the job never received a runner, so no repository code
  executed. Classified `EXTERNAL CI QUOTA DEFERRAL`, not a code failure.
- Consequence, stated plainly: **Stage 1 code has not been executed by hosted CI.** The local gate
  table above is the authoritative verification for this stage. Running the workflow against this
  tree would require merging to `main` or opening a PR, both outside this stage's boundary.
