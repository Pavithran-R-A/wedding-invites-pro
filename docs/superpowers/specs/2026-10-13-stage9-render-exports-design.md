# Stage 9 design — render and export for one immutable invitation version

**Status:** Approved architecture (Approach B) with the corrections issued in the human partner's
approval message folded in. This document is a design contract, not an implementation report: every
`MEASURED` line below was read or run against the repository at the baseline; every other line is a
decision this stage intends to keep and will be tested against.

**Baseline:** `d49cb948c356cdfe3165e1986d2798503fcf8d92` (the merged Stage 8 head, which is also the
remote head of both `main` and `stage9/render-exports` — read back with `git ls-remote` at the start
of this stage).
**Branch:** `stage9/render-exports`.
**Governing ADR:** [`../../architecture/decisions/0004-canonical-invitation-multiple-outputs.md`](../../architecture/decisions/0004-canonical-invitation-multiple-outputs.md).

---

## 1. What Stage 9 owns, and what it does not

Stage 9 turns one immutable `invitation_versions` row into four output families: an Open Graph preview
image, a shareable invitation image, PDFs (A4 and US Letter), and a QR image for the published
address. It owns the render harness, the artefact manifest, the font packaging, the reproducibility
instrument and the security posture of all of it.

It does **not** own: a hosted deployment, a real crawler round-trip, per-invitation HTML served at the
published URL, commerce/entitlement gating of outputs, video, or print colour management. §14 states
the local/production split as a matrix rather than a footnote, because in this stage the boundary is
the most consequential thing being decided.

Two product rules constrain the whole design and are quoted rather than paraphrased:

* ADR 0004 `:26` — "Outputs (page, OG image, static image, PDF, QR target, print asset, video) are
  **renderings of a version**, never independent sources of layout truth";
* `docs/architecture/stage-2-domain-blueprint.md:638-639` — "**No new layout truth in renderers.** A
  renderer needing an off-token special case means the token set or the version schema is incomplete."

## 2. MEASURED substrate this design stands on

Each line was verified by reading or grepping the file named, at the baseline.

| Fact | Evidence |
| --- | --- |
| No server runtime exists. Edge runtime is off and the config says no function ships. | `supabase/config.toml:60-62`, restated at `:81-82`; no `supabase/functions/` directory (`ls` → nothing) |
| One HTML entry, no SSR or multi-entry build, no `build` block at all in Vite config. | `vite.config.ts:1-20` (only `plugin-react-swc`, `server`, `resolve.alias`); `index.html:51` |
| `InvitationRenderer` is a pure function of the DTO: no hooks, no router, no Supabase client, no fetch. | `src/components/invitation/InvitationRenderer.tsx:45-48` (its only imports, all type-only or pure libs); grep for `useState\|useEffect\|useContext\|createClient\|useParams\|fetch(` in that file → **0 matches** |
| Its whole non-DTO environment is the compiled `:root` tokens plus six CDN-hosted faces. | `src/index.css:12-26,31-34`; `index.html:20-23` (`fonts.googleapis.com` + `gstatic.com`) — **retired by S9-2**, see §6.2 "As built" |
| **No font file of any kind is in the repository.** | `find` for `*.ttf,*.otf,*.woff,*.woff2` excluding `node_modules` → empty. **True at spec time only:** S9-2 committed 72 `public/fonts/files/*.woff2`. |
| The published address is one bearer credential per wedding, 43 URL-safe chars, re-parented across republishes, and only its SHA-256 is stored. | `supabase/migrations/20260926130000_stage3_publication_resolution_boundary.sql:488,515,520,988`; `src/integrations/supabase/publicInvitation.ts:38-42`; `private.access_tokens.token_hash` CHECK `^[0-9a-f]{64}$` at `20260925120400_stage2_assets_entitlements_secrets.sql:125` |
| Exactly one active publication per wedding. | `20260925120200_stage2_versions_and_publication.sql:90-92` (`one_active_publication_per_wedding`) |
| One Storage bucket, private, 5 MiB, four MIME types, no PDF/SVG/HTML; keys are DB-minted with no extension. | `20261006120000_stage6_wedding_asset_storage.sql:30-39,70-74` |
| The only link form the product mints for asset bytes is a 60-second signed URL created by the signed-in host. | `src/integrations/supabase/weddingAssets.ts:85,218` |
| `wedding_assets` has no version association, no digest, no output kind and no failure/retry state. | `20260925120400_stage2_assets_entitlements_secrets.sql:12-30` (columns `id, wedding_id, asset_kind, label, object_key, mime_type, size_bytes, is_generated, created_at, updated_at`) |
| Static `og:*`/`twitter:*` tags are brand-only and identical for every route; there is no `og:image` anywhere. | `index.html:34-46`; repo grep for `og:image` → prose only (`docs/architecture/stage-2-domain-blueprint.md:619`) |
| `robots.txt` allows every crawler including `Twitterbot` and `facebookexternalhit`, with no `Disallow`. | `public/robots.txt:1-15` |
| No `noindex` and no `X-Robots-Tag` mechanism exists; the blueprint requires `noindex` on token-bearing URLs. | grep → prose only (`stage-2-domain-blueprint.md:580,599,618`) |
| A hand-written CDP client already drives `--headless=new` Chrome with no puppeteer/playwright, and the refusal is deliberate. | `scripts/stage5-browser-driver.mjs:11-13,70-76`; `scripts/stage4-render-qualification.mjs:682-814` |
| `Page.captureScreenshot` is in use; `Page.printToPDF` is used nowhere in the repo. | `stage4-render-qualification.mjs:807-811`, `stage5-browser-driver.mjs:606`; grep for `printToPDF` in `scripts/` → no matches |
| Chrome 154 already broke two CDP calls and that failure is documented, so a version probe is a known-necessary guard. | `scripts/stage5-browser-driver.mjs:409-413` |
| The browser bundle holds no service-role key and a checker rule enforces it. | `scripts/check-product-contract.mjs:265-272` (`service-role-key-in-browser-code`) |
| `api` is the only browser-visible schema; five functions are anonymous-callable today. | `supabase/config.toml:32`; `20260926150000_stage3_privileged_bodies_behind_wrappers.sql:655`, `20261008120000_stage7_family_approval_review.sql:882,886`, `20261009120000_stage8_guest_invitations_rsvp.sql:1207,1211` |
| The sharing affordance today is clipboard + `navigator.share` + a `wa.me` hand-off link with no image. | `src/components/invitation/PublicationPanel.tsx:126,135-142,248-255` |
| Existing UI already lists QR/PDF as planned, not built. | `src/pages/ConfigureProject.tsx:150-158`; `src/components/landing/HowItWorksSection.tsx:25-31` |
| Readiness currently records: QR "No generator", image "No renderer", PDF "No generator", OG "no per-invitation OG generation". | `docs/product/feature-readiness.md:227-230` |

## 3. The three approaches, and why B

**A — generate in the host's browser tab** (`html-to-image`/`foreignObject` + `window.print`). No
infrastructure at all. Rejected on two independent grounds. Rasterising through SVG `foreignObject`
requires inlining the stylesheet and base64-inlining every font, and Indic shaping inside that path is
engine- and version-dependent — the one thing ADR 0004 `:54-55` names as the shared risk would become
an unmeasurable claim. And `window.print()` produces a file only through a user dialog: no bytes to
hash, so ADR 0004 `:36` ("the same version plus the same inputs must produce byte-similar output")
cannot be satisfied, and an OG image has no artefact to be served.

**B — a locally operated Chromium render worker driven over raw CDP** — **selected.** The engine that
rasterises is the same engine that draws the guest page, so font resolution, shaping and metrics are
one implementation rather than two. The renderer is provably pure (§2, row 3), so a fixed-size output
is the *same component* at a different root font size and page box — which is what keeps
blueprint `:638` satisfiable instead of aspirational. `Page.captureScreenshot` is already used by the
Stage 4/5 instruments and `Page.printToPDF` is the same protocol on the same socket, so no browser
automation dependency is added. One npm dependency is added for QR encoding, chosen by measured
transitive footprint (§9.4).

**C — browser-free SVG raster (Satori + resvg-wasm, the Vercel OG pattern).** Deterministic, light, no
Chromium. Rejected because Satori consumes its own JSX subset and cannot take
`InvitationRenderer`'s output: it would fork layout truth, which is precisely the failure ADR 0004
`:15-17` was written to prevent, and it would replace a measured Indic shaping behaviour (Chromium's)
with a second, unproven one. Effort was not the reason for rejection.

## 4. Dataflow: immutable version to every output

```
                          public.invitation_versions.snapshot (jsonb, schema_version 2)
                                      |
                        private.public_invitation_dto(2, snapshot)     ← the ONLY content source
                                      |
             ┌────────────────────────┴────────────────────────────┐
     api.resolve_public_invitation                       api.preview_invitation_document
     (guest page, unchanged)                             (host authoring view, unchanged)
                                      |
        NEW: api.render_invitation_document(version_id) — authenticated wedding member only.
        It returns private.public_invitation_dto(snapshot_schema_version, snapshot) for that
        ONE immutable version. MEASURED reason it must exist: api.preview_invitation takes a
        *wedding* id (20260926150000_stage3_privileged_bodies_behind_wrappers.sql:596-602),
        so nothing today reads a chosen frozen version's DTO without holding the live token.
        No new anonymous surface: GRANT EXECUTE TO authenticated, membership checked inside
        internal_api, and it is the worker's only authorised content source.
                                      |
                 validated PublicInvitation object (src/lib/publicInvitation.ts parser,
                 the same one the guest page uses — a document it refuses cannot render)
                                      |
        Chrome --headless=new, isolated context, dist/render.html, CSP default-src 'none'
           DTO injected via Runtime.evaluate; no URL, no query, no token, no network read
                                      |
        mounted <InvitationRenderer invitation={dto}> under data-render-surface="og|share|pdf"
                     |                                |                       |
        Page.captureScreenshot             Page.captureScreenshot    render.css @page + printToPDF
              og_image 1200×630            share_image 1080×N                A4 / US Letter
                     |                                                     |
                     └────────────── digest → register → upload → verify ──┘
                                      |
                        public.invitation_outputs (manifest row per artefact)
                                      |
              storage: invitation-outputs (private, host-signed-url)   |   invitation-previews
              (public, opaque digest key, OFF unless the host opts in) —┘   §8, §9
                                      |
                            QR: qrcode lib ← the /i/ URL held in the host's session at
                                 publish/rotate time (§9), PNG at 3 print sizes
```

Nothing left of the dashed line invents content. The only per-output freedom is *composition*:
which already-public fields are drawn on a small canvas, in what order, at what size, and where a
page breaks (§6.3).

## 5. Output catalogue

| Kind | Box | Composition contract | Overflow contract |
| --- | --- | --- | --- |
| `og_image` | 1200×630, DPR 1 | A **teaser, never a complete document**: `title`, the people block, the first event's date/time and venue name, drawn by the same component at a fitted root size. | Type may scale down to a legibility floor; below the floor, optional lines are dropped in a fixed priority order. **No mid-string truncation, no ellipsis into a name or a ceremony.** The manifest and UI never describe this artefact as the invitation. |
| `share_image` | 1080 wide; height derived from content and **quantised up to one of four boxes** — `1080×1350`, `1080×1620`, `1080×1800`, `1080×2160`; content taller than the last box continues onto a second page of the same set | The whole document, same order as the page. 1080×1350 is the common case, not a mandate that crops. Quantisation exists because a fixed shape set is what makes "legible at chat-thumbnail size" testable — an unbounded height set is not. | **Never cropped.** A paginated set (`page 1 of 2`) is the designed outcome for long documents, which is why `variant` and `page_number` exist as separate columns (§7). |
| `pdf` (variants `a4`, `letter`) | 210×297 mm / 215.9×279.4 mm | The whole document, paginated. A section heading never separates from its first body line; an event block stays whole; the top double rule appears on page 1 and the bottom rule on the last page. | Bounded page count with a named refusal rather than silent loss. Tagged PDF (`generateTaggedPDF`) so the file has structure and a title, not just glyphs. |
| `qr` | PNG at 3 module sizes for print (25 mm, 40 mm, 60 mm nominal) | The published `/i/` URL only (§9). Error-correction level `M`, quiet zone 4 modules, high contrast against the paper token. | A URL that does not fit the chosen version/EC combination is a **refusal with a reason**, not a smaller QR. |

`og_image` and `share_image` are WebP **and** PNG (a crawler-facing type plus a chat-attachable type);
`pdf` and `qr` are single-format. Geometry lives in `variant` (the §5 set: `1200x630`, the four share
boxes, `a4`, `letter`, `25mm`, `40mm`, `60mm`) and `png`/`webp`/`pdf` lives in `format` (§7.2, whose
CHECK enumerates the same set exactly), because the same geometry exists in two image types.

## 6. Rendering and typography

### 6.1 One component, three surfaces

`InvitationRenderer` is not modified except to accept an optional `surface` prop that writes
`data-render-surface` on the article root. `src/render/render.css` may set the root font size, page
boxes, margins, page-break rules and the crop for `og_image`. It may **not** set a colour, a type size
or a spacing that `src/index.css` tokens already govern; an output that needs an off-token value is
recorded as a token-set gap (ADR 0004 `:29-30`) in the audit, and the token set is widened instead.

### 6.2 Fonts are self-hosted and version-pinned

At spec time the six faces came from `fonts.googleapis.com` (`index.html:20-23`) and no font file
existed in the tree. Stage 9 changes that deliberately:

* `public/fonts/` receives the pinned Latin and Indic faces the product already offers
  (`Playfair Display`, `DM Sans`, `Noto Sans Tamil/Telugu/Kannada/Malayalam`, weights 400/500/600/700 —
  `src/pages/EditProject.tsx:117-124` is the menu they must keep matching), in **TTF** so the same file
  serves both `@font-face` and Chromium's PDF embedding path. *(As built: woff2 — see correction 1
  below.)*
* `index.html` drops the CDN `<link>` and both `<preconnect>` lines and gains local `@font-face`
  rules with `font-display: swap`. The measured-referrer comment block at `index.html:6-16` describes a
  request that no longer happens; it is corrected in place with a pointer to this stage's audit, and
  the retracted Stage 3 font finding (`docs/architecture/render-contract.md` §5.3) is referenced rather
  than re-litigated.
* **Licensing and provenance are recorded, not assumed.** Each face gets a row in
  `docs/architecture/render-outputs.md` with: upstream source URL, family, style, weight, licence
  (expected SIL Open Font License 1.1 for all six — **verified against the file that ships with each
  download before commit, not from memory**), version string read from the font's own `name` table,
  byte size and SHA-256. The OFL text files are committed beside the fonts they cover. *(As built: the
  `name` table was not parsed — see correction 2 below.)*
* A build-time checker (`scripts/check-render-assets.mjs`, run by the font tier and by
  `npm run product:check` wiring if it stays cheap) re-hashes every file in `public/fonts/` against
  the recorded table. A font that silently changes is a red gate, not a subtle metrics drift.
  *(As built: its own `npm run render:check` gate — see correction 3 below.)*

**As built (S9-2), including the three places this section was wrong.**

The shipped surface is **72 woff2 faces, 1,006,240 bytes (982.7 KiB)**, six families × four weights ×
their own subsets (DM Sans latin + latin-ext; Playfair Display latin, latin-ext, cyrillic, vietnamese;
each Noto face latin, latin-ext and its own script), plus `public/fonts/fonts.css` (28,640 bytes, 72
`@font-face` rules) and six OFL-1.1 licence texts. `public/fonts/font-manifest.json` (496,883 bytes)
records per family the package name, version `5.3.0`, CSS family, `OFL-1.1`, and the registry tarball's
URL, byte count, SHA-1 and SHA-512; per face the label, file path, family, style, weight,
`unicode-range`, byte count and SHA-256; per licence the path, bytes and SHA-256. Nothing was added to
`package.json`: `scripts/fetch-render-fonts.mjs` fetches the six registry tarballs into an OS temp
directory, unpacks them with `tar`, and never executes package code.

1. **TTF was the wrong container reasoning.** The claim "so the same file serves both `@font-face` and
   Chromium's PDF embedding path" assumed the served container reaches the PDF. It does not: Chromium
   embeds what it loaded as a parsed typeface, so the PDF's `/FontFile2` (or `/FontFile3` for a CFF
   face) is derived from the in-memory font, not from the file's wrapper. `@fontsource` ships woff2
   anyway, so carrying TTF would have meant a second unverified copy of every face. §6.3's
   "a `/FontFile2` per face actually used" therefore stays an assertion to be *measured* on the first
   real PDF in S9-6, including which `/FontFile` variant Chromium picks for a woff2-sourced face.
   If that measurement comes back saying a face was not embedded at all, it is a Stage 9 finding, not a
   reason to have pre-emptively committed TTF bytes.
2. **The `name`-table version string was not read.** Reading it from woff2 needs a Brotli inflate and a
   TrueType table parser; writing either, or adding a dependency, costs more than the field is worth
   when the package version, the tarball digest and 72 per-file SHA-256s already pin the bytes
   reproducibly. The manifest's `version` therefore sits beside `package`, where it reads as the package
   version it is, and its `note` names the generator and the verifier rather than the field.
   The `/BaseFont` name check in §6.3 is unaffected — it is read from the produced PDF, not from the
   source file.
3. **The checker is its own gate.** `scripts/check-render-assets.mjs` runs as `npm run render:check`
   (local only; CI's six commands are unchanged and wiring a seventh is a disclosed handoff item)
   rather than being folded into `product:check`, because it hashes a megabyte of font bytes and the
   two gates fail for unrelated reasons. Its battery is `scripts/renderAssets.test.mjs`, 27 tests, run
   by `npm test` through the `scripts/**/*.test.mjs` pattern already in `vitest.config.ts:11`.

The referrer comment block was corrected in place, and the correction now carries a measured fact
rather than a prediction: `docs/architecture/public-invitation-security.md` records that the 19 font
requests Chromium makes against this origin name the stylesheet, not the page.

Why self-hosting is the right call rather than a preference: reproducibility (an artefact's bytes
cannot depend on a CDN response), privacy (the render pipeline makes zero third-party requests, and
the guest page stops making one on the "mid-range Android on a weak connection" path V1 cares about),
and PDF embedding requiring local programs.

### 6.3 Indic correctness is measured per script, and is not called language review

The glyph instrument already exists (`scripts/stage4-render-qualification.mjs:901-932`): it awaits
`document.fonts.load(...)` for the drawn characters and reports each codepoint without a face. Stage 9
runs that probe on **each render surface**, not only the live page, for Tamil, Telugu, Kannada,
Malayalam and Latin samples with real shaping content (conjuncts, vowel signs, numerals, and a
mixed-script sample). Additionally, for the PDF: the file is opened and its font objects enumerated
from the bytes, asserting an embedded program (`/FontFile2`) per face actually used, a `/BaseFont`
name that matches the pinned family, and no `Type3` fallback. Text-layer fidelity is checked two ways:
structurally, by asserting a `/ToUnicode` CMap per embedded subset (dependency-free, always run); and
operationally, by extracting the PDF's text and comparing its codepoint set to the page's, using
`pdftotext` when the operator's PATH has it — **MEASURED: `/mingw64/bin/pdftotext` is present on this
host.** It is an *instrument* dependency, never a product one, and when it is absent the case reports
`SKIPPED: no text extractor available` rather than passing silently. What is *not* claimed, in this
file and in the audit: that any of the shaping was read by a native speaker of any supported script.
That is a deferred human requirement (§15, H-3) — consistent with `render-contract.md` §8.4 and §9.4,
which already withhold the same claim.

### 6.4 The browser is pinned by capability, not by hope

Before any artefact is produced the worker reads `/json/version`, and

1. refuses to run if the major version is not the one recorded in `docs/architecture/render-outputs.md`
   as `validated_against`, unless the operator passes an explicit `--accept-unknown-browser` that
   writes the version into every manifest row it produces;
2. runs a **capability probe** over exactly the CDP calls it uses (`Target.createBrowserContext`,
   `Page.navigate`, `Runtime.evaluate`, `Page.captureScreenshot`, `Page.printToPDF`,
   `Emulation.setDeviceMetricsOverride`) and names each unsupported call;
3. includes the browser version string in the `render_config_hash` inputs (§7), so an upgrade shows up
   as a changed config rather than as an unexplained byte difference. The Chrome 154 removals recorded
   at `scripts/stage5-browser-driver.mjs:409-413` are the precedent for making this a gate.

## 7. Data model

### 7.1 A new table, because `wedding_assets` is the wrong invariant set

The approval asked this be verified rather than assumed. `wedding_assets`
(`20260925120400_stage2_assets_entitlements_secrets.sql:12-30`) models a file a host uploaded: no
`version_id`, no digest, no output kind, no render config, no failure state, and its lifecycle
`staged → ready → tombstoned` (`20261006120000_stage6_wedding_asset_storage.sql:47-49`) is guarded so a
ready row may only move to tombstoned (`:129-135`) — alongside Storage's own deliberate absence of an
UPDATE policy on `storage.objects` (`:275-278`), which is the second half of why that state machine is
pinned rather than incidental. Making it
carry derived artefacts would mean widening that CHECK with `failed`/`invalidated`, adding a version
FK, and changing a DB-minted key formula its own tests assert — i.e. editing a qualified invariant set
to fit a second meaning. Two tables with distinct policies is the cheaper and safer shape. **Decision:
new `public.invitation_outputs`; `wedding_assets` is not modified.**

### 7.2 The manifest

Forward migration `20261013120000_stage9_render_outputs.sql`:

| Column | Rule | Why |
| --- | --- | --- |
| `id` | uuid PK | — |
| `wedding_id` | `NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION` | NO ACTION, the `entitlements` precedent (`20260925120400…sql:45-48`: "money-adjacent history does not vanish with the aggregate"): an artefact's history must not vanish silently with the aggregate |
| `version_id` | `NOT NULL`, composite FK `(wedding_id, version_id) → invitation_versions(wedding_id, id)`, `ON DELETE NO ACTION` | the immutability anchor; the same pattern as `publications:80-81` |
| `output_kind` | `text NOT NULL CHECK (output_kind IN ('og_image','share_image','pdf','qr'))` | explicit kind; the page size is a `variant`, not a second kind, so `kind` never encodes the same fact twice |
| `variant` | `text NOT NULL CHECK (variant IN ('1200x630','1080x1350','1080x1620','1080x1800','1080x2160','a4','letter','25mm','40mm','60mm'))` | explicit geometry drawn from §5's finite box set, so a paginated share set is addressable and an unexpected shape is a refusal at the database rather than a silent row |
| `format` | `text NOT NULL CHECK (format IN ('png','webp','pdf'))` | format is orthogonal to geometry — the same 1200×630 exists as PNG and WebP |
| `page_number` | `integer NOT NULL DEFAULT 1 CHECK (page_number > 0)` | "never crop" needs a page identity |
| `render_config_hash` | `text NOT NULL CHECK (render_config_hash ~ '^[0-9a-f]{64}$')` | SHA-256 over the pinned config: css hash, font manifest hash, box, DPR, browser version, renderer component source hash |
| `content_digest` | `text CHECK (content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$')` | SHA-256 of the produced bytes; NULL until verified |
| `source_dto_digest` | `text NOT NULL CHECK (source_dto_digest ~ '^[0-9a-f]{64}$')` | SHA-256 of the exact DTO bytes rendered — the proof that the artefact and the guest page read one document |
| `target_url_digest` | `text CHECK (target_url_digest IS NULL OR target_url_digest ~ '^[0-9a-f]{64}$')`, required iff `output_kind = 'qr'` | the QR's input string hashed. The raw URL is never stored (§9) |
| `object_key` | DB-minted by trigger, `text UNIQUE`, `NOT LIKE '/%'`, `NOT LIKE '%..%'`, no extension (Stage 6's shape) | Stage 6's key discipline, restated here: `outputs/<wedding_id>/<kind>/<variant>/<row id>` for private, `p/<43-char opaque base64url>` for the published preview |
| `storage_domain` | `text NOT NULL CHECK (storage_domain IN ('host_private','published_preview'))` | the two security domains are a column, not an assumption |
| `status` | `text NOT NULL CHECK (status IN ('registered','uploading','ready','failed','invalidated'))` | failure/retry/invalidation are states |
| `invalidation_reason` | `text CHECK (invalidation_reason IS NULL OR invalidation_reason IN ('superseded','token_rotated','publication_revoked','asset_deleted'))`, required iff `status='invalidated'` | revocation correctness must be auditable |
| `attempt_count`, `last_error` | `integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5)`; `text` | bounded retry evidence, §12 |
| timestamps | `created_at`, `updated_at`, `ready_at`, `invalidated_at` | `set_updated_at` trigger reuse |
| constraints | `CHECK ((status='ready') = (content_digest IS NOT NULL))`; `CHECK ((status='invalidated') = (invalidated_at IS NOT NULL))`; `CHECK ((output_kind='qr') = (target_url_digest IS NOT NULL))`; `UNIQUE (version_id, output_kind, variant, format, page_number, render_config_hash)` | one artefact per (version, kind, geometry, format, page, config) — the determinism key |

Triggers and privileges: `BEFORE INSERT OR UPDATE` → `private.reject_client_write()`, `BEFORE DELETE` →
`private.reject_client_delete()` (the existing `invitation_versions` pair,
`20260925120200…sql:50-54`); RLS enabled with **one SELECT policy for wedding members and no
INSERT/UPDATE/DELETE policy for any client role**; DML granted to `service_role` only. No privileged
field is browser-writable: a host's session cannot set `content_digest`, `status` or `object_key`
because it cannot write the table at all.

Snapshot duplication: **none.** The row holds ids, digests and states. No copy of `snapshot` is made.

### 7.3 Functions

`api` gains exactly two browser-callable members, both `TO authenticated` and both membership-checked,
so the anonymous surface stays at the five functions §2 measured:

* `api.render_invitation_document(p_version_id uuid) RETURNS jsonb` — `SECURITY INVOKER` wrapper over
  `internal_api.render_invitation_document`, which re-checks wedding membership the way
  `internal_api.preview_invitation` already does and returns
  `private.public_invitation_dto(snapshot_schema_version, snapshot)` for that one immutable version,
  or the same `{"available": false}` constant for a version the caller may not read. This is the
  worker's authorised source and the host's "what a guest sees of this exact version" view. It cannot
  reach a draft (a draft has no version row), it cannot reach another wedding, and it publishes no
  field the guest page does not already receive.
* `api.list_invitation_outputs(p_wedding_id uuid) RETURNS jsonb` — wrapper over
  `internal_api.list_invitation_outputs`; refuses a non-member; returns `output_kind, variant, format,
  page_number, status, content_digest, render_config_hash, storage_domain, ready_at` and **no** object
  key, **no** URL and **no** `target_url_digest`. The client then asks for a signed URL through the
  same Storage path Stage 6 already uses (`src/integrations/supabase/weddingAssets.ts:218` shape,
  60-second TTL), so the private domain keeps one delivery mechanism.

Writes are `internal_api`-only (`registered`, `ready`, `failed`, `invalidated`) and are reached by the
worker through the service-role key, never through `api`. Because `api` gains two members, the
catalogue tripwires **must** be widened in the same commit — C26/C28a/C28b/C29/C30/C32 plus
`API33`/`API34` in `supabase/tests/`, which is the mechanism that has kept the anonymous surface
honest since Stage 3 (`docs/architecture/public-invitation-security.md:213-227`). A tier that forgets
this is a red gate, not a note.

## 8. Storage and publication: two security domains

The approval's correction is the whole section: **a private bucket is not crawler-accessible, and
"private" is not a design answer for an image a third-party bot must fetch.** So the stage separates
the two, and gives each its own bucket, its own policies, and its own default.

| | `invitation-outputs` | `invitation-previews` |
| --- | --- | --- |
| Purpose | Every generated file the host downloads: PDFs, share images, OG images, QR PNGs | Only the OG preview image, and only when the published-preview consent is on |
| `public` | `false` | `false` by construction at this stage; `true` is a **product decision held open**, §10.3 |
| MIME allow-list | `image/png`, `image/webp`, `application/pdf` — no SVG, no HTML, ever (Stage 6's reasoning at `:37-38` is kept verbatim) | `image/png`, `image/webp` |
| Size limit | 10 MiB (a paginated Indic PDF can exceed Stage 6's 5 MiB photo limit) | 1 MiB — an OG image that needs more is a composition bug |
| Read path | Host's own signed URL, 60 s TTL, minted by the host's session | Any holder of the opaque key. No signed URL, no session, and the key is 43 URL-safe chars of 256-bit randomness |
| Key | DB-minted, wedding-scoped, contains the row id | DB-minted, **contains no wedding, version, row or user identifier** and is content-addressed so a re-render is a new key |
| Row | one per artefact, `storage_domain='host_private'` | one per (version, kind/variant) published, `storage_domain='published_preview'` |
| Lifetime | deleted on `invalidated` with the object removed in the same operation | deleted on revocation/rotation, immediately and unconditionally |

Rules that follow:

1. **`wedding-assets` is never made public and never receives a public policy.** It is untouched.
   Uploaded photographs and audio stay exactly where Stage 6 qualified them.
2. Storage object operations go through the **Storage APIs** (`POST /storage/v1/object/...`,
   `DELETE /storage/v1/object/...`, `createSignedUrl`), not by inserting into `storage.objects`. The
   worker talks to the gateway's Storage endpoint on `127.0.0.1:54400` with the service-role key; the
   registry row's `object_key` is the only thing the database mints, and the same digest is re-computed
   after upload by fetching the bytes back before a row may become `ready`.
3. Content-addressed keys are also the cache answer: a crawler or CDN that cached yesterday's OG image
   cannot be handed it today, because today's artefact has a different key. The old key is deleted on
   invalidation, and a stale cache is therefore an *unavailable* image, not a wrong invitation.
4. **Accidental discovery.** The preview key is 256-bit opaque, so it is not enumerable — the same
   threat model the published address already runs (`public-invitation-security.md:15-18`). What is
   *newly* true is that a preview image needs no link to fetch, so the privacy ruling is narrow and
   explicit: a published preview may only contain what `private.public_invitation_dto` already lets a
   bare link-holder see. Household names, salutations, guest lists, RSVP states, reviewer identities,
   entitlement state and any `/g/` or `/r/` credential are outside that set, and §11 tests that.
5. **Crawlability is split by route, and the split is not symmetric.** `robots.txt` (which today allows
   every user-agent on every path, §2) gains `Disallow: /r/` and `Disallow: /g/` — the family-review
   and household doors, where a fetch by a third-party service is itself the leak (§9.3), and where no
   unfurl is wanted. It does **not** gain `Disallow: /i/`: blocking the published path would destroy
   §10, because a crawler that cannot fetch the page cannot read its `og:` tags, and the whole OG
   contract depends on `facebookexternalhit` and `Twitterbot` being *allowed* in. So `/i/` stays
   crawlable and is kept out of search indexes by `noindex, nofollow` instead: `PublicInvitation`,
   `FamilyReview` and `GuestDoor` each mount a robots meta for their route and remove it on unmount.
   Measured limit, stated up front: a crawler that executes JS (Googlebot) sees that meta;
   `facebookexternalhit` and `Twitterbot` do not run the SPA, so for them `noindex` is a
   **hosting-layer `X-Robots-Tag`** requirement, which joins the §10.2 seam list and the §14 unverified
   column — and those two crawlers do not maintain a web index anyway, so the residual exposure for
   them is the fetch itself, which the OG design accepts and §10.3 keeps off by default.

## 9. QR lifecycle and token handling

### 9.1 Where the raw URL comes from — and the rule it obeys

The digest is one-way and the stage must not pretend otherwise: `private.access_tokens` stores only
`encode(digest(...,'sha256'),'hex')` (`20260925120400…sql:125`), so **no function can reconstruct the
credential, and none is written.** The QR is therefore rendered from a raw URL only when the caller
already legitimately holds one:

* **At publish.** `api.publish_invitation_version` returns `path = '/i/' || raw` when it mints a
  credential, and returns `path = NULL, link_reused = true` when it re-parents an existing one
  (`20261009120000_stage8_guest_invitations_rsvp.sql:1014-1032,1053-1054`). The client already prefixes
  the origin (`src/pages/EditProject.tsx:418,551`).
* **At rotation.** `api.rotate_invitation_token` returns a fresh `path`
  (`20260926130000…sql:830`), and `EditProject.tsx:566` already surfaces it.

So **QR generation happens in the moment the session holds the authorised URL** — the publication
panel offers "generate QR" as part of that flow, and the manifest records only
`target_url_digest`. The QR PNG bytes are then downloadable for as long as the artefact row is
`ready` (the bytes are the credential's bearer, no more and no less), and **re-rendering a QR after
the session is gone is refused**, with the UI naming the reason: there is no secure source for the
current URL, and inventing one would be credential recovery in disguise. Rotating the token is the
supported way to get a fresh printable address.

### 9.2 The three lifecycle events, distinguished

| Event | What happens to the address | What happens to a printed QR | What the manifest does |
| --- | --- | --- | --- |
| **Republish a new version, same link** (the typo fix) | credential is re-parented, `link_reused=true`, URL unchanged | **still works** — correctly, and must not be needlessly invalidated | QR rows are **not** invalidated (their `target_url_digest` still matches the live credential). Image/PDF/OG rows for the *old version* are `invalidated` with reason `superseded`. |
| **Rotate the public token** | old credential revoked, new minted | **unusable** — points at a dead address, and the paper cannot be recalled | every `qr` row for the wedding is `invalidated` with reason `token_rotated`, and its object deleted |
| **Revoke the publication** | publication `status='revoked'`, and the wedding's live `public_invitation` **and** `guest_invitation` credentials are revoked with it (`20261009120000…sql:1087-1090`). `approval_review` is not in that set, and the stage does not pretend it is | **unusable**, and the page behind it answers `{"available": false}` | every row of every kind is `invalidated` with reason `publication_revoked`, both buckets' objects deleted |

Rotation and revocation are therefore the two moments the UI must say, in plain words: *if you have
printed this QR, reprint it.* That statement is part of the deliverable, not a footnote, because the
blueprint already says so (`stage-2-domain-blueprint.md:622`: "a QR is a promise about a *URL*, so
revocation/persistence policy must be settled before anyone prints one").

### 9.3 What QR must never encode

`guest_invitation` (`/g/`) and `approval_review` (`/r/`) credentials are per-household and
per-reviewer, and a `/g/` URL carries salutation, expected party size and RSVP state through
`api.resolve_guest_invitation`. Encoding either into a general-purpose printed sheet would put a
private, personalised door on a public surface — the exact leak ADR 0004 `:69` forbids caching into a
shared artefact. Ruling, enforced by code and by a test: **the QR generator accepts a path matching
only `/^\/i\/[A-Za-z0-9_-]{43}$/`** (the same shape the client parser already demands,
`src/integrations/supabase/publicInvitation.ts:42`) and refuses anything else with a named error. A
separate per-household QR is a future, explicitly-addressed feature — not this stage, and not by
accident.

### 9.4 The one dependency, and how a QR becomes bytes

Stage 9 adds exactly one npm dependency, for QR encoding, and it is chosen by measurement rather than
by habit: the candidates (`qrcode`, `qr-creator`) are installed into a scratch directory **outside**
the repository, their transitive closure counted and their install scripts checked, and the numbers
recorded in `docs/architecture/render-outputs.md`; the smaller closure wins, a tie goes to the package
with no `postinstall`. A hand-written encoder was considered and rejected — Reed–Solomon over GF(256)
plus mask selection is the kind of code that is silently wrong for exactly one URL length, and §5's
"refuse rather than shrink" rule depends on it being right. The restraint precedent is
`stage5-browser-driver.mjs:11-13`, which refuses puppeteer for the same reason.

A QR becomes a PNG through the **same** Chromium path as every other raster: `render.html` under
`data-render-surface="qr"` mounts a canvas drawn at an exact integer module scale with the §5 quiet
zone, sized from the `variant`'s nominal print box, and the worker screenshots that box at DPR 1.
There is deliberately no second image encoder in the pipeline: one raster route means one determinism
story (§13) and no hand-qualified PNG writer. The dependency is reachable only from `dist/render.*`
and never from the guest bundle — the bundle instrument reports the two separately, and a QR library
in a guest's download is a §16 non-claim that the tier will catch if it ever happens.

One honest risk is named before it is discovered: §13 asserts PNG byte identity, and Chromium's PNG
encoder has not been measured for stability across runs on this host. If the first L3 run shows
unstable image bytes, that is treated as a defect to root-cause first. Only if the cause turns out to
be the browser's own encoder may L3 for images be restated as **decoded-pixel identity** with the
raw-file digest still stored per row — and that restatement happens in the audit, with the measurement
attached, never as a quietly weakened assertion.

## 10. Open Graph: what is implementable, and the hosting seam

### 10.1 The contract Stage 9 can implement and test locally

An OG triple per (version, language-agnostic) artefact, computed from the DTO only:

```
og:title        = invitation.title                       (bounded, §10.3)
og:description  = the first event's date/time + venue    (composed, never invented)
og:type         = "website"
og:image        = <published-preview URL for the og_image artefact>
og:url          = the published /i/ URL (served, never stored)
twitter:card    = "summary_large_image"
```

The triple is derived by a pure function in `src/lib/ogMetadata.ts` from the same parsed DTO the
renderer consumes, unit-tested for every content shape the render sweep already uses. A
`scripts/og-serving-adapter.mjs` local harness serves, on loopback, the HTML a host must serve:
`/i/<token>` returning the static shell plus these tags for that invitation. A probe drives it with a
crawler user-agent (`facebookexternalhit`, `Twitterbot`) and asserts the exact tag set, the image's
byte equality with the manifest's `content_digest`, and the 410/`{"available": false}` behaviour of a
revoked address. That is a *real* test of the contract, and it is not a test of WhatsApp.

### 10.2 The honest status claim

The published product today is a client-only SPA with `[edge_runtime] enabled = false`
(`supabase/config.toml:60-62`) and one static `index.html` whose `og:*` tags are brand-only
(`index.html:34-46`). Nothing in this repository can make a real chat-app unfurl show a real
invitation. Stage 9 therefore reports:

> **Verified locally:** the metadata contract, the image artefact, the digest/manifest link, the
> serving adapter's response bytes, and revocation behaviour.
> **Unverified:** that any customer's link previews correctly in WhatsApp, Telegram or any other
> client. That requires a hosting layer that can answer a crawler's GET with per-invitation HTML —
> an edge function or a host rewrite — and is out of scope for a stage that must not invent hosted
> deployments or contact hosted Supabase.

`docs/product/feature-readiness.md:230` will read `PARTIAL (local contract only)`, not `IMPLEMENTED`,
and `docs/architecture/render-outputs.md` names the one production seam to fill: *serve
per-invitation OG HTML at the published path, with `X-Robots-Tag: noindex, nofollow`, and delete the
preview object when a publication is revoked or rotated.*

### 10.3 Two defects this stage must decide rather than defer silently

* **`document.title` is unbounded.** `render-contract.md` §5.2 records a 465-character title reaching
  the page title and says a truncation rule "belongs to whoever next owns sharing". Stage 9 owns
  sharing. The rule: OG `og:title` and `og:description` are clamped to 88 and 300 codepoints at word
  boundaries with no mid-word cut, no mid-string truncation and no invented ellipsis, and the exact
  strings that left the harness are on record because §10.1's probe hashes the served bytes; no new
  manifest column is invented for it.
  Provenance of those two numbers, stated rather than dressed up: they are **this stage's own bound**,
  sized so a link card shows roughly one line of title and two of description on the 360 px path V1
  cares about — they are not measured platform limits, and no platform's limit is claimed anywhere in
  this stage, because §10.2 means the round-trip cannot be observed here. The page's own `<title>`
  keeps its current behaviour (changing it would rewrite a documented Stage 3 finding on the same
  pass) — the boundary is applied where sharing consumes it.
* **Published preview needs a consent decision.** Serving an unauthenticated, opaque-key image is a
  *new* exposure, even if its content is already visible to a link holder. **The privacy-safe default
  is implemented: previews are private, and the published-preview domain exists but is dormant**
  (no object is ever written to `invitation-previews` unless a host opts in). The consent decision —
  "make my invitation's preview image fetchable by anyone who finds the address, so shared links show
  a picture" — is a genuine product choice for the human partner, not an engineering guess, so it is
  raised as §15 H-1 rather than assumed on. Everything up to that switch is built and tested; the
  switch stays off, and the audit records that the published path is therefore exercised only against
  a local harness.

## 11. Worker security posture

1. **Input.** The worker accepts a DTO only through the parser the guest page uses
   (`src/lib/publicInvitation.ts`), from a session that is an authenticated wedding member. Unknown
   fields are dropped by that parser rather than honoured; a document it refuses cannot render. The
   render harness never accepts HTML, a file path, a remote URL, a font name or a stylesheet as input
   — there is no such parameter in its interface, and the DTO is injected as a value rather than
   fetched. The QR path is the one place a string that looks like a URL enters, and it is narrow: the
   generator accepts only a path matching §9.3's `/^\/i\/[A-Za-z0-9_-]{43}$/`, validates it before
   building a matrix, and nothing in the pipeline ever *requests* it. A hostile style value, markup or
   link scheme reaching the render surface is the same class of case the sweep already checks
   (`render-contract.md` §8.1).
2. **No arbitrary rendering.** `render.html` is a fixed document with a CSP of
   `default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self';
   connect-src 'none'`. A remote asset URL, a filesystem reference or an injected script therefore
   fails by *policy*, and the network tier proves it: an instrument that watches every request on the
   render session asserts the external-host set is empty, and a hostile fixture that tries to
   reference an off-origin asset is recorded as blocked, not silently absent.
3. **Isolation.** Each render runs in its own CDP browser context (`Target.createBrowserContext`) and
   its own temporary `--user-data-dir` under the OS temp dir, removed afterwards, following the
   pattern at `scripts/stage5-browser-driver.mjs:70-76`. The invitation-under-render never shares a
   profile with a host session.
4. **Bounds.** Per-artefact byte ceilings (the bucket limits in §8, enforced client-side before
   upload), a wall-clock timeout per render and per page, a maximum page count, and a maximum of
   concurrent Chromium contexts of 1 on this shared host. Overrun is a `failed` row with a named
   reason, never a truncated file.
5. **Credentials.** The service-role key is read from the environment by the worker process only. It
   is never in `src/`, never in a rendered page, never in a manifest row, never in a log line — and
   `service-role-key-in-browser-code` (`scripts/check-product-contract.mjs:265-272`, scope
   `["src/", "index.html"]`) already covers every file under `src/`, including any new `src/render/`
   module, so the Stage 9 change is to add **`render.html`** to that scope: a second browser-loaded
   document at the repository root is exactly what the rule exists to catch, and `scripts/` stays out
   of scope on purpose because the worker is the one place the local key is legitimately read and it
   never ships to a browser. Raw invitation tokens are masked in worker output the way
   `stage5-network-privacy.mjs:144-148` masks them today (`TOKEN_SHAPED` → `‹credential masked›`), and
   the same needle hunt is reused to prove a token never reaches a request URL or a header in the
   render session.
6. **No new anonymous door.** There is no publicly callable render endpoint. Rendering is triggered by
   a local operator command (and, in a hosted product, by a queue a server owns). Consequently there
   is nothing new to rate-limit or abuse from the internet — and this stage records that fact as the
   reason the "render trigger at scale" row of §14 is a production requirement rather than a Stage 9
   one.
7. **Hostile-input tests.** The output tier runs the sweep's hostile shape (`10-hostile-markup`), a
   465-character title, a value trying to smuggle a `file://` or data-URI stylesheet, a link with a
   non-https scheme, and a `sections` array with unknown kinds, and asserts: no extra network request,
   no filesystem read, correct digest, and no crash — the unknown-kind skip rule
   (`render-contract.md` §7.5) is expected to apply unchanged. The credential assertions are split,
   because one artefact is *supposed* to carry a credential: no token-shaped string may appear in any
   filename, `object_key`, manifest column other than `target_url_digest` (which is hashed), log line,
   or in the rendered text of any `og_image`, `share_image` or `pdf`; the `qr` PNG's pixels are the
   single deliberate exception, and even there the sweep asserts that a `/g/` or `/r/` shaped path
   never appears in any artefact and that `/i/` appears only in a `qr` row (§9.3).

## 12. Failure, retry, cleanup and invalidation

* `registered → uploading → ready` on success; `uploading → failed` on any timeout, byte-ceiling
  breach, browser refusal or upload rejection, with `last_error` naming the CDP or HTTP reason and
  `attempt_count` incremented. `failed` is retryable; `ready` is not silently overwritten — a new
  render of the same key creates a new row (the uniqueness tuple includes `render_config_hash`), and
  the older one becomes `invalidated/superseded`.
* A `ready` row whose bytes no longer match `content_digest` (re-fetched and re-hashed by the
  verification tier) is a **red gate**, not a repair: the worker deletes and re-renders, then the
  tier re-measures.
* Cleanup owns only what it created: temp `user-data-dir`s, temp screenshot dirs under `mkdtemp`, and
  the scratch output directory **outside** the repository (the same discipline as
  `q8-logs`/`artifacts/stage4-render`, which is gitignored). It never deletes a Docker volume, another
  project's directory, or any bucket object that is not this stage's row.
* Invalidation is executed as delete-then-mark: the object is removed through the Storage API, the row
  is `invalidated` with its reason, and a row that cannot prove its object is gone stays `failed` with
  `last_error='object still present'` so a leak is visible rather than assumed.
* A revoked publication serves nothing: `api.list_invitation_outputs` reports the state, and the
  serving adapter's `/i/` answer stays `{"available": false}` (a claim the HTTP tier checks).

## 13. Reproducibility contract, in three levels

"Reproducible" is split because the outputs genuinely differ. The spec states what is asserted, and
what is only reported.

| Level | Definition | og/share/qr (PNG/WebP) | PDF |
| --- | --- | --- | --- |
| **L1 content equivalence** | the rendered text codepoints and the DOM glyph coverage are identical to the guest page's, for the same DTO | asserted (the same `source_dto_digest` drives both, plus the per-codepoint probe) | asserted (extracted text equals the page's, `/ToUnicode` present) |
| **L2 visual equivalence** | the page and the artefact show the same strings, order, weights, colours and alignment | asserted by the sweep's existing computed-style comparison, extended to the render surface | same |
| **L3 byte identity** | re-rendering the same `(version, kind, variant, format, page, render_config_hash)` — the §7.2 uniqueness tuple — yields the same SHA-256 | **asserted**: two runs, digests equal, and any inequality is a defect | **not asserted.** Chromium stamps a creation date and a file ID into every PDF. The instrument *measures* the difference: after normalising only those two fields, the digests must be equal, and the count of differing bytes outside them is reported. A PDF is described as **content-deterministic**, and "byte-identical" is not claimed until a controlled normalisation of the produced file is itself designed and tested. |

A browser version change or a CSS/font/renderer source change moves `render_config_hash`, which changes
the uniqueness tuple, which makes "the old artefact is stale" a query rather than a guess. That is how
ADR 0004 `:36` — "a share image taken yesterday is provably still the current document" — is answered
with evidence: compare the live version's current config against the row's, and the answer is either
"identical" or "this artefact predates that change".

## 14. Local versus production

| Capability | Local, this stage | Needs production |
| --- | --- | --- |
| Share image, QR, A4/Letter PDF from an immutable version | ✅ built, rendered by real Chromium, digests asserted | — (a hosted queue would run the same worker) |
| Per-invitation OG metadata contract | ✅ pure function + unit tests | — |
| Serving the metadata at the published URL to a crawler | ✅ against a local loopback harness only | ✅ an edge function or host rewrite; `X-Robots-Tag` |
| A real WhatsApp/Telegram unfurl | ❌ **unverified, stated as such** | ✅ |
| Public preview object, opaque key, content-addressed | ✅ implemented, **dormant behind consent** | ✅ the consent decision + deletion on revoke |
| Host download of private artefacts via signed URL | ✅ on the `localvivaahvarnam` stack | — |
| Token rotation/revocation invalidating artefacts | ✅ SQL + HTTP tiers | — |
| Render trigger at scale, rate limits, abuse protection | ❌ out of scope: no public trigger exists | ✅ queue + limits |
| Native-speaker Indic script review | ❌ deferred (H-3) | — it is human, not hosted |

## 15. Decisions, consent items, and deferred human requirements

**Decisions taken here with rationale, so the implementation does not re-litigate them:** raw CDP over
the existing driver instead of puppeteer/playwright (keeps `package.json` honest, precedent
`stage5-browser-driver.mjs:11-13`); a QR library chosen by measured transitive footprint over a
hand-written encoder (§9.4); a new manifest table instead of overloading `wedding_assets` (§7.1);
self-hosted TTF fonts instead of CDN (§6.2); a second private bucket plus a dormant public one instead
of one bucket (§8); QR and share images as PNG/WebP rather than SVG (the §8 MIME row's reasoning, which
restates Stage 6's `:37-38`); content-addressed
preview keys instead of version-id keys (§8 rule 3); `noindex` implemented as far as a static SPA can
and no further (§8 rule 5); no entitlement gate on any output, because publishing is already the
gate and `docs/product/commercial-model.md:40` says a QR must never be paywalled; `document.title`
left alone while the sharing boundary clamps (§10.3).

**Consent required before flipping, not guessed:** **H-1** — enable the published-preview bucket
(§10.3). Its privacy-safe default is off.

**Human-only requirements, blocking the tiers that need them:** **H-2** — start Docker Desktop (the
engine pipe was absent at the start of this stage, so the SQL, HTTP and browser tiers cannot run until
it is up; nothing else in this design waits on it). **H-3** — native-speaker visual review of Tamil,
Telugu, Kannada and Malayalam renderings (§6.3): automated glyph coverage is not linguistic approval.
**H-4** — the C: drive is shared and oscillates (866 MB → 9.7 G across Stage 8's own captures); if it
drops below ~2 G before a heavy tier, freeing space means a human decision about the superseded
`wedding-invites-pro` Stage-5 clone (358 M), not an autonomous delete.

## 16. Explicit non-claims

No hosted Supabase project. No deployment. No GitHub Actions (quota-exhausted). No merge into `main`.
No Stage 10. No WCAG conformance claim for any output. No claim that a real chat app previews a real
invitation. No claim that any Indic text was read by a native speaker. No claim of byte-identical PDFs
before a normalisation design is measured. Print colour management, bleed and CMYK are untouched —
this stage produces screen-accurate PDFs, and the blueprint already calls print-ready assets the
hardest output (`stage-2-domain-blueprint.md:623`).
