# Commercial model

**All figures in this document are TARGET / SUBJECT TO PILOT VALIDATION.** They are internal
planning anchors, not live prices, not displayed prices, and not offers. No payment collection, no
billing and no entitlement logic exists in this repository. Nothing here has been tested against
customers, and the numbers are expected to move.

Tax treatment is deliberately unstated: whether any amount would be inclusive or exclusive of GST
is an open question for the commerce stage, and no figure in this document implies either. These
figures must not be hardcoded into UI, and must not be surfaced to users as pricing.

## Why one-time, per-invitation

A wedding is a single high-stakes event with a deadline, not a subscription. A recurring charge for
a document that stops being relevant weeks after the wedding reads as a trap, and the cancellation
support cost alone would outweigh the revenue. Packaging is therefore per wedding, bought once.

## Target packages

Every amount below carries the same status: **TARGET / SUBJECT TO PILOT VALIDATION**.

| Package | Target (one-time) | Intended value |
| --- | --- | --- |
| Preview | ₹0 | Sign up, build and save invitation drafts. This is what the current build does. Free while in preview. |
| Vivaah | ~₹999 | One published multi-event invitation, guest links, RSVP, image/PDF/QR outputs, support in the chosen language |
| Family | ~₹2,499 | Household-level personalisation, family approval flow, multiple hosts contributing, higher guest volume |
| Heritage | ~₹4,999 | Reviewer-approved tradition-pack wording, human proofread, monogram, custom illustration, priority support |
| Bespoke | ~₹9,999+ | Designer-led work with human coordination, including print coordination where offered |

The ladder is organised by **how much human judgement is bought**, not by how much usage is
metered. Moving up should mean a better invitation and less anxiety, never simply "more guests
allowed".

## Explicitly rejected commercial patterns

| Rejected | Why |
| --- | --- |
| Ordinary per-guest sharing fees | A host must never pay to be *received* by people they are inviting. It penalises the size of the family rather than the value delivered |
| Charging for basic maps | Directions are the most-used fact on an invitation; paywalling them degrades the guest for revenue the product does not need |
| Charging for basic QR | A QR code is how a printed or displayed invitation reaches a phone. It is part of "published", not an extra |
| Charging just to download a CSV | Exporting one's own RSVP responses is a data-protection and courtesy matter, not a feature tier |
| Micro add-on philosophy (a little fee for each small thing) | It converts a warm, ceremonial purchase into a series of resentment moments, and it is the pricing style this product exists to be an alternative to |

Watermarks on published outputs, paywalled guest counts, and "pay to unlock RSVP replies" all fall
in the same category and are rejected for the same reason.

## Where premium value may legitimately come from

These are the honest sellable things, because each one is real work we do for the host:

- Proofreading before publication
- Human wording review in the host's language and tradition
- A monogram designed from the couple's names
- Custom illustration
- Designer help with layout and typography
- Rush help when the wedding is close
- A custom domain for the invitation link — later
- Video invitation — later, and optional, never a dependency
- Print coordination — later, including physical card production where we can do it well

Note the shape: **human time and judgement, not withheld basics.** If a charge can be described as
"pay us so your guests can read the invitation", it is the wrong charge.

## Open questions for the pilot

1. Will hosts pay at all in this category, and at which of the anchors above?
2. Does the free preview convert, or does it satisfy the need completely?
3. Which human services are actually requested versus which we assumed were valuable?
4. Where does price sensitivity sit — number of guests, number of functions, or language/translation
   effort?
5. What refund behaviour is fair when a wedding is called off? That answer should be generous, and
   it should be designed before money is taken, not during a dispute.

## Guardrails for whoever implements this

- Payment, entitlement and refund state are server-authoritative. See
  [`../architecture/decisions/0005-server-authoritative-commerce.md`](../architecture/decisions/0005-server-authoritative-commerce.md).
- No payment provider integration exists yet; naming a provider in architecture notes is not a
  selection decision.
- Publishing gates must be enforced server-side and must never be bypassable by client state.
- Price display must come from configuration owned by the commerce stage, with tax treatment stated
  explicitly at that time.
