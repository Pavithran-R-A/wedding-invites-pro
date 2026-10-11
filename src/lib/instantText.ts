// The day-and-time text for an absolute instant, in the reader's own calendar.
//
// This is the opposite half of `wallClock.ts`, and the two must not be merged: a ceremony's
// wall-clock text is the wedding's fact and is printed from the snapshot's own digits with no offset
// at all, while a *link's* deadline is a `timestamptz` and means the same moment in Chennai and in
// London. Printing a deadline's raw string would show the UTC day, which is sometimes not the
// reader's day — and a relative who was told "8 October" on a 7 October evening in IST would tell the
// family the link worked a day later than it did. The honest rendering of a deadline is the reader's
// own.
//
// It moved out of `src/pages/FamilyReview.tsx`, where Stage 7 kept it beside its one page, because
// Stage 8 shows the same kind of value on two screens: the household's own door answers
// `responds_until` (`20261009120000_stage8_guest_invitations_rsvp.sql:693`), and the host's guest
// panel answers each link's `link_expires_at` (`:514`). Two copies of a deadline formatter are how a
// host and a guest end up reading different days for the same link.

/** `null` for an absent deadline, and `null` for a string that is not an instant. A link with no
 *  expiry is a real state, not a formatting failure, so the caller decides what to say about it. */
export const formatInstant = (iso: string | null): string | null => {
  if (iso === null) return null;
  const moment = Date.parse(iso);
  if (!Number.isFinite(moment)) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(moment),
  );
};
