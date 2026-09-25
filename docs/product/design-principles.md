# Design principles

These are binding rules for visual and editorial decisions in VivaahVarnam. They exist mostly to
rule out the default look of a well-meaning SaaS generator, which reads as generic and, in this
category, as untrustworthy.

## 1. Ceremonial first impression

The invitation sheet is the hero of every screen it appears on. Chrome — panels, buttons, nav — is
quiet, neutral and paper-toned so the document carries the ornament, never the interface around it.
A screen where the UI competes with the invitation has failed.

## 2. Readability before density

Type sizes are generous, measures are constrained, and contrast is not decorative. An invitation
that looks beautiful and reads poorly at arm's length in daylight is a failure of the product's core
promise. Leading sits around 1.6 for body copy; display headings are allowed tighter leading but not
tighter tracking that harms Indic glyphs.

## 3. Elder-accessible

The reviewer in the family is often a parent or grandparent, on someone else's phone, without
glasses to hand. Concretely:

- Base body text at 16px minimum, and 18px on invitation surfaces
- Running copy and labels at 14px minimum. Uppercase eyebrow and badge microcopy may go to
  12px, but only when it is decorative-of-meaning (the same fact is stated at readable size
  elsewhere) and it still clears the contrast targets
- No grey-on-grey "quiet" labels that drop under contrast targets
- Touch targets at least 44×44px, with visible spacing between them
- Plain language: no product jargon, no English-only UI vocabulary where a launch language exists
- Every action labelled with words, never icon-only meaning
- Explicit back paths — an elder must be able to undo their way out of anywhere

## 4. Script support is a requirement, not a skin

The Latin face is always first in a font stack, followed by one Noto face per supported script
(Tamil, Telugu, Kannada, Malayalam), then a generic family. Text wrapping and hyphenation stay on;
line heights leave room for taller Indic ascenders and vowel marks; no design may depend on
characters that a supported script lacks. Any visual change must be reviewed in Tamil, not only in
English.

## 5. Low-bandwidth and mobile-first

The guest view is the product's most-experienced surface, on mid-range Android over mobile data,
inside a chat app's browser. So: the invitation renders before any animation does; no autoplaying
media; images sized and lazy-loaded; no render-blocking dependency for content a guest needs
immediately; and the design must still communicate with fonts failed to load.

## 6. Restrained motion

Motion exists to show a change of state or to give the document a moment of gravity — not to
decorate. Duration short, easing calm, one signature move per screen at most, and every decorative
animation disabled under `prefers-reduced-motion`. Nothing that loops indefinitely, and nothing that
blocks reading while it plays.

## 7. Authentic texture over generic SaaS effects

Paper tone, fine rules, and press-like ink depth are on-brand. Glassmorphism, aurora gradients,
neon glows, floating 3D cards, shimmer sweeps and auto-playing carousels are not — those are
removed from the token set and should not return. Texture should read as printed material, so it is
subtle, non-repeating where visible, and never applied over text.

## 8. No cultural stereotyping

Motifs must be chosen and reviewed as culture, not improvised as decoration. No bindi/paisley/elephant
clip-art reflex applied to anything Indian; no combining symbols from different traditions into one
"Indian-looking" background; no religious iconography on generic surfaces where it is not selected
content. The generic UI carries no religion at all — a template placeholder must not presume a
deity, a symbol or a ritual the host did not choose.

## 9. Customer-selected tradition

The host states their tradition; the product never guesses. Any UI that could imply the product has
classified the customer's religion, caste or community is a defect. See
[`content-governance.md`](content-governance.md) for the content lifecycle this principle protects.

## 10. One reusable identity across outputs

The same version must read as the same invitation in a live page, a share image, a PDF and a print
sheet: same type scale, same palette, same margins logic, same motif placement rules. Design
tokens are the single source of that consistency — an output that needs off-token values to look
right is evidence the token set is incomplete, and the tokens get extended rather than the output
getting a special case.

## UI accessibility targets

Working targets for this product, checked by review and by the QA passes recorded in
[`../audits/`](../audits/):

| Target | Threshold |
| --- | --- |
| Body text contrast | 4.5:1 |
| Large text contrast | 3:1 |
| UI component and icon boundaries | 3:1 |
| Base body size | ≥16px, 18px on invitation surfaces |
| Touch target | ≥44×44px, ≥8px apart |
| Keyboard | Every interactive element reachable, visibly focused, operable |
| Focus | Never removed; ring visible on paper and ink surfaces |
| Zoom / reflow | Usable at 200% text zoom and at 360px width |
| Motion | Decorative motion off under `prefers-reduced-motion` |
| Naming | Every control has a programmatic name; brand name announced as one string |
| Language | `lang` set correctly on script content, not only on the document |

**These are internal design targets, not a compliance certification.** VivaahVarnam has **not**
been through a formal WCAG audit, and nothing here should be read as claiming full WCAG conformance
or any accessibility badge. Colour is never the only signal, and status messages use live regions —
but the honest statement of status is "designed against targets, partially verified manually".

### Known deviations measured in the Stage 1 QA pass

Recorded rather than hidden, so a later pass can close them:

- Text `Input` and `Button` controls render 40px tall (the shared component library's default),
  under the 44px target. Navigation links, the mobile menu and the footer were raised to 44px;
  the control height is a system-wide change deliberately not made here, because it would
  re-density screens that cannot be reviewed without a running backend.
- Inline links inside a sentence (`Don't have an account? Sign up`) stay at text height. They are
  exempt from a minimum target size by convention; standalone controls are not.
- `lang` is set on the document only. Per-script `lang` on invitation content is a Stage 2 item
  tied to the structured creator.
