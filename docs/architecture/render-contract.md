# Invitation render contract

> What an invitation document is made of, how it gets to the screen, and the promises the renderer
> keeps on the way. The measurements behind the claims are in
> [`../audits/stage-3-public-invitation.md`](../audits/stage-3-public-invitation.md) §7 and §8; the
> security half of the same boundary is
> [`public-invitation-security.md`](public-invitation-security.md).

## 1. The chain, and why there is only one

```
live draft (invitation_drafts.content)              frozen snapshot (invitation_versions.snapshot)
                 \                                                /
                  private.build_invitation_snapshot(uuid)      ← what an invitation consists of
                          private.public_invitation_dto(version, jsonb)   ← what a guest may see
                                    |
                 api.preview_invitation (host)  /  api.resolve_public_invitation (guest)
                                    |
                    src/lib/publicInvitation.ts  ← parse the wire shape, or refuse it
                                    |
              src/components/invitation/InvitationRenderer.tsx
                          /                              \
            the editor's canvas                a guest's public page
```

Two rules fall out of that shape and both are enforced by tests rather than by review:

* **one projection.** Preview and publication read the *same* two SQL functions, so a preview that
  flatters its author is not a styling difference but a broken link in this chain;
* **one renderer.** `InvitationRenderer` has exactly two app callers — `src/pages/EditProject.tsx` and
  `src/pages/PublicInvitation.tsx` — and no second copy of the layout exists in `src/`. A "quick"
  guest-only template would silently void §1's first rule.

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
| `design_template`, `tradition_pack` | **not drawn** in Stage 3 — they name platform content, and printing "Rev. 1" on an invitation reads as a defect in it | — |
| `people[]` | one `<li>` per person, grouped under `groupLabel` (falling back to `groupKey`), with `roleLabel ?? roleKey` as the prefix (§5.3) | the group is not rendered |
| `events[]` | a bordered block per ceremony: day from its own digits, `7:30 AM – 9:00 AM`, timezone text, venue name and address lines, and a map link | an event with no content at all is dropped, block and list together |
| `venue.mapUrl` | an `<a rel="noopener noreferrer" target="_blank">` labelled "Open the venue map" | the address stays, the link does not appear |
| `welcome`, `family_introduction`, `event_notes`, `closing` | paragraphs, `white-space: pre-line` | nothing is drawn — no heading, no empty box |

`event_notes` renders inside the ceremonies section when there is one, and as its own labelled section
when there is not, so a note is never orphaned by a shape the host chose.

## 3. Three promises the renderer is written to keep

1. **No markup reaches the page.** Every host string is a JSX text child, so React escapes it; the file
   injects no HTML. A `<script>` in a welcome line appears as those characters. The database
   deliberately does *not* sanitise (`API25` proves the bytes arrive unchanged), because a second,
   weaker definition of "safe" at rest is one the renderer could disagree with.
2. **Nothing is invented.** No placeholder, no counted "1 of 3 ceremonies", no default venue, no
   "TBD". The one label the component supplies is `"The ceremonies"`, and the comment at that line
   says why it is ours rather than a fact about the wedding.
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
5. **The focus ring's contrast is below 3:1 against the paper.** Keyboard operation was measured, not
   assumed: Tab walked the three venue links in DOM order, Shift+Tab walked back, the fourth Tab left
   the document, and every stop matched `:focus-visible` and was scrolled into view. What the check
   also found is that the indicator is a single 2 px `box-shadow` ring in `rgb(205, 146, 45)`
   (`--ring`) with a transparent `outline`, and against the card's own
   `rgb(255, 246, 240)` background that measures **2.54:1** — visible, but short of the 3:1 that
   WCAG 1.4.11 asks of a focus indicator. Body text and link text measure 8.82:1 on the same paper,
   and the links are 216×47 CSS px, so this is one narrow shortfall rather than a general problem.
   It is recorded here and in the audit's closure section; it is not one of the five defects this
   pass was told to repair, so no token change was made on a guess.

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
