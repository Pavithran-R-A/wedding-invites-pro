# Invitation semantics — the patrika model

**Status: conceptual model.** The preview build stores an invitation as a title, a language, an
optional template reference and a styling object. The rich structure described here is the target
shape, not the current schema.

## The idea

An Indian wedding invitation is not a poster with information on it. It is a **ceremonial
artefact** with a conventional order, a set of named participants, and obligations: whose names
come first, which blessing opens it, which functions are listed, how a guest is addressed. Paper
patrikas get this right because a printer has typeset thousands of them. Digital invitations get
it wrong because a form field was never going to hold it.

So the product models the invitation as a structured document whose *sections* are known, whose
*order* is data, and whose *wording* is reviewed content — not free text dumped into a template.

## Conceptual section flow

```text
cover / opening
selected-pack ceremonial intro
family / blessings heading
couple
hosts / family context
invitation wording
events / functions
venue / map
personal salutation
optional RSVP
closing blessing / message
optional tasteful audio / animation
```

This is a **default vocabulary, not a mandated liturgy**. A tradition pack decides which of these
appear, in what order, with which labels, and which are required. A Hindu-Tamil pack, a Christian
Malayalam pack and a secular bilingual pack will differ materially, and none of them is "the
correct order".

**There is no universal religious order.** No single sequence is treated as canonical for Indian
weddings, and the product must never present one as such.

## What a tradition pack controls

| Control | Meaning | Example of the decision it carries |
| --- | --- | --- |
| Section ordering | Which sections exist and their sequence | Does the family invocation precede or follow the couple block |
| Labels | The words used for each block | "Sampradāyam" vs "With the blessings of" vs "Inviting families" |
| Optional / required info | Which fields a host must fill | Whether gotra-style or community descriptors appear at all |
| Motifs | Decorative vocabulary | Temple gopuram line-work vs crosses vs neutral borders |
| Typography guidance | Recommended faces, sizes, script pairing | Which display face carries Tamil legibly at small sizes |
| Wording samples | Reviewer-approved sentence templates | Opening invocation, RSVP request, closing blessing |
| Event vocabulary | Names for functions | Haldi / Samsadanam / Nichayathambham / Reception |

Packs are **data and reviewed content**, not code branches. Adding a pack must not require editing
the renderer, and the renderer must not contain `if religion ==` style logic.

## Selection is always explicit

The host chooses the pack. The product never infers one.

- A name is not evidence of religion, caste, community, region, language or tradition.
- Language is chosen by the user and is orthogonal to tradition.
- Where the product offers a suggestion, it is presented as a question the host can decline, never
  as a resolved default derived from identity data.
- No field is validated against a claimed community. If a host's selections are unusual, that is
  their wedding.

This constraint exists because mis-inference here is not a cosmetic bug. Guessing a family's
community wrongly, in the one document that announces a marriage, is a serious and visible harm.

## Consequences for data modelling

1. **Sections are addressable.** Rendering, approval and export all need "this block, this order",
   so invitation content is structured data with explicit section identity — not one HTML blob.
2. **Order is data.** Section sequence lives in the pack definition so packs stay declarative.
3. **Freeform survives.** Some content is genuinely free text (a personal note, custom blessings).
   The model must hold both reviewed samples and host-written prose without pretending they are
   the same kind of object.
4. **Personal salutation is per-recipient.** The same version must render "Dear Sharma family" and
   "Dear Anitha and Suresh" without a second version existing per guest.
5. **Anything optional is optional in the schema too.** A pack that omits the invocation must not
   force an empty section into the layout.
