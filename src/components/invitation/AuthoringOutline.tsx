// The host's editor, laid out by the release the invitation actually stands on.
//
// Before Stage 5 this page owned its own section list: four textareas in a fixed order, and
// three row editors in a box underneath them. That was fine while one neutral layout was the
// only layout, and it is the thing a tradition pack breaks — a release that puts the people
// between two paragraphs, names the third section "the blessing", and forbids the host from
// rewriting it cannot be authored by a screen that decided all of that in advance.
//
// So the order and the rules are not this component's. They arrive as `authoring`, the
// AUTHORING DECLARATION from `api.preview_invitation_document`, which is a projection of the
// same definition read that produced the document on the canvas
// (`private.invitation_authoring_declaration`, and the note above it in
// `supabase/migrations/20260929120000_stage5_pack_driven_authoring_review.sql`). The array
// order is kept rather than re-derived from `position`, for the reason
// `invitationSections.ts` gives for the same choice: two readers that sort by hand are two
// chances to disagree with the document. Nothing here reads a pack definition, a raw `jsonb`
// column or a review record, and nothing here asks what a wedding's tradition is.
//
// The dispatch is only ever over declared facts:
//
//   * `kind` says which control belongs — a prose field, the people rows, the ceremony rows.
//   * `host_field` says which of the four draft slots the prose writes; its absence says there
//     is nothing for the host to write at all.
//   * `override_rule` says whose wording the page shows. `pack_only` gets the reviewed line and
//     no editable field, because a field would be an offer the release refuses;
//     `host_must_supply` gets a field and the statement that no wording was written for it;
//     `host_may_replace` gets a field and the pack's line beside it while the field is empty.
//   * `required` and `requires_venue` are shown as what they are — facts about the release — and
//     are not re-checked here. Whether one of them is *unmet* is the server's answer, in
//     `issues`, printed once by `AuthoritativeIssues` above these controls. A second
//     implementation of "is this full yet" is exactly what preview/freeze parity forbids.
//
// `venue` is the one thing that is not a section. Venues are rows an event list chooses from, so
// the venue editor is mounted once, at the event list's own position, and a release that
// declares no event list never asks for one. That is a consequence of the declaration, not a
// branch on a slot key — and the database guarantees the position is unique, because the guard
// refuses a release with a second people list or a second event list.
//
// An entry the adapter could not parse is already gone: `parseAuthoring` in `publication.ts`
// refuses a section whose kind, key or host field is outside this build's vocabulary, and the
// server's blocking `kind_unrenderable` record says so in the finding list. A control invented
// for a rule this build does not know would be a second answer to a question the database has
// already refused.

import { useId } from 'react';
import { CeremonyGroup, PeopleGroup, VenueGroup, type WeddingContentRows } from './ContentEditor';
import { Label } from '@/components/ui/label';
import { DRAFT_SLOT_HINTS, DRAFT_SLOT_LABELS, HOST_FIELD_OF_SLOT } from '@/lib/invitationDraftSlots';
import { headingOf, isHostEditable, packTextOnlyNotice, SECTION_LABELS } from '@/lib/invitationAuthoring';
import { normalizeInvitationSections, type RenderProvenance } from '@/lib/invitationSections';
import type { AuthoringSection } from '@/integrations/supabase/publication';
import type { InvitationDraftContent } from '@/integrations/supabase/weddings';
import type { PublicInvitation } from '@/lib/publicInvitation';

export interface AuthoringOutlineProps {
  /** The server's declaration for this wedding, in the release's own order. */
  authoring: AuthoringSection[];
  /** The document the canvas draws, with the host's unsaved typing in it, so a block shows the
   *  same words the host is looking at and whose-wording line means what the canvas says. */
  invitation: PublicInvitation;
  draft: InvitationDraftContent;
  onDraftChange: (value: InvitationDraftContent) => void;
  /** The wedding's row lists, owned by the page and mounted wherever the declaration puts a
   *  list section. */
  rows: WeddingContentRows;
  disabled: boolean;
}

const PROSE_ROWS = 4;

/** The reviewed line, or the line the host has, shown as text rather than as a field. `pre-line`
 *  so a break the release author typed stays a break — the same rule the guest renderer uses. */
const WordingBox = ({ caption, text }: { caption: string; text: string }) => (
  <div className="space-y-1 rounded-lg border border-gold/50 bg-paper p-3">
    <p className="text-[11px] font-medium">{caption}</p>
    <p className="whitespace-pre-line break-words text-xs leading-relaxed">{text}</p>
  </div>
);

/** A fact about the release, printed under the control it describes. Every one of these is
 *  worded the same way on purpose: the panel has several statements to make and a host should
 *  be able to tell a note from a heading at a glance. */
const SectionNote = ({ text }: { text: string }) => (
  <p className="text-[11px] leading-snug text-muted-foreground">{text}</p>
);

/** Whether a stored slot holds something a host actually wrote. A slot saved as spaces says
 *  nothing, and announcing that an empty field is "not being used" would be this panel
 *  inventing a problem the host cannot see. */
const nonBlank = (value: string | null): boolean => value !== null && value.trim() !== '';

interface ProseProps {
  section: AuthoringSection;
  fieldId: string;
  /** The block's own title, so a notice can name the section the way the screen names it. A
   *  `section_key` is a machine identifier and must never reach host-facing prose — the guest
   *  renderer refuses to print one for the same reason. */
  title: string;
  provenance: RenderProvenance;
  wording: string | null;
  draft: InvitationDraftContent;
  onDraftChange: (value: InvitationDraftContent) => void;
  disabled: boolean;
}

/** One prose section, laid out by its own rule. The three cases are the three rules, and the
 *  fourth branch (`hostField === null`) is the release supplying a line the host has no field
 *  for — which is why it reads the wording and not the draft. */
const ProseControl = ({
  section,
  fieldId,
  title,
  provenance,
  wording,
  draft,
  onDraftChange,
  disabled,
}: ProseProps) => {
  const slot = section.hostField === null ? null : HOST_FIELD_OF_SLOT[section.hostField];
  const packLine = provenance.source === 'reviewed_pack' ? wording : null;

  if (slot === null || !isHostEditable(section)) {
    // `pack_only` is the only reachable case with a slot: the resolver never reads the host's
    // draft for it, so a line written while an earlier release allowed one is still stored and
    // still invisible. Saying so is the non-destructive half of §19 — the field is not offered,
    // and nothing the host typed is pretended to have been deleted.
    const unusedLine =
      slot !== null && section.overrideRule === 'pack_only' && nonBlank(draft[slot])
        ? packTextOnlyNotice(title)
        : null;
    return (
      <div className="space-y-2">
        {packLine !== null ? <WordingBox caption="Your pack's wording" text={packLine} /> : null}
        {slot !== null ? (
          <SectionNote text="This release does not accept a replacement for this section, so there is no field for it here." />
        ) : (
          <SectionNote text="This section is filled by your pack, so there is nothing for you to write here." />
        )}
        {unusedLine !== null ? (
          <p role="status" className="text-[11px] leading-snug text-warning">
            {unusedLine}
          </p>
        ) : null}
        {packLine === null ? <SectionNote text="Nothing supplies this section yet." /> : null}
      </div>
    );
  }

  const hintId = `${fieldId}-hint`;
  const typed = draft[slot];
  const overrode = provenance.source === 'host' && provenance.overrodePackText;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={fieldId}>{DRAFT_SLOT_LABELS[slot]}</Label>
        <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
          {DRAFT_SLOT_HINTS[slot]}
        </p>
        <textarea
          id={fieldId}
          aria-describedby={hintId}
          rows={PROSE_ROWS}
          disabled={disabled}
          value={typed ?? ''}
          // An emptied slot saves as `null`, not as `''`: "the host wrote nothing here" and "the
          // host wrote a blank line" are different facts downstream.
          onChange={event => onDraftChange({ ...draft, [slot]: event.target.value === '' ? null : event.target.value })}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {section.overrideRule === 'host_must_supply' ? (
        <SectionNote text="This release asks you to write this line; no wording is supplied for it." />
      ) : null}

      {packLine !== null ? (
        <>
          <WordingBox caption="Your pack's wording, used while this field is empty" text={packLine} />
          <SectionNote text="Type here and this invitation starts recording the line as yours, not as the pack's." />
        </>
      ) : null}

      {overrode ? (
        <SectionNote text="Your own words are on the page here; they replace the line your pack supplies." />
      ) : null}
    </div>
  );
};

const AuthoringOutline = ({
  authoring,
  invitation,
  draft,
  onDraftChange,
  rows,
  disabled,
}: AuthoringOutlineProps) => {
  const idPrefix = useId();
  // The same normalizer the canvas runs, on the same composed document, so the wording shown
  // beside a field and the wording on the page are one reading rather than two.
  const drawn = normalizeInvitationSections(invitation).sections;
  const venueBlockAt = authoring.findIndex(section => section.kind === 'event_list');

  if (authoring.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-muted-foreground">
        The release behind this invitation declares no sections, so there is nothing here for you
        to write. The findings beside the preview say what that means for a version.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {authoring.map((section, index) => {
        const releaseHeading = headingOf(invitation, section.sectionKey);
        const title = releaseHeading ?? SECTION_LABELS[section.sectionKey];
        const item = drawn.find(entry => entry.key === section.sectionKey);
        const blockId = `authoring-${section.sectionKey}`;
        // A block prints a heading only when nothing inside it already names it. A list group
        // prints its own ("The people"), and an editable prose field prints its label, so the
        // no-pack editor stays exactly as tidy as it was before Stage 5; what a block gains is
        // the release's own heading where the release declared one, because that is the string
        // a guest will read over the section.
        const namesItself = section.kind !== 'text' || isHostEditable(section);
        const showTitle = releaseHeading !== null || !namesItself;

        return (
          <div key={`${section.sectionKey}-${index}`} id={blockId} className="space-y-3">
            {showTitle ? (
              <h3 className="font-display text-sm font-semibold">{title}</h3>
            ) : null}
            {section.required ? (
              <SectionNote text="Required by your chosen pack: a version cannot be frozen while this is empty." />
            ) : null}

            {section.kind === 'text' ? (
              <ProseControl
                section={section}
                fieldId={`${idPrefix}-${section.sectionKey}`}
                title={title}
                provenance={item?.provenance ?? { source: 'none' }}
                wording={item?.content ?? null}
                draft={draft}
                onDraftChange={onDraftChange}
                disabled={disabled}
              />
            ) : null}

            {section.kind === 'people_list' ? <PeopleGroup rows={rows} /> : null}

            {section.kind === 'event_list' ? (
              <div className="space-y-5">
                {index === venueBlockAt ? <VenueGroup rows={rows} /> : null}
                {section.requiresVenue === true ? (
                  <SectionNote text="Your chosen pack asks every ceremony below to have a venue." />
                ) : null}
                <CeremonyGroup rows={rows} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default AuthoringOutline;
