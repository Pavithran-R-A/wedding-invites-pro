// Wall-clock text, with no offset and no reader's timezone in it.
//
// A ceremony's instant is not a moment: `wedding_events.starts_at_local` is a bare `timestamp`
// (`supabase/migrations/20260925120100_stage2_canonical_domain.sql:153`) and every projection
// writes it with `to_char(…, 'YYYY-MM-DD"T"HH24:MI:SS')` —
// `supabase/migrations/20260926130000_stage3_publication_resolution_boundary.sql:323`,
// `supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql:1131`,
// `supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql:653` — so there is no
// offset to interpret. `InvitationRenderer` has always printed those digits rather than passing them
// through `Date`, because a muhurtham that moves across a timezone is a lie about the wedding. This file
// is that rule in one place.
//
// It left the renderer for Stage 8. A household's own door lists the events it was paired with, and each
// card needs the same "14 November 2026, 7:30 AM" a guest reads in the invitation above it. Two copies of
// a formatter are how a page starts to disagree with its own document — the same reason
// `src/lib/guestInvitation.ts` reads the invitation through the guest's parser instead of writing a
// second one.
//
// What the *deadline* of a link does is the opposite: `responds_until` is a `timestamptz`, and the honest
// rendering of a deadline is the reader's own local day. That lives in `src/lib/instantText.ts`, in the
// other file, because the two rules must never be merged into one helper.

/** `2026-11-14T07:30:00`, as `private.build_invitation_snapshot` writes it. The seconds
 *  are read and dropped rather than trusted. */
const LOCAL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?$/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "14 November 2026" from the snapshot's own digits. */
export const formatDate = (stamp: string): string | null => {
  const parts = LOCAL_TIMESTAMP.exec(stamp);
  if (!parts) return null;
  const [, year, month, day] = parts;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;
  return `${Number(day)} ${monthName} ${year}`;
};

/** "7:30 AM". A muhurtham is written in the morning, and a guest should not have to
 *  work out whether 07:15 is before or after breakfast. */
export const formatTime = (stamp: string): string | null => {
  const parts = LOCAL_TIMESTAMP.exec(stamp);
  if (!parts) return null;
  const hour = Number(parts[4]);
  const minute = parts[5];
  if (hour > 23) return null;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute} ${suffix}`;
};
