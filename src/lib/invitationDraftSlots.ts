// The four prose slots a host writes, and the four names each of them answers to.
//
// One camelCase key (`invitation_drafts.content`, as the adapter types it), one snake_case
// name (`host_field`, as a tradition-pack release section names it), and two lines of English
// on the screen — the label on the field and the sentence under it. Those have to agree for a
// preview to be truthful: a panel that called `event_notes` something else than the editor
// calls it would describe a field the host cannot find. They live here rather than beside
// either component so the two cannot drift, and because the editor that prints them is now
// laid out by a release's section order (`AuthoringOutline`), which is not a place to be
// inventing slot names.

import type { PackHostField } from './traditionPackContract';
import type { InvitationDraftContent } from '@/integrations/supabase/weddings';

/** The slot a pack section's `host_field` reads, in the draft's own key names. */
export const HOST_FIELD_OF_SLOT: Record<PackHostField, keyof InvitationDraftContent> = {
  welcome: 'welcome',
  family_introduction: 'familyIntroduction',
  event_notes: 'eventNotes',
  closing: 'closing',
};

/** The host's word for each slot, as the editor prints it. */
export const DRAFT_SLOT_LABELS: Record<keyof InvitationDraftContent, string> = {
  welcome: 'The opening',
  familyIntroduction: 'Who is inviting',
  eventNotes: 'A note about the ceremonies',
  closing: 'The last words',
};

/** The sentence under each field, for a host deciding what belongs there. Nothing in it names a
 *  tradition, a community or a rite: these four slots are the platform's own, and a release that
 *  has different words for one of them supplies its heading, not this hint. */
export const DRAFT_SLOT_HINTS: Record<keyof InvitationDraftContent, string> = {
  welcome: 'First thing a guest reads. Names, a greeting, a blessing — as you would write it.',
  familyIntroduction: 'The families and elders whose names appear with the invitation.',
  eventNotes: 'Anything guests should know about the gatherings — dress, timings, whom to greet.',
  closing: 'How the invitation ends.',
};
