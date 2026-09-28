# Invitation semantics — the patrika model

**Status: conceptual model.** The preview build stores an invitation as a title, a language, an
optional template reference and a styling object. The rich structure described here is the target
shape, not the current schema.

*(Stage 4 closed most of that sentence: an invitation is now a structured, ordered section list
whose labels and wording can come from a reviewed release. The status line above is kept because it
is what Stage 1 wrote, and the last section — "What Stage 4 actually built against this model" —
states exactly which parts of this model are implemented, which are stored-but-unread, and which are
still only intent.)*

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

## What Stage 4 actually built against this model

The honest inventory. "Implemented" here means *a frozen guest document proves it*, not *a column
exists*.

**The section model — implemented.** A release's definition names its sections from a closed set of
eleven product slots (`opening`, `welcome`, `family_introduction`, `family`, `couple`, `invitation`,
`ceremonies`, `venue`, `event_notes`, `blessing`, `closing`), each with a `kind` of `text`,
`people_list` or `event_list`, a unique `position`, a per-language `heading`, a `required` flag, and —
for a `text` section — either reviewed `pack_text` or a `host_field` to read. No slot name in that set
refers to a rite, a community, a deity or a caste: they say where content goes. Adding a slot is a
code change with a renderer beside it, and the database refuses a definition that invents one.

The "no universal religious order" rule is now structural rather than exhortatory: order is a
`position` column inside one JSON document, the freeze preserves it, and the renderer walks the array
it was given. A pack that wants the family block after the ceremonies can do it with data, and one
that wants a heading nobody has written is refused at the gate that approves it.

**Selection — implemented, and it is host-only.** The editor's "Tradition & wording" panel lists
nothing but approved releases, always offers the no-pack option, and states beside it that tradition
packs are optional and an invitation can be created without one. Nothing writes
`weddings.tradition_pack_release_id` except that explicit choice: no default, no suggestion, no
pre-selection, and no read of a name, language, location, community or event name on the way to it.
The four `src/`-scoped shape rules in `npm run product:check` are the tripwire that keeps it that way
when someone adds a feature.

**The pack-controls table, row by row:**

| Control (above) | Stage 4 reality |
| --- | --- |
| Section ordering | Implemented, and frozen with the version |
| Labels | Implemented: a heading per language, ≤160 characters, drawn only in a language the release covers |
| Optional / required info | Implemented as `required` per section. What does *not* exist is a gotra, community or descriptor field anywhere in the model — a pack cannot ask for one, by design |
| Motifs | Parsed (`motif_reference`, ≤200 chars) and **never drawn**. The document's only artwork is the platform's own CSS rules, and a guest cannot see a pack's motif reference because nothing reads it |
| Typography guidance | Parsed (`lead_size`, 8–72) and **never applied**. The host's own style settings decide the lead size, and the renderer clamps it to 22–44 |
| Wording samples | Implemented as `pack_text`, ≤4000 characters per section. "Reviewer-approved" is the rule, not the state: nothing in the local catalogue has been read by a human reviewer |
| Event vocabulary | Validated at write time and **not carried forward**: it is not projected into the snapshot or the guest DTO, so a guest's function names are the host's own event rows. A pack may declare a vocabulary today and the platform will accept it and ignore it |

**Consequence 4 is not built.** A published invitation is one document for every guest who holds the
link: there is no per-recipient salutation, and no version is generated per guest. The consequence
still stands as the model's requirement — it is the reason the answer must not become "publish a
version per family" — and it is listed in
[`feature-readiness.md`](feature-readiness.md) as unimplemented.

**Consequences 1, 2, 3 and 5 are built.** Content is structured with explicit section identity; order
lives in the definition; reviewed samples and host prose are distinct objects (a section's body
carries `body_source` of `host` or `reviewed_pack`, plus whether the host's words replaced the pack's);
and a slot a pack omits draws nothing — no heading, no empty box.

One limit worth keeping visible: the *platform's* own English label, `"The ceremonies"`, is a
placeholder for this model's eventual shape. It is now drawn only on a document whose requested
language is English and only when no release supplied a heading; everywhere else the heading is the
release's word or there is none.
