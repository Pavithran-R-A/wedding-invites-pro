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
  `scrollWidth 2786` against `clientWidth 345` — the document ran sideways. With it: 345 = 345, no
  horizontal overflow, on all six fixture shapes.
* **A stated default lead size.** `weddings.style_settings` is `'{}'` until a host opens the editor, so
  a draft frozen straight from the planning page has no size at all. Treating that as "say nothing"
  rendered the paper at the page's 16 px body text with a 12.9 px caption. `DEFAULT_LEAD = 26` states
  the missing choice instead of leaving it to the cascade.

Both are pinned in `src/test/invitationRenderer.test.tsx`, whose 15 cases also cover: the hostile style
values (`red;}`, `…; background: url(http://…)`, `999`, `3`), escaping, absent slots drawing nothing,
a note surviving an empty ceremony list, `lang`, and the map link's attributes.

## 5. Findings this contract records rather than hides

1. **`role_key` can reach a guest as a label.** `PersonLine` renders `roleLabel ?? roleKey`, so a person
   whose role has no platform label shows the machine key (e.g. `guest`). Not a defect in the chain —
   the projection is faithful — but the wrong fallback for a document a family reads aloud. Fixing it
   means deciding what an unlabelled role should render as, which is a content question for the
   tradition-pack stage, not a rendering one.
2. **`document.title` is unbounded.** On the extreme fixture the page title is the invitation's title
   verbatim, measured at 465 characters. Browsers cope; a chat app's link card does not. A truncation
   rule belongs to whoever next owns sharing, and is not applied here on a guess.
3. **A chosen font may not be a loaded font.** `Noto Serif Tamil` is offered by the editor and is not
   among the faces the page loads (which include `Noto Sans Tamil`), so that choice falls through to
   the script fallback. Recorded as a font-availability gap; the fallback is correct behaviour, the
   offering is the bug.
4. **Glyph fidelity is unverified.** Screenshot capture does not work in the qualified environment, so
   no check confirmed that a Tamil codepoint rendered as a letter rather than a tofu box. This
   document therefore claims **rendering verification only** — structure, contrast, sizes, overflow and
   escaping were measured; nothing was read by a native speaker of any supported script and no WCAG
   conformance is claimed.

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
