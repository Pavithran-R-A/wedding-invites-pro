# Render outputs: substrate, geometry, digests and bounds

Stage 9's artefacts (`og_image`, `share_image`, `qr`, `pdf`) are drawn by a locally operated Chromium
over the harness in `render.html`, and this file is the record that makes those bytes *attributable*:
which browser was qualified, which calls it must answer, where every box number lives, what each
digest is computed over, and what the worker refuses rather than produces. It is written to be read by
the next stage and by an auditor, not by the product — nothing under `src/` imports it, and the only
code that reads it mechanically is the worker's browser pin in §1 below.

The design that governs this file is
`docs/superpowers/specs/2026-10-13-stage9-render-exports-design.md`; section numbers below are that
document's unless prefixed. Content facts come from `docs/architecture/render-contract.md`.

## 1. The browser is pinned (§6.4)

The worker reads the line below before it draws anything and compares the major version Chrome
answers with on `/json/version`. A mismatch is a refusal, not a warning: the operator must either
pass `--accept-unknown-browser`, which writes the measured version into every manifest row that run
produces, or re-qualify and move this line.

```text
validated_against: 155
```

Measured substrate, in the form the worker records it:

| Field | Measured value | How |
| --- | --- | --- |
| `Browser` | `Chrome/155.0.8059.40` | `/json/version` of the headless instance this worker launched |
| major | `155` | the first component of that string |
| full version | `155.0.8059.40` | read from `chrome.exe` file metadata on 2026-10-13, then confirmed by `/json/version` |
| `--user-data-dir` | a fresh `mkdtemp` under the OS temp dir, removed at close | `scripts/stage5-browser-driver.mjs:70-76` (dir + flag), `:204` (removed) |

The design's §2 substrate table was written against Chrome **154**. The host moved to 155 before this
slice ran, which is exactly the drift §6.4 exists to catch: the pin is a file in the repository, so a
browser upgrade shows up as a refusal until somebody measures the new one and re-qualifies. Two
notes on how the version was obtained, because a shared host makes the obvious command unsafe:
`chrome.exe --version` attaches to the already-running browser session instead of printing
("Opening in existing browser session"), so the version was read from the binary's file metadata and
then confirmed from the headless instance's own `/json/version`.

## 2. Capability probe (§6.4)

Before any artefact, the worker calls each method it uses against its own page session and names any
that answers `-32601 … wasn't found`. The precedent for making this a gate is the Chrome 154 removals
recorded at `scripts/stage5-browser-driver.mjs:434-438`: a method that disappears is discovered by the
run, in the first second of it, rather than by a customer's missing file. (That note was written into
the design as `:409-413`; this stage's two CDP doors added twenty-five lines above it, so the design
document's citation describes the file as it stood before that edit and this one is current.)

| Call | Why the worker needs it |
| --- | --- |
| `Target.createBrowserContext` | §11.3 isolation — one context per render session |
| `Page.navigate` | reaching `render.html` on the loopback origin |
| `Runtime.evaluate` | mounting the request, measuring the drawn document, applying a fit plan |
| `Emulation.setDeviceMetricsOverride` | the canvas box itself (§5) |
| `Page.captureScreenshot` | PNG and WebP bytes, with an explicit `clip` |
| `Page.printToPDF` | the PDF variants (§5), probed here even in runs that draw no PDF |

`Page.printToPDF` is probed on a blank page and its bytes discarded; the probe answers the protocol
question, not the paper question, which is a separate measurement (§6.3, recorded in the audit).

## 3. Geometry has one source (§5)

Every box, floor, ceiling, ladder step, page maximum and byte ceiling in the render path is a constant
in **`src/render/outputGeometry.ts`**, pinned by `src/test/outputGeometry.test.ts`. The worker imports
that file and the manifest's `render_config_hash` includes its digest, so an artefact's geometry is
re-derivable from the repository rather than from a memory of a run.

| Kind | Box | Overflow contract |
| --- | --- | --- |
| `og_image` | 1200 × 630, DPR 1 | fit ladder: scale the lead within the product's own 22–44 px range, then drop whole optional lines in `OG_DROP_ORDER`; below that, a named refusal |
| `share_image` | 1080 wide, height quantised to 1350 / 1620 / 1800 / 2160 | taller content paginates — reported as `paginate`, never captured into a shorter box |
| `pdf` | A4 210 × 297 mm, US Letter 215.9 × 279.4 mm, 0.5 in margin | bounded page count, named refusal beyond `MAX_PDF_PAGES` |
| `qr` | 25 / 40 / 60 mm at 16 px per mm | `plate-too-dense` is a refusal, not a smaller code |

**How the ladder is applied, and why not from CSS.** `InvitationRenderer` sets the lead size as an
*inline* style on the article (its own clamp of the host's choice), and `src/render/render.css`
deliberately contains no ladder and no root font size — its header says the fitting decision "needs a
measured content height, which is why [it is] absent from this file and present in the worker that has
one". So the worker does what `render.css` says: it reads the rendered lead from the DOM, walks
`planOgFit` with a measure callback that sets the article's inline `font-size` and applies
`display: none` to the dropped sections *by their `data-render-*` stamps*, and re-measures. Dropping
by stamped attribute is a rule of this file's: every selector in `OG_DROP_ORDER` matches a
`data-render-*` stamp the renderer already computes — never a tag name, a class or a DOM position —
so a release that restyles the card cannot silently change which content a teaser lost. Two of them
are compound (`[data-render-region='body'][data-render-kind='text']`) because a body section stamps
its own wrapper and nothing inside it; writing those with a space is the silent failure mode, since a
selector that matches nothing makes the ladder *look* like it gave up a line it never touched. The
later-ceremonies entry selects `data-render-event-position`, which is the renderer's own count of the
events it drew, so "keep the first ceremony" means the first one a guest sees rather than the first
row of a frozen array. The raster tier reads the page back and asserts that every drop in the plan it
applied hid at least one real element. The title and the first event are in no drop entry at all,
which makes them structurally undroppable — and what `teaser-does-not-fit` is for.

The applied plan (`lead_px` and the ordered `dropped` ids) is an input to `render_config_hash` (§5), so
an artefact records the geometry it was drawn with and a re-render either reproduces it or is a
different row.

## 4. Digests, defined so they can be re-derived

- **`source_dto_digest`** — SHA-256 of the canonical JSON of the `PublicInvitation` **after** it has
  been through `parseInvitationObject` (the guest page's own parser, §11.1). Canonical JSON here means
  `JSON.stringify` over an object whose keys are sorted recursively at every depth; key order is
  therefore not a fact about the artefact. A digest of the caller's raw bytes would describe a payload
  that includes fields the parser already dropped.
- **`content_digest`** — SHA-256 of the artefact's bytes exactly as written to disk. This is the value
  §13's L1/L3 claims are measured against and the one the serving tier compares to bytes on a wire.
- **`render_config_hash`** — SHA-256 of the canonical JSON of: the worker's own version tag, the
  browser identity fields the endpoint actually answers (`Browser`, `Protocol-Version`, `User-Agent`),
  the engine tag `chromium-cdp`, the byte digests of `src/render/outputGeometry.ts`,
  `src/render/render.css` and `src/index.css`, the font provenance digest (§5 below), the surface,
  variant, format, page number, canvas box (width, height, DPR) and the applied fit plan.
  Two of §6.4's three requirements are this list: a browser upgrade and a CSS or font change both move
  the hash, so "is this artefact stale?" is a query rather than a guess (§13).

  The browser list is the measured answer, not the documented superset. Chrome 155.0.8059.40 on this
  host replies to `/json/version` with `{Browser, Protocol-Version, User-Agent, V8-Version,
  WebKit-Version, webSocketDebuggerUrl}` — the tier prints that set as `answered-keys` on every run —
  and there is no `Version` and no `Revision` key in it. An earlier revision of the worker read those
  two anyway, so the record carried `null` where the engine build should have been and the hash was
  hashing nulls; `q9-logs/gate-s96-raster-run4.txt:20-21` shows the symptoms
  (`Version: undefined`, `Revision: undefined`) beside a green run, which is exactly what no assertion
  could see. `browser-endpoint-answered-identity-fields` and
  `artefact-config-carries-a-complete-browser-record` in `scripts/stage9-render-raster.mjs` are the
  guards that make the silent version impossible to re-ship.
  `V8-Version`/`WebKit-Version` are answered and deliberately **not** hashed: one early probe of a
  different CDP port answered four keys only, and a field that can be absent would make the hash depend
  on which answer arrived rather than on the browser. `Browser` carries the full build string, so a
  point release does move the hash; the *major* alone is what §1 pins, deliberately.
  Changing this field list changes every reported `render_config_hash` and not a single artefact byte.

`pdf` shares these definitions; the difference is §13's L3 row, which does not assert byte identity for
PDF until the creation-date and file-ID normalisation itself has been designed and tested.

## 5. Fonts: provenance lives in the machine-readable manifest (§6.2)

The design asked for "a row in `docs/architecture/render-outputs.md`" per face. As built, those rows
live in **`public/fonts/font-manifest.json`** (schema 1, generated by `scripts/fetch-render-fonts.mjs`,
verified by `scripts/check-render-assets.mjs`), because the same information has to be checked by a
machine on every build and a prose table cannot be. It carries, per family: npm package, pinned
version, SPDX licence, the upstream tarball, the licence text as committed with the file, and per face:
file path, byte length and SHA-256. Six families, 72 faces, all `OFL-1.1`, 1,006,240 bytes.

**Font provenance digest** = SHA-256 of the canonical JSON of, per family,
`{package, version, license}` and, per face, `{label, file, bytes, sha256}` re-measured from the file
on disk at the time of the run (not from the manifest's own numbers — a manifest that vouches for
itself proves nothing). This is an input to `render_config_hash`, so a changed glyph byte is a changed
artefact identity.

## 6. The QR dependency, measured not assumed (§9.4)

Installed into scratch trees **outside** the repository with `--ignore-scripts` (nothing executed),
measured 2026-10-13, evidence `q9-logs/s9-qr-dependency-measurements.txt`:

| Candidate | Packages in closure | Install size | Bundler-reachable from our entry | External packages | Declared lifecycle scripts |
| --- | --- | --- | --- | --- | --- |
| `qrcode@1.5.4` (matrix-only entry `lib/core/qrcode.js`) | 29 | 2,486 KiB | 22 files / 64,098 bytes | `dijkstrajs` | `qrcode` prepublish, `get-caller-file` prepare, `pngjs` prepublish, `yargs` prepare (all in the full closure, none in the reachable graph) |
| `qr-creator@1.0.0` | 1 | 149 KiB | 1 file / 12,073 bytes | none | none |

§9.4's rule says the smaller closure wins, and by that rule `qr-creator` wins. **It was not chosen,**
and the reason is the rule above it: §5 requires "a URL that does not fit is a refusal with a reason,
not a smaller QR", which needs the module count and the matrix. `qr-creator`'s public surface is
`render(config, $element)` only; its module size is a quotient (`settings.size / moduleCount`,
`src/qr-creator.js:141-145`) and `moduleCount` is not exposed, so it cannot answer "how dense did this
come out" — the encoder cannot refuse on the caller's behalf. `qrcode` is therefore pinned at
`1.5.4` and imported **only** as `qrcode/lib/core/qrcode.js`, which is what keeps the reachable graph
at the middle column rather than at 35 files / 84,275 bytes (the browser entry pulls in `pngjs` and
`yargs` for renderers the harness never calls, because Chromium paints the plate). The import is
reachable only from `dist/render.*`; the bundle instrument reports the render entry and the guest
bundle separately, so a QR library in a guest's download is caught rather than hoped away.

## 7. Bounds (§11.4)

| Bound | Value | Where enforced | Overrun |
| --- | --- | --- | --- |
| Concurrent Chromium contexts | 1 | the worker serialises every render through one promise chain and owns one page in one context | impossible by construction, not by polling |
| Wall clock per render | `--render-deadline-ms`, default 45,000 | the whole measure/capture sequence races a deadline | `failed`, reason `render-timeout`; no bytes kept |
| Bytes per artefact | PNG 5 MiB, WebP 5 MiB, PDF 20 MiB, QR 1 MiB | measured on the bytes before they are written | `failed`, reason `bytes-over-ceiling`; nothing written |
| Pages | PDF ≤ 12, share set ≤ 4 | the page-count decision (§5) | `failed`, reason `too-many-pages` |
| Network | loopback origin only; external-host set must be empty | `assertLoopback` in the driver, plus the render session's own request log | the run reports a finding; `render.html`'s `connect-src 'none'` is the policy that makes it hard to trigger |
| Credentials | service-role key read by the worker process from the environment only, never in a rendered page, manifest row, log line or filename | `service-role-key-in-browser-code` in `scripts/check-product-contract.mjs`, whose scope includes `render.html`; token masking shared with the Stage 5 network tier | a leak is a red gate |

**Referrers, measured rather than assumed.** `render.html` carries a document-level
`<meta name="referrer" content="no-referrer">` *and*
`<link rel="stylesheet" href="/fonts/fonts.css" referrerpolicy="no-referrer">`, and neither keeps the
font files anonymous. Six controls were run against a real Chrome 155 (`q9-logs/referrer-controls.mjs`,
output `q9-logs/referrer-controls-measured.txt`; re-run with `node q9-logs/referrer-controls.mjs`, loopback
only, no stack and no credentials). Every control's stylesheet and face were confirmed fetched — the probe
cache-busts each URL and polls until both requests appear, because a control that requested nothing would
score "no `Referer`" for the wrong reason:

| Control | `fonts.css` request | the `.woff2` it names |
| --- | --- | --- |
| no policy anywhere | `Referer: <harness URL>` | `Referer: …/fonts/fonts.css` |
| document `<meta>` only | no `Referer` | `Referer: …/fonts/fonts.css` |
| `<link referrerpolicy>` only | no `Referer` | `Referer: …/fonts/fonts.css` |
| both tags (the shipped harness state) | no `Referer` | `Referer: …/fonts/fonts.css` |
| `Referrer-Policy: no-referrer` header on the stylesheet only | `Referer: <harness URL>` | no `Referer` |
| header + both tags | no `Referer` | no `Referer` |

The reason is that a stylesheet's own subresource fetches inherit the *stylesheet's* referrer policy, not
the document's: the link attribute governs the link's request, and the font downloads it names are separate
requests whose default referrer is the CSS file. So three things follow.

1. **Delivery requirement, not a code fix.** At any origin that serves the render harness, `/fonts/fonts.css`
   must be delivered with `Referrer-Policy: no-referrer` — and the two tags stay, because the header alone
   leaves the stylesheet naming the harness document. The local preview sets no header, which is why the
   eight font requests in a real run still name the harness's own stylesheet.
2. **The tier pins the exact permitted set.** `every-referrer-is-the-harness-own-stylesheet-on-its-own-origin`
   asserts that every `Referer` on the wire equals `http://127.0.0.1:4173/fonts/fonts.css` — the harness
   naming itself on its own loopback origin — and names any other value as an offender. A bare
   "count of referrers" gate would tell an operator that something leaked without saying which request
   carried it, and a document-level meta is a different edit from a stylesheet header.
3. **It travels with the hosting seam, not with this file.** §8 carries the production obligations for
   serving the harness and the preview, and the `Referrer-Policy: no-referrer` header on
   `/fonts/fonts.css` is one of them; until a real origin sends it the honest statement is the measured
   one: the render session's only referrer is the harness naming its own stylesheet on its own loopback
   origin. `docs/product/feature-readiness.md`'s referrer row describes the *guest* page's
   document-level request and makes no claim about subresources, so nothing here contradicts it.

Nothing in this stage uploads a byte: the buckets, the `invitation_outputs` rows and the upload path are
§7–§8 work, so the worker's output today is bytes in a scratch directory **outside** the repository
plus the record above. That is a slice boundary, not an omission — the digests and the hash inputs are
already the manifest's columns, so the migration changes where the record goes, not what it says.

## 8. The production seams this stage names (§10.2)

Serve per-invitation Open Graph HTML at the published path — `og:title`, `og:description`, `og:url`,
`og:image` — with `X-Robots-Tag: noindex, nofollow`, delete the preview object when a publication
is revoked or rotated, and deliver `/fonts/fonts.css` (and the harness document beside it) with a
`Referrer-Policy: no-referrer` response header, which §7 measured as the only mechanism that keeps the
face downloads from naming the stylesheet that named them. `scripts/og-serving-adapter.mjs` is a loopback stand-in for that seam and is not
in the product; `docs/product/feature-readiness.md` therefore reports the Open Graph row as
`PARTIAL (local contract only)`, and no claim about a customer's chat-app unfurl is made until a real
host answers a real crawler.
