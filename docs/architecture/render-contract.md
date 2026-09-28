# Invitation render contract

> What an invitation document is made of, how it gets to the screen, and the promises the renderer
> keeps on the way. The measurements behind the Stage 3 claims are in
> [`../audits/stage-3-public-invitation.md`](../audits/stage-3-public-invitation.md) §7 and §8; the
> Stage 4 additions — the section list, a release's wording, and the sweep that re-measured all of
> it — are in [`../audits/stage-4-tradition-pack-foundation.md`](../audits/stage-4-tradition-pack-foundation.md),
> whose provenance-and-render-model and render-qualification sections carry the numbers. The security
> half of the same boundary is [`public-invitation-security.md`](public-invitation-security.md).
>
> §1–§6 are the contract as Stage 3 left it, with Stage 4's change marked inside a row or a promise
> where a sentence became conditional; §7 and §8 state the Stage 4 render model and what was measured
> against it. The Stage 3 wording is kept because it is what a v1 document — one frozen before
> Stage 4 — still arrives as.

## 1. The chain, and why there is only one

```
      a release's definition  /  private.default_invitation_definition()   ← Stage 4
                     \                        /
        private.resolve_invitation_sections(definition, language, draft)   ← wording chosen once
                          |                                |
live draft (invitation_drafts.content)   frozen snapshot (invitation_versions.snapshot, v2)
                 \                                                /
                  private.build_invitation_snapshot(uuid)      ← what an invitation consists of
                          private.public_invitation_dto(version, jsonb)   ← what a guest may see
                                    |
                 api.preview_invitation (host)  /  api.resolve_public_invitation (guest)
                                    |
                    src/lib/publicInvitation.ts  ← parse the wire shape, or refuse it
                                    |
                  src/lib/invitationSections.ts  ← one ordered list, from either document shape
                                    |
              src/components/invitation/InvitationRenderer.tsx
                          /                              \
            the editor's canvas                a guest's public page
```

Three rules fall out of that shape and all are enforced by tests rather than by review:

* **one projection.** Preview and publication read the *same* two SQL functions, so a preview that
  flatters its author is not a styling difference but a broken link in this chain;
* **one renderer.** `InvitationRenderer` has exactly two app callers — `src/pages/EditProject.tsx` and
  `src/pages/PublicInvitation.tsx` — and no second copy of the layout exists in `src/`. A "quick"
  guest-only template would silently void §1's first rule.
* **one list.** Stage 4 added the normalizer, and it is the rule that keeps the renderer blind to
  which tradition a document came from: whatever a document is — a release's sections, the
  platform's no-pack default, or a v1 page that carries only four prose slots — it reaches the JSX as
  one ordered array of `{key, kind, region, heading, content, provenance}`. So "a wedding with a
  pack" is not a case the renderer can switch on, and a release that wants a different invitation
  writes rows instead of shipping a template. `scripts/check-db-contract.mjs` fails the build when
  `NO_PACK_SECTIONS` and `private.default_invitation_definition()` drift apart, and when the
  `kind`/slot/host-field vocabularies in `src/lib/traditionPackContract.ts` and the release guard do
  not name the same sets.

## 2. Field by field

| DTO field | On the page | If it is absent |
| --- | --- | --- |
| `title` | `<h1>`, and part of the article's `aria-label` | never absent — the parser refuses the payload without it |
| `language.primary` | the article's `lang`, so a screen reader pronounces the words in that language | inherits the page's language |
| `language.additional` | not drawn; carried for a later stage | — |
| `style.font` | leading font family, only if it matches `^[A-Za-z ]{1,40}$`, then the document's own script stack | the design-system display stack |
| `style.fontSize` | the lead size in px, clamped to 22–44; body text is in `em` so the paper scales together | **26 px**, the stated default (§5.2) |
| `style.color` | the article's `color`, only if it is a 6-digit hex | the ink token |
| `style.alignment` | `text-align`, restricted to `left/center/right` | `center` |
| `design_template`, `tradition_pack` | **not drawn** in Stage 3 — they name platform content, and printing "Rev. 1" on an invitation reads as a defect in it. **Still not drawn after Stage 4**, and the pack block is now narrower: the projection publishes exactly `pack_key`, `display_name`, `release_number` of a frozen release, dropping the review record, the scope statement and the machine-assistance flag with it | — |
| `people[]` | one `<li>` per person, grouped under `groupLabel` (falling back to `groupKey`), with `roleLabel ?? roleKey` as the prefix (§5.3). *Stage 4 note: the prefix is `role_label` alone — §5.1 records that repair, and this row's `?? roleKey` is the pre-repair reading it was written against* | the group is not rendered |
| `events[]` | a bordered block per ceremony: day from its own digits, `7:30 AM – 9:00 AM`, timezone text, venue name and address lines, and a map link | an event with no content at all is dropped, block and list together |
| `venue.mapUrl` | an `<a rel="noopener noreferrer" target="_blank">` labelled "Open the venue map" | the address stays, the link does not appear |
| `welcome`, `family_introduction`, `event_notes`, `closing` | paragraphs, `white-space: pre-line` | nothing is drawn — no heading, no empty box |
| `sections.requested` | not drawn; the host's preview names a substitution with it (§7.4) | the flat four slots are what a v1 document has |
| `sections.items[].kind` | the **only** thing the JSX switches on for content: `text` → heading + paragraph, `people_list` → the roster, `event_list` → the ceremonies (§7.2) | an unknown kind is skipped, and the skip is named in the preview's issues |
| `sections.items[].position` | not re-sorted: the projection's array order *is* the frozen order (§7.3) | — |
| `sections.items[].heading` | `<h2>` above that section, when the release wrote one for the requested language | no heading, and no English stand-in invented here |
| `sections.items[].body` | the paragraph for a `text` section; `host` bodies are followed back to the snapshot's `draft` block so a version holds one spelling of a paragraph | nothing — no heading-only box, no placeholder |

`event_notes` rendered inside the ceremonies section when there was one, and as its own labelled section
when there was not, so a note was never orphaned by a shape the host chose. Stage 4 kept the guarantee
and moved the mechanism: the note is now a section of its own in the order the document was frozen in,
so it cannot be orphaned by a missing ceremony list at all — the renderer no longer has a special case
for it.

## 3. Three promises the renderer is written to keep

1. **No markup reaches the page.** Every host string is a JSX text child, so React escapes it; the file
   injects no HTML. A `<script>` in a welcome line appears as those characters. The database
   deliberately does *not* sanitise (`API25` proves the bytes arrive unchanged), because a second,
   weaker definition of "safe" at rest is one the renderer could disagree with.
2. **Nothing is invented.** No placeholder, no counted "1 of 3 ceremonies", no default venue, no
   "TBD". The one label the component supplies is `"The ceremonies"`, and the comment at that line
   says why it is ours rather than a fact about the wedding. *Stage 4 narrowed even that:* the string
   now lives in `NO_PACK_SECTIONS` as a slot's `headingEnglish`, is drawn only when the language the
   document asked for is the one the platform wrote it in, and is withheld from any other (see §7.4).
   A release supplies its own headings as data. What the component still writes itself is three
   `aria-label` fallbacks (`"Ceremonies"`, `"Family and blessings"`, `"Ceremony"`), which a screen
   reader can announce but no guest ever sees printed, and the words "Open the venue map" on the one
   control the document offers.
3. **A date is read, not parsed.** `formatDate`/`formatTime` take `2026-11-14T07:30:00` apart with a
   regex and never call `new Date()`. A wall-clock muhurtham moved by a client's timezone is the wrong
   ceremony's time, which is also why the DTO carries text rather than a timestamp.

Design language (§Q): a digital patrika — warm paper, a ceremonial double rule in gold over maroon
drawn with borders and one rotated square (no image, no font asset, no network), one column that fits
360 px, and type sized for an elder on a phone. Motion: none in the document — measured as 0 running
animations and no transition class on the article; the only animated thing in the route is the
"Loading…" line before the article exists, which the global
`@media (prefers-reduced-motion: reduce)` block flattens.

## 4. Two layout rules that exist because they were measured

* **`break-words` on the article root.** `overflow-wrap` is inherited, and host text carries no break
  point of its own. Without it, a 465-character title pushed a 360 px guest page to
  `scrollWidth 2786` against `clientWidth 345` — the document ran sideways. With it: no horizontal
  overflow at all. Re-measured in the closure pass across 10 content shapes × 4 viewports
  (360×740, 390×844, 768×1024, 1440×900): 40 loads, every one with
  `documentElement.scrollWidth == clientWidth` and 0 elements whose right edge passed the viewport.
* **A stated default lead size.** `weddings.style_settings` is `'{}'` until a host opens the editor, so
  a draft frozen straight from the planning page has no size at all. Treating that as "say nothing"
  rendered the paper at the page's 16 px body text with a 12.9 px caption. `DEFAULT_LEAD = 26` states
  the missing choice instead of leaving it to the cascade.

Both are pinned in `src/test/invitationRenderer.test.tsx`, whose 15 cases also cover: the hostile style
values (`red;}`, `…; background: url(http://…)`, `999`, `3`), escaping, absent slots drawing nothing,
a note surviving an empty ceremony list, `lang`, and the map link's attributes.

## 5. Findings this contract records rather than hides

1. **`role_key` could reach a guest as a label.** Closed in the closure-repair pass, and this is the
   record of how it was checked rather than the claim that it was fixed. `PersonLine` used to render
   `roleLabel ?? roleKey`, so a person whose role had no word written for them showed the machine key
   (e.g. `guest`). It now prints `role_label` and nothing else: no key is a word on this paper, and a
   person with no role label renders by name alone. Measured on the qualified host-to-guest run — three
   people entered through the editor carried `role_key = 'host_defined'` with `group_key IS NULL` and
   Tamil display names; the guest page drew `Groom · அருண் குமார்`, `Bride · தீபா லட்சுமி` and, for the
   person whose `role_label` is `NULL`, `குவிலு ராணி` with no separator at all. The string
   `host_defined`, every `role_key` and `group_key` value and every identifier were absent from the
   rendered text. Pinned in `src/test/invitationRenderer.test.tsx`.
2. **`document.title` is unbounded.** On the extreme fixture the page title is the invitation's title
   verbatim, measured at 465 characters. Browsers cope; a chat app's link card does not. A truncation
   rule belongs to whoever next owns sharing, and is not applied here on a guess.
3. **Retracted: "a chosen font may not be a loaded font."** This finding was **false as written**. It
   claimed `Noto Serif Tamil` was offered by the editor while not being among the faces the page loads.
   No such family is offered: `FONT_FAMILIES` in `src/pages/EditProject.tsx` lists Playfair Display,
   DM Sans, and Noto Sans Tamil/Telugu/Kannada/Malayalam, and `index.html` requests exactly those six
   faces from Google Fonts. The claim was not re-checked before it was recorded, and the earlier
   Stage 3 report repeats it verbatim at §7.6 — that text stands as the historical record of the error,
   and this paragraph is the correction. Nothing is substituted for it: no font-availability gap was
   measured in this pass, and none is claimed. What *was* measured is in the audit's closure section —
   the guest document's resolved `font-family`, `font-size`, `colour` and `text-align` matched the
   host's chosen values on all 10 shapes at all 4 viewports, and the faces were requested from
   Google Fonts.
4. **Glyph fidelity, now captured.** The earlier note here claimed screenshots did not work in the
   qualified environment; that was wrong and is corrected. With CDP device emulation at 360×740 @3x
   (mobile + touch) the guest page was captured for the Tamil, Telugu, Malayalam, Kannada,
   mixed-script and hostile-markup shapes. Every Indic codepoint drew as a letter of its own script —
   no tofu boxes, no clipped vowel signs, no sideways document — and the mixed-script page proved
   per-codepoint fallback: its computed `font-family` was `"Noto Sans Tamil"` throughout, yet Kannada,
   Telugu, Malayalam and Devanagari codepoints each rendered through the browser's fallback without
   disturbing line width. Two honest limits stay: the sweep was authored by this author, so it is
   **rendering verification only** — nothing was read by a native speaker of any supported script, and
   no WCAG conformance is claimed. One fixture artifact is disclosed rather than smoothed over: the
   Tamil shape's three prose fields were seeded with 19 stray Telugu codepoints from the generator,
   visible as fallback glyphs in the first capture; the rows were corrected and republished as a V2 on
   the same link, and the re-captured page holds 0 Telugu and 170 Tamil codepoints.
5. **The focus ring's contrast was below 3:1 against the paper — repaired, see §10 of the Stage 3
   audit.** Keyboard operation was measured, not
   assumed: Tab walked the three venue links in DOM order, Shift+Tab walked back, the fourth Tab left
   the document, and every stop matched `:focus-visible` and was scrolled into view. What the check
   also found is that the indicator is a single 2 px `box-shadow` ring in `rgb(205, 146, 45)`
   with a transparent `outline`, and against the card's own
   `rgb(255, 246, 240)` background that measures **2.54:1** — visible, but short of the 3:1 that
   WCAG 1.4.11 asks of a focus indicator. Body text and link text measure 8.82:1 on the same paper,
   and the links are 216×47 CSS px, so this is one narrow shortfall rather than a general problem.
   It is recorded here and in the audit's closure section; it is not one of the five defects that
   closure pass was told to repair, so no token change was made on a guess.
   Two corrections, both from the pass that did repair it:
   the colour named `--ring` above is **`--gold`** — the map link carried its own
   `focus-visible:ring-gold`, which overrode the design system, while `--ring` had already been
   `--ceremonial` (`rgb(107, 30, 44)`) all along. And the fix was to delete that override, not to
   invent a colour: the link now uses the same `ring-2 ring-ring ring-offset-2 ring-offset-background`
   token set every other control in `src/` uses, which measures **10.66:1** against the paper offset
   band it sits on. The rule this leaves behind is the contract's own: a guest-facing control takes
   the shared focus token, and a component that wants a different one has to say why in this file
   first.

## 6. Adding a field

* it must exist in `private.build_invitation_snapshot`, or a preview shows what a publication cannot
  freeze;
* it must be added to `private.public_invitation_dto`'s whitelist **and** to
  `src/lib/publicInvitation.ts`, then to `API21`'s exact-keys assertion — the two lists are pinned
  separately because one of them alone cannot notice the other drifting;
* the renderer decides how it appears, and its *absence* has to be decided in the same change: "draws
  nothing" is a design decision, not a fallback;
* if it carries host text, it goes in as a JSX child. Nothing in the invitation chain uses
  `dangerouslySetInnerHTML`; the three uses left in the repository are the Stage 0 boundary for
  **platform** SVG (`src/components/ui/chart.tsx`, `CreateProject.tsx:117`, `EditProject.tsx:532`),
  each fed by `sanitizeSvg`, and none of them can receive a host's words — the editor even labels that
  artwork "Catalogue artwork — guests do not see this";
* if it carries a link, `https`-only at the column, at the projection, and again in the client parser.

Stage 4 adds two more, because a field can now arrive as part of a release's wording rather than only
as a column:

* a new **section kind** is not a field. It has to be added to the guard's kind list in the migration,
  to `RENDER_SECTION_KINDS`, to `src/lib/traditionPackContract.ts`, and to a `switch (section.kind)`
  arm in the renderer *and* in `sectionDrawsSomething` — and it changes what a frozen document can
  promise, so it belongs in a new ADR rather than in a feature commit;
* a new **slot** (`section_key`) needs a `REGION_BY_SLOT` entry, or the normalizer will skip it with a
  named issue and a preview will show a heading-less gap. Skipping is the designed outcome, not a bug:
  an old bundle must keep drawing the sections it does know (§7.5);
* a new **pack-visible fact** must clear §7.6. The default answer is no: a release's review record,
  its reviewer, its qualification, its machine-assistance note and its scope statement are projected
  into the snapshot and deliberately never reach the DTO.

## 7. Stage 4: the same promises, over a list

This section is the current shape of §1–§3 read against the renderer as it now stands. Nothing here
retires §1–§6: a document frozen before Stage 4 still arrives with four prose slots and no section
list, and `normalizeFlatInvitation` is what draws it.

### 7.1 Two document shapes, one reading

`private.public_invitation_dto` now publishes `sections: {requested, items[]}`, and each item carries
`section_key, position, kind, required, host_field, heading, body`. A v1 document publishes none. The
normalizer takes either and returns `{requested, sections[], issues[]}`, so the JSX below it has one
input type and no version test.

### 7.2 The dispatch is two-dimensional and finite

`kind` says what to draw — `text`, `people_list`, `event_list`, and nothing else this build knows —
and `region` says how much air it gets: `opening` sections are children of the header, `closing` ones
of the footer, `body` sections carry their own `pt-7`. That is the whole of the layout's vocabulary.
`region` is derived from the slot through `REGION_BY_SLOT`, so a release cannot name a place on the
paper the platform has not already decided how to space.

That limit is a gate, not a convention. `npm run product:check` carries four `src/`-scoped shape
rules — `tradition-pack-identity-branch`, `tradition-selected-from-identity`,
`identity-tested-by-name-shape`, `language-gated-rite` — and they fire on *operators*: a pack or
release key compared to a literal, an identity or language column written on the same statement as a
pack selection, a name inspected by shape, a language tested in a condition beside a rite word. The
sentences saying the renderer does none of those things are deliberately not findings, because the
rules match expressions and this file is prose; `scripts/product-contract.test.mjs` keeps both halves
of that honest, including the near-miss block that reads seven true sentences from this stage back
through the rules (`scripts/product-contract.test.mjs:105-111`). The landing page shows *six*
design-direction titles — "Tamil + English Traditional", "Telugu Ceremonial", "Malayalam Elegant",
"Kannada Classic", "Contemporary South Indian" and "Multilingual Family Invitation"
(`src/components/landing/DesignDirectionSection.tsx:6-41`) — each a *name* of a visual style rather
than a branch, and the one that first tripped a rule, "Telugu Ceremonial", is disclosed as a content
question in
[`../content-review/tamil-english-foundation-v1.md`](../content-review/tamil-english-foundation-v1.md),
not exempted by a narrower regex.

### 7.3 Order is frozen, not re-derived

The projection emits items in the release's order (`ORDER BY ord` over the array it resolved), the
client keeps the array's order, and the renderer partitions it — partitioning preserves relative
order. `position` is carried and displayed nowhere: it exists so a preview can say "nothing
reordered", and because a hand-written definition with a gap or a tie must not be able to silently
move a guest's ceremonies. A non-numeric `position` refuses the whole document, at the projection and
again in the client parser.

### 7.4 Language is a lookup, not a branch

The renderer never compares a language. The resolution happened at freeze time in
`private.resolve_invitation_sections(definition, language, draft)`, which picks a node in the
requested language and, only when the section grants `allowEnglishFallback`, falls back to `en` and
records `fallback_used`. So a Tamil document shows Tamil wording where a release wrote Tamil and
shows *nothing* where it only had English and did not grant the fallback — the alternative is an
English paragraph appearing on a page a family asked for in Tamil, which is a substitution nobody
approved. The one place a language code is compared in application code is
`invitationSections.ts`'s no-pack path, where the platform's own English `"The ceremonies"` is drawn
only when English is what was asked for; that is the same rule applied to the platform's own string,
not a branch to a tradition. The host's preview carries `requested` so it can explain a substitution
in the host's words; a guest sees the result either way.

Measured, and disclosed: **date and time text stays English on a Tamil-labelled page** ("14 November
2026 · 7:30 AM"). `MONTHS` and the AM/PM suffix are the renderer's own literals, they are not part of
a release's wording, and Stage 4 left them alone rather than shipping a half-translation. That is a
known limit of the render model, not of the pack model, and it is recorded in §8.4 and in the audit.

### 7.5 An unknown word skips, it does not blank the page

A section whose `kind` or `section_key` this build was not taught is dropped from the list and named
in `issues` with the value that caused it; the other sections still draw. A *required* section whose
kind is unknown is the exception, and the projection refuses the whole document for it — a promised
paragraph no renderer can draw is the false-completeness failure the provenance model exists to
prevent. The rule lives on the far side of a publication's lifetime, because the reader who cannot be
updated is the guest holding a link, and the split is the projection's, not a try/catch.

### 7.6 Provenance is carried and never printed

Each section reaches the JSX with `provenance`: `reviewed_pack` (with the language it resolved from
and whether the fallback was used), `host` (with which field it came from and whether it overrode pack
wording), `unknown` (a word from a newer projection, drawn without a claim), or `none`. That exists so
the host's own editor can say "this is your wording, not the pack's" — §12's honesty rule — and not so
a guest's document acquires a badge. `traditionPack.revision` is parsed for exactly the same reason:
available to the host's views, never drawn. An unsearched leak of any of it is a §5-class finding, and
the sweep in §8 checks for it in the rendered text.

## 8. Stage 4 measurements against this contract

All of it was measured through the production bundle (`vite preview` over `dist/`, driven by CDP), not
through the dev server; the instrument is `scripts/stage4-render-qualification.mjs`, and its own
failures during development are recorded in the audit rather than edited out.

### 8.1 The 10 × 4 sweep, re-run

10 content shapes × 4 viewports (360×740, 390×844, 768×1024, 1440×900): **0 horizontal overflow, 0
clipped elements inside the article, 0 injected elements**, no machine key or provenance string in the
rendered text (`role_key`, `group_key`, `event_key`, `section_key`, pack keys, release identifiers,
reviewer labels), no unsafe link scheme, `lang` present on every document that has a language, and the
resolved `font-family`/`font-size`/`color`/`text-align` matching what each shape's own style object
declared — or being refused, where the value was not one the whitelist admits.

Eight of the ten shapes draw a frozen release, and they are the ones a Stage 3 sweep could not have
built: `3-reviewed-tamil`, `4-reviewed-english`, `7-long-tamil`, `8-unbroken-english`,
`9-mixed-script` and `10-hostile-markup` each freeze the synthetic approved release and draw its
headings and wording, `5-tamil-fallback` freezes the release that declares an English fallback, and
`6-host-override` is the approved document with one of the release's paragraphs replaced by the
host's own — the `pack:` field beside each shape in `scripts/stage4-render-qualification.mjs:306-366`
is the evidence. `1-no-pack-minimal` and `2-no-pack-full` are the only no-pack arms, so a pack-backed
page is always compared against a page that never chose a pack. The stress content in
`8-unbroken-english`, `9-mixed-script` and `10-hostile-markup` is the content the Stage 3 sweep
already used, re-pointed at a release rather than invented for this stage. Every shape's checks run
once as a shape fact and are reported across all four viewports, so a shape that only breaks at 360 px
says so.

Contrast and tap size are **reported, not asserted**: the table prints each shape's `h1`/body ratio
against the paper and `n/msmall`, the count of interactive elements in the article and how many of
them are under 24 CSS px on a side. Across 40 loads, one shape carries one such element (the venue-map
link) and the other nine carry none, and `0small` appears on every row. This sweep therefore says
nothing about tap sizes it was not given, and the ratios it printed — 12.17, 13.9, 14.26, 16.32 — are
numbers a reader can act on rather than a gate this build passes by definition.

### 8.2 Motion, re-measured — and one instrument artifact

`0` animations inside the article on all 40 loads, and no transition class on it. The first run of this
pass reported 4; that was the instrument's own fault, not the document's. `document.getAnimations()`
is document-wide and was being read *after* the focus probe called `.focus()` on the one linked shape,
so what was counted was a `:focus-visible` shadow transition on the map link — caused by measuring.
Both halves were fixed before the number above was taken: the animation read now happens before any
focus probe, and it is scoped with `article.contains(target)`, reporting
`animationDetail` per row so a future run that disagrees says which element moved. Nothing in
`InvitationRenderer` was changed on the strength of the bad reading.

### 8.3 Glyph evidence, per code point

The earlier probe asked `document.fonts.check()` a question it could not answer on a cold font subset,
which produced false negatives. It now runs inside the document that actually carries the script,
awaits `document.fonts.load(...)` for the drawn characters, and reports each code point it could not
match to a loaded face. On the four Tamil-bearing shapes that is 97/24, 62/21, 889/27 and 84/25
(code points / distinct), each with loaded Tamil faces and **no code point without a face**. Five
captures are kept locally under the gitignored `artifacts/stage4-render/`: the reviewed-Tamil document,
a fallback case, a host override, the mixed-script page, and the hostile-markup page. They are not
committed and no artifact is pushed, so what travels with this branch is the numbers above and the
filename beside each one — a reader who needs the pixels has to re-run the instrument.

### 8.4 Disclosed limits

* English date and time text on a non-English document (§7.4) — unfixed, deliberately.
* `document.title` is still unbounded (§5.2), and Stage 4 did not add a truncation rule on a guess.
* The focus indicator this sweep saw is **not** the design-system ring. The instrument reaches the
  article's one link with `element.focus()`, and programmatic focus on a link does not match
  `:focus-visible`, so what the page drew was the browser's default outline — `3px solid
  rgb(92, 26, 27)`, the document's own colour, which is 12.17:1 against the paper by the same
  arithmetic the table already prints — over three transparent `box-shadow` slots. The keyboard
  measurement that *does* exercise the shared token is Stage 3's §10 Tab traversal, and this pass
  re-used its conclusion rather than re-deriving it; it did not re-measure the ring's contrast, and
  no claim here should be read as that. **No WCAG conformance is claimed for the product.**
* Every pack in the local catalogue during these runs is a `TEST ONLY` fixture or a draft candidate.
  The wording the Tamil shapes drew is machine-assisted and unreviewed, so what §8.3 verifies is
  **rendering**, not language: **nothing here was read by a native speaker of any supported script.**
