# Structured creator specification

**Status: target design.** Today the creator is a name + language + optional design-direction form.
The guided, section-by-section creator below is what V1 aims at.

## Why this is not Canva

A general canvas gives an infinite set of possible outputs, most of them wrong. For this product
the failure mode that matters is not "ugly" — it is an invitation that a mother reads and says *this
isn't how we do it*: a missing elder's name, the invocation in the wrong place, a function left off,
the language of the family not the language of the couple.

Canvas tools optimise for self-expression. An invitation optimises for **correctness and
acceptance inside a specific family**, fast, on a phone, by someone who is mid-planning-wedding and
has no design time. Structure is the feature:

- The host should never face an empty artboard.
- The system should know what information is *missing*, which requires knowing what information
  exists.
- The same content must re-flow into a live page, a share image, a PDF and a print sheet. Free-form
  element placement makes every one of those a separate manual job.
- Approval has to mean something. A relative reviewing a floating pile of shapes cannot answer
  "is this right?"; a relative reading a document can.

So: **strong structure, meaningful choices, limited styling latitude.** The host decides names,
events, places, wording and look. The product decides that the document holds together.

## Editable concepts, and how each should be modelled

| Concept | Structured / freeform / hybrid | Notes |
| --- | --- | --- |
| Couple / hosts | **Structured** | Named participants with roles and relationships; ordering is meaningful and drives layout and salutation |
| Family names / elders | **Structured** | Repeatable person entries with relation + position; never one paste-able paragraph, or the layout cannot protect them |
| Blessings / invocation | **Hybrid** | Reviewed pack samples selectable, freely editable text on top; the choice must be visible, not silently injected |
| Invitation wording | **Hybrid** | Pack-provided sentence frames, host-editable; edits must not break required data bindings |
| Events / functions | **Structured** | Type, name, date, start/end, dress/code optional; multi-event is core, so this is a repeating record |
| Venues | **Structured** | Name, address, geo point, map link, hall/room note; shared across events deliberately |
| Images | **Structured with constraints** | Slot-typed (couple photo, family photo, backdrop); aspect and crop governed by design, not dragged |
| Theme / design direction | **Structured choice** | Pick a direction; the direction owns typography, spacing, palette and motif placement |
| Colour | **Structured, bounded** | A curated palette per direction, not a free colour picker over the whole design |
| Optional music | **Structured choice + asset** | Pick from reviewed library or upload; playback is opt-in per guest session, never autoplay |
| Monogram | **Structured option** | Derived from names with a small set of treatments; a design element we own, not a text box to place |
| Language | **Structured selection** | Explicit host choice; primary language plus optional second; never inferred |
| Personal note | **Freeform** | Deliberately unstructured — this is the one place raw prose is the point |

The rule: **facts that affect layout, logic or legal meaning are structured. Expression is
freeform.** A name that a screen must never truncate is a fact. A sentence of blessing is
expression.

## Allowed customisation

Permitted within a design direction:

- Choice of direction, and of palette inside that direction
- Display/body type pairing where the direction offers variants
- Which optional sections appear
- Ordering *within* a group where the tradition permits it
- Motif emphasis and background texture strength
- Photo selection into defined slots

Not permitted:

- Arbitrary x/y placement of elements
- Independent font size per text node
- Overlapping elements requiring manual collision repair
- Per-section colour overrides that break contrast guarantees

Two honest reasons for the limits: unbounded placement destroys the multi-output promise (every
export becomes a bespoke layout), and it re-creates the exact anxiety the product is meant to
remove — "have I made this wrong?".

## Implications for the current editor

The existing design-preview panel (font, size, colour, alignment, simulated foil) is a
**FOUNDATION**, not a first implementation of this spec. It writes a single styling object onto the
draft and applies it to a placeholder preview. Expect it to be replaced by direction-scoped
controls rather than extended — in particular, a free numeric font size and a free colour picker are
both contrary to this document. See [`feature-readiness.md`](feature-readiness.md).
