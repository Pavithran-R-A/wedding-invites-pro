// The four prose slots a host writes, and the three names each of them answers to.
//
// One camelCase key (`invitation_drafts.content`, as the adapter types it), one snake_case
// name (`host_field`, as a tradition-pack release section names it), and one line of English
// on the screen. Those three have to agree for a preview to be truthful: a panel that called
// `event_notes` something else than the editor calls it would describe a field the host
// cannot find. The map lives here rather than beside either component so the two cannot drift.

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
