// The one renderer of an invitation.
//
// Both halves of the product draw through this file: the host's preview (fed by
// `api.preview_invitation`) and a guest's public page (fed by
// `api.resolve_public_invitation`) receive the same `PublicInvitation` object from the
// same database projection, and then run the same JSX. That identity is the point — a
// preview that flattered the host with a fancier layout than their guests would see is
// a lie told at the worst possible moment, and the RPC comment in
// `20260926130000_stage3_publication_resolution_boundary.sql` says the same thing from
// the other side.
//
// What it undertakes not to do:
//   * It puts no markup in the page. Every host-authored string is a JSX text child, so
//     React escapes it; this file injects no HTML, and a guest's browser is never asked
//     to parse HTML that a stranger wrote. Line breaks the host typed are honoured with
//     `white-space: pre-line`, which is text layout, not markup.
//   * It shows nothing the DTO does not carry. `designTemplate` and `traditionPack` are
//     read in Stage 3 by the render contract's own tests and not displayed: they name
//     platform content rather than anything a guest was told, and printing "Rev. 1" on
//     an invitation would read as a defect in it.
//   * It invents no facts. An absent muhurtham time, venue or line of text renders as
//     nothing at all rather than as a plausible placeholder, and a date is formatted from
//     its own digits instead of being run through `new Date()` — a wall-clock time that
//     crosses a client timezone on the way to the screen is the wrong ceremony's time.
//   * It prints no machine key. `role_key`, `group_key` and `event_key` reach this file in
//     the projection and are never drawn: they are platform identifiers, and a guest's
//     document shows only words a host wrote. An unlabelled role therefore renders as the
//     name alone, which is what the host was left with when they wrote it.
//
// Design intent (§Q): a digital patrika. Warm paper, a ceremonial double rule in gold
// over maroon, generous type that an elder can read on a phone, one column that fits
// 360px, and no motion in the document itself — measured on a guest page: 0 animations
// and no transition class on the article. The only moving thing in the route is the
// line that reads "Loading…" before the article exists, and the stylesheet's global
// `prefers-reduced-motion` block flattens that one to 0.01ms.

import type { PublicInvitation, InvitationEvent, InvitationPerson } from '@/lib/publicInvitation';

const FONT_NAME = /^[A-Za-z ]{1,40}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** `2026-11-14T07:30:00`, as `private.build_invitation_snapshot` writes it. The seconds
 *  are read and dropped rather than trusted. */
const LOCAL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?$/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "14 November 2026" from the snapshot's own digits. */
const formatDate = (stamp: string): string | null => {
  const parts = LOCAL_TIMESTAMP.exec(stamp);
  if (!parts) return null;
  const [, year, month, day] = parts;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;
  return `${Number(day)} ${monthName} ${year}`;
};

/** "7:30 AM". A muhurtham is written in the morning, and a guest should not have to
 *  work out whether 07:15 is before or after breakfast. */
const formatTime = (stamp: string): string | null => {
  const parts = LOCAL_TIMESTAMP.exec(stamp);
  if (!parts) return null;
  const hour = Number(parts[4]);
  const minute = parts[5];
  if (hour > 23) return null;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute} ${suffix}`;
};

/**
 * The lead size, in px, kept inside a range the paper can carry. The editor offers 8 to
 * 120 and the projection admits any one-to-three-digit number, so a saved value from
 * another build can say 3; a document nobody can read is not the host's design, it is
 * our failure to render it. The clamp is a floor and a ceiling on the *title*, and body
 * text is set in `em` below it, so the whole patrika scales together.
 *
 * A host who freezes a draft straight from the planning page never opens the editor, so
 * `style_settings` is still the database default `{}` and no size was ever chosen. That
 * is not a size of zero: drawing the document at the page's own 16px body text — which is
 * what an absent size used to mean — is a patrika an elder cannot read on a phone, and
 * the reason the default is stated here rather than left to the cascade.
 */
const DEFAULT_LEAD = 26;

const leadSize = (fontSize: string | null): number => {
  if (fontSize === null) return DEFAULT_LEAD;
  const parsed = Number(fontSize);
  if (!Number.isFinite(parsed)) return DEFAULT_LEAD;
  return Math.min(44, Math.max(22, parsed));
};

/** The host's colour, if it is a colour. Anything else is not applied. */
const safeColor = (color: string | null): string | null =>
  color !== null && HEX_COLOR.test(color) ? color : null;

const safeFont = (font: string | null): string | undefined => {
  if (font === null || !FONT_NAME.test(font)) return undefined;
  // The script-safe stacks already carry a Noto face per supported script, so the
  // chosen family leads and the document's own stack catches any glyph it lacks.
  return `"${font}", var(--font-display)`;
};

/** Text a host wrote, or nothing at all. A stored value that is empty or only spaces says
 *  nothing, and printing it as a bare separator would be our mark on their document. */
const hostText = (value: string | null): string | null =>
  value !== null && value.trim() !== '' ? value : null;

const PersonLine = ({ person }: { person: InvitationPerson }) => {
  const name = hostText(person.displayName);
  if (name === null) return null;
  // `role_key` is never printed. It is a machine identifier, and this is a document a
  // family may read aloud, so a person whose role has no word written for them is shown
  // by name alone rather than by a key they were never asked for.
  const role = hostText(person.roleLabel);
  return (
    <li className="text-[0.95em] leading-relaxed">
      {role !== null && role !== name ? (
        <>
          <span className="text-ink-muted">{role}</span>{' · '}
        </>
      ) : null}
      {name}
    </li>
  );
};

/** An event that froze with nothing on it is not a ceremony the guest can attend; an
 *  empty ruled box would be decoration standing in for information. Both the block and
 *  the list that holds them ask this one question. The machine key is not content — a
 *  row whose only populated field is `event_key` has said nothing to a guest. */
const hasEventContent = (event: InvitationEvent): boolean =>
  hostText(event.displayName) !== null ||
  event.startsAtLocal !== null ||
  event.endsAtLocal !== null ||
  event.venue !== null;

const EventBlock = ({ event }: { event: InvitationEvent }) => {
  const day = event.startsAtLocal !== null ? formatDate(event.startsAtLocal) : null;
  const from = event.startsAtLocal !== null ? formatTime(event.startsAtLocal) : null;
  const to = event.endsAtLocal !== null ? formatTime(event.endsAtLocal) : null;
  const hours = from !== null ? `${from}${to !== null ? ` – ${to}` : ''}` : null;
  const venue = event.venue;
  const title = hostText(event.displayName);
  const addressLines = venue?.addressText?.split('\n').filter((line) => line.trim() !== '') ?? [];

  if (!hasEventContent(event)) return null;

  return (
    <section className="border-t border-gold/40 pt-3" aria-label={title ?? 'Ceremony'}>
      {title !== null ? <h3 className="font-display text-[1.05em] font-semibold">{title}</h3> : null}
      <div className="mt-1 space-y-0.5 text-[0.95em]">
        {day !== null ? (
          <p>
            <time dateTime={event.startsAtLocal ?? undefined}>{day}</time>
            {hours !== null ? <span> · {hours}</span> : null}
          </p>
        ) : hours !== null ? <p>{hours}</p> : null}
        {event.timezone !== null ? (
          <p className="text-[0.85em] text-ink-muted">{event.timezone}</p>
        ) : null}
        {venue?.name ? <p className="font-medium">{venue.name}</p> : null}
        {addressLines.map((line, index) => (
          <p key={index} className="text-ink-muted">{line}</p>
        ))}
        {venue?.mapUrl ? (
          <p className="pt-1">
            <a
              href={venue.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-md border border-ceremonial px-3 py-1.5 text-[0.9em] font-medium underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              Open the venue map
            </a>
          </p>
        ) : null}
      </div>
    </section>
  );
};

export interface InvitationRendererProps {
  invitation: PublicInvitation;
}

const PROSE = 'whitespace-pre-line break-words';

const Paragraph = ({ children }: { children: string }) => (
  <p className={`${PROSE} text-[1em] leading-relaxed`}>{children}</p>
);

/**
 * The whole invitation, as one article. `lang` is set from the language the host chose
 * so a screen reader pronounces the words in that language and a browser can hyphenate
 * and translate sensibly; a missing language leaves the document inheriting the page's.
 */
export const InvitationRenderer = ({ invitation }: InvitationRendererProps) => {
  const size = leadSize(invitation.style.fontSize);
  const color = safeColor(invitation.style.color);
  const fontFamily = safeFont(invitation.style.font);
  const textAlign = invitation.style.alignment ?? 'center';

  // A group's identity: the platform key when a row carries one, otherwise the host's own
  // label. The heading printed below is only ever the label — `group_key` keeps rows of one
  // group together, it is not a word to set over a family's names.
  const groupedPeople = invitation.people.reduce<Record<string, InvitationPerson[]>>((groups, person) => {
    const key = hostText(person.groupKey) ?? hostText(person.groupLabel) ?? '';
    const bucket = groups[key];
    if (bucket) bucket.push(person);
    else groups[key] = [person];
    return groups;
  }, {});
  const groups = Object.entries(groupedPeople);

  // Index in the key, not the name: two people can be called the same thing, and a
  // list keyed by a display name would silently merge or reorder them.
  const events = invitation.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => hasEventContent(event));

  return (
    <article
      lang={invitation.language.primary ?? undefined}
      aria-label={`${invitation.title} — wedding invitation`}
      // `break-words` here reaches the title, the names and the address lines by
      // inheritance — `overflow-wrap` is an inherited property, and host text carries no
      // break point of its own. Measured, not assumed: a 400-character unbroken title
      // pushed a 360px-wide guest page to 2786px of horizontal scroll until it was set.
      className="mx-auto w-full max-w-[34rem] break-words rounded-xl border border-gold/60 bg-paper px-5 py-8 shadow-[0_1px_0_rgba(0,0,0,0.04)] sm:px-8 sm:py-10"
      style={{
        color: color ?? 'var(--ink)',
        fontFamily,
        fontSize: `${size}px`,
        textAlign,
      }}
    >
      {/* Ceremonial rules. Two lines and a diamond, drawn with borders and a rotated
          square — no image, no font asset, no network. */}
      <div className="pb-6" aria-hidden="true">
        <div className="h-px w-full bg-gold/70" />
        <div className="mx-auto mt-1 h-1.5 w-16 rounded-full bg-ceremonial/70" />
      </div>

      <header className="space-y-3">
        <h1 className="font-display text-[1.6em] font-semibold leading-tight">{invitation.title}</h1>
        {invitation.welcome !== null ? <Paragraph>{invitation.welcome}</Paragraph> : null}
        {invitation.familyIntroduction !== null ? (
          <Paragraph>{invitation.familyIntroduction}</Paragraph>
        ) : null}
      </header>

      {groups.length > 0 ? (
        <section className="pt-7" aria-label="Family and blessings">
          {groups.map(([bucket, members]) => {
            const heading = members.reduce<string | null>(
              (found, person) => found ?? hostText(person.groupLabel),
              null,
            );
            return (
              <div key={bucket || 'unlabelled'} className="pb-4">
                {heading !== null ? (
                  <h2 className="font-display text-[1.05em] font-medium text-ink-muted">{heading}</h2>
                ) : null}
                <ul className="mt-1 space-y-1">
                  {members.map((person, index) => (
                    <PersonLine key={`${person.displayName ?? 'person'}-${index}`} person={person} />
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="pt-4" aria-label="Ceremonies">
          {/* "The ceremonies" is our word, not a fact about the wedding. Every event the
              snapshot froze is listed under this one label; a heading that named the rite
              or counted them would be an interpretation of someone's invitation. */}
          <h2 className="font-display text-[1.2em] font-semibold">The ceremonies</h2>
          <div className="mt-3 space-y-4">
            {events.map(({ event, index }) => (
              <EventBlock key={`${event.eventKey ?? 'event'}-${index}`} event={event} />
            ))}
          </div>
          {invitation.eventNotes !== null ? (
            <div className="border-t border-gold/40 pt-3">
              <Paragraph>{invitation.eventNotes}</Paragraph>
            </div>
          ) : null}
        </section>
      ) : invitation.eventNotes !== null ? (
        <section className="pt-7" aria-label="Note from the family">
          <Paragraph>{invitation.eventNotes}</Paragraph>
        </section>
      ) : null}

      {invitation.closing !== null ? (
        <footer className="pt-7">
          <Paragraph>{invitation.closing}</Paragraph>
        </footer>
      ) : null}

      <div className="pt-8" aria-hidden="true">
        <div className="mx-auto h-2 w-2 rotate-45 border border-gold/70 bg-ceremonial/20" />
        <div className="mt-1 h-px w-full bg-gold/70" />
      </div>
    </article>
  );
};

export default InvitationRenderer;
