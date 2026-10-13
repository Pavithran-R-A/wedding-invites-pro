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
// What it draws is a list, not a template. `normalizeInvitationSections` hands this file the
// ordered sections to render — a release's own list for a document that froze one, or Stage
// 3's neutral ordering expressed as that same list for a document that froze none — and the
// only decisions made here are which of three kinds a section is (`kind`, which says what to
// draw) and which part of the paper it sits on (`region`, which says how much air it gets).
// There is no branch for "has a pack", none for a language, and none that looks at who the
// wedding is; see the normalizer's header for why that is the whole of §13.
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
import type { RenderRegion, RenderSection, RenderSectionKind } from '@/lib/invitationSections';
import type { RenderSurface } from '@/lib/renderSurfaces';
import { normalizeInvitationSections } from '@/lib/invitationSections';
import { formatDate, formatTime } from '@/lib/wallClock';

const FONT_NAME = /^[A-Za-z ]{1,40}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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

const EventBlock = ({ event, stamp }: { event: InvitationEvent; stamp?: EventStamp }) => {
  const day = event.startsAtLocal !== null ? formatDate(event.startsAtLocal) : null;
  const from = event.startsAtLocal !== null ? formatTime(event.startsAtLocal) : null;
  const to = event.endsAtLocal !== null ? formatTime(event.endsAtLocal) : null;
  const hours = from !== null ? `${from}${to !== null ? ` – ${to}` : ''}` : null;
  const venue = event.venue;
  const title = hostText(event.displayName);
  const addressLines = venue?.addressText?.split('\n').filter((line) => line.trim() !== '') ?? [];

  if (!hasEventContent(event)) return null;

  return (
    <section className="border-t border-gold/40 pt-3" aria-label={title ?? 'Ceremony'} {...stamp}>
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
              className="inline-block rounded-md border border-ceremonial px-3 py-1.5 text-[0.9em] font-medium underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
  /**
   * Which export canvas this document is being drawn for. Absent means "a person is reading it":
   * a guest's page, the host's preview and a family reviewer's view all leave this unset, and this
   * file then writes **no `data-render-*` attribute at all** (asserted in
   * `src/test/invitationRenderSurfaces.test.tsx`).
   *
   * The value is only a hook. It selects nothing, drops nothing and sizes nothing — it stamps the
   * article so `src/render/render.css`, a stylesheet that exists only in the harness document, can
   * address the same JSX at three different boxes. A live browser never loads that file, which is
   * the whole reason the design allows one renderer and three artefacts (§6.1).
   */
  surface?: RenderSurface;
}

/** What a render surface's stylesheet needs in order to address a drawn section without naming
 *  where in the DOM it happened to land: a structural selector like `article > section:nth-of-type(2)`
 *  changes meaning the moment a release reorders its own section list, and an artefact that quietly
 *  drops a different line than last week is the failure this table prevents.
 *
 *  Both values come from the frozen document's own vocabulary (`kind` and `region`), so this adds no
 *  fact — it re-states, as an attribute, one the renderer already used to choose a component. */
type SurfaceStamp = {
  'data-render-kind': RenderSectionKind;
  'data-render-region': RenderRegion;
};

/** Where a drawn event sits among the events this document draws, 1-based. A teaser shows the first
 *  ceremony and no other, and "first" has to mean *first drawn* — an event with nothing on it is not
 *  on the page, so a positional guess from the snapshot's array would drop the wrong one. */
type EventStamp = {
  'data-render-event-position': number;
};

/** The stamp, or nothing: no surface means no attributes, which is what keeps a guest's DOM the
 *  document Stage 3 certified. */
const stampFor = (section: RenderSection, surface: RenderSurface | undefined): SurfaceStamp | undefined =>
  surface === undefined
    ? undefined
    : { 'data-render-kind': section.kind, 'data-render-region': section.region };

const PROSE = 'whitespace-pre-line break-words';

const Paragraph = ({ children, stamp }: { children: string; stamp?: SurfaceStamp }) => (
  <p className={`${PROSE} text-[1em] leading-relaxed`} {...stamp}>{children}</p>
);

/** A section's heading: the release's label for that slot, or the platform's own neutral word
 *  for a document drawn with no pack. Nothing here decides which tradition a heading
 *  belongs to — the string arrived in the frozen document. */
const SectionHeading = ({ children, stamp }: { children: string; stamp?: SurfaceStamp }) => (
  <h2 className="font-display text-[1.2em] font-semibold" {...stamp}>{children}</h2>
);

/**
 * Whether a section has anything a guest could read, and so whether opening its wrapper is
 * worth it. This is the one place that answer is computed: the components below assume it,
 * and a prose block that says nothing is dropped before it can leave an empty ruled box
 * standing in for information.
 */
const sectionDrawsSomething = (section: RenderSection, invitation: PublicInvitation): boolean => {
  switch (section.kind) {
    case 'text':
      return section.heading !== null || section.content !== null;
    case 'people_list':
      return invitation.people.length > 0;
    case 'event_list':
      return invitation.events.some(hasEventContent);
  }
};

/** The people this document froze, in the groups their own rows name. A group's identity is
 *  the platform key when a row carries one, otherwise the host's label; the heading printed
 *  over it is only ever the label, because `group_key` keeps rows of one group together and
 *  is not a word to set over a family's names. */
const RosterSection = ({
  section,
  invitation,
  stamp,
}: {
  section: RenderSection;
  invitation: PublicInvitation;
  stamp?: SurfaceStamp;
}) => {
  const groupedPeople = invitation.people.reduce<Record<string, InvitationPerson[]>>((groups, person) => {
    const key = hostText(person.groupKey) ?? hostText(person.groupLabel) ?? '';
    const bucket = groups[key];
    if (bucket) bucket.push(person);
    else groups[key] = [person];
    return groups;
  }, {});
  const groups = Object.entries(groupedPeople);

  return (
    <section className="pt-7" aria-label={section.heading ?? 'Family and blessings'} {...stamp}>
      {section.heading !== null ? <SectionHeading>{section.heading}</SectionHeading> : null}
      {groups.map(([bucket, members]) => {
        const label = members.reduce<string | null>(
          (found, person) => found ?? hostText(person.groupLabel),
          null,
        );
        return (
          <div key={bucket || 'unlabelled'} className="pb-4">
            {label !== null ? (
              <h2 className="font-display text-[1.05em] font-medium text-ink-muted">{label}</h2>
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
  );
};

/** Every ceremony the snapshot froze, listed under the one heading the section carries. The
 *  heading is a slot label, not an interpretation of the rites: a name for what a wedding's
 *  events *are* would be a claim about someone's tradition, and this file makes none. */
const CeremonySection = ({
  section,
  invitation,
  stamp,
}: {
  section: RenderSection;
  invitation: PublicInvitation;
  stamp?: SurfaceStamp;
}) => {
  // Index in the key, not the name: two events can be called the same thing, and a list
  // keyed by a display name would silently merge or reorder them.
  const events = invitation.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => hasEventContent(event));

  return (
    <section className="pt-4" aria-label={section.heading ?? 'Ceremonies'} {...stamp}>
      {section.heading !== null ? <SectionHeading>{section.heading}</SectionHeading> : null}
      <div className="mt-3 space-y-4">
        {events.map(({ event, index }, drawnPosition) => (
          <EventBlock
            key={`${event.eventKey ?? 'event'}-${index}`}
            event={event}
            stamp={
              stamp === undefined
                ? undefined
                : { 'data-render-event-position': drawnPosition + 1 }
            }
          />
        ))}
      </div>
    </section>
  );
};

/** One section, drawn. `kind` decides what is put on the page and the section's own `region`
 *  decides how much air it gets: an `opening` section is a child of the header, whose
 * `space-y-3` already sets the rhythm, and a `closing` section is a child of the footer. */
const SectionBlock = ({
  section,
  invitation,
  surface,
}: {
  section: RenderSection;
  invitation: PublicInvitation;
  surface?: RenderSurface;
}) => {
  const bare = section.region !== 'body';
  const stamp = stampFor(section, surface);
  switch (section.kind) {
    case 'text': {
      // A section in the header or the footer has no wrapper of its own — `header.space-y-3`
      // already spaces its children, so opening a `div` here would move the air between a heading
      // and its body on a guest's page. The stamp therefore lands on the two elements this section
      // actually draws, and a body-section wrapper carries it instead. Either way it is exactly one
      // addressable element per drawn line, and nothing about the layout is a render artifact.
      const content = (
        <>
          {section.heading !== null ? (
            <SectionHeading stamp={bare ? stamp : undefined}>{section.heading}</SectionHeading>
          ) : null}
          {section.content !== null ? (
            <Paragraph stamp={bare ? stamp : undefined}>{section.content}</Paragraph>
          ) : null}
        </>
      );
      return bare ? content : <div className="pt-7" {...stamp}>{content}</div>;
    }
    case 'people_list':
      return <RosterSection section={section} invitation={invitation} stamp={stamp} />;
    case 'event_list':
      return <CeremonySection section={section} invitation={invitation} stamp={stamp} />;
  }
};

/**
 * The whole invitation, as one article. `lang` is set from the language the host chose
 * so a screen reader pronounces the words in that language and a browser can hyphenate
 * and translate sensibly; a missing language leaves the document inheriting the page's.
 *
 * What the article draws is `normalizeInvitationSections(...)` — one ordered list, whether
 * the document arrived with a release's sections or as a Stage 3 page that had none. There is
 * no branch here for "a wedding with a pack" versus "a wedding without one", and none for a
 * language, a pack key, a religion, a community or a name: the only decisions are which of
 * three kinds each section is and which region of the paper it sits on (§13). A section this
 * build cannot place is already gone from the list, named in the normalizer's issues for the
 * host's preview to show rather than drawn as a blank card to a guest.
 *
 * Provenance is deliberately not drawn. `RenderSection` carries who supplied its wording so
 * the host's own editor can say so; a guest's document prints no reviewer label, no release
 * number and no "edited" marker, because §12's honesty is about what the platform records,
 * not about annotating someone's invitation.
 *
 * The `surface` prop is the one exception to "no artefact knows about artefacts", and it is
 * drawn as attributes rather than as markup or classes: the same elements, the same text, the
 * same geometry, each one labelled with the decision this file already made about it. What a
 * canvas drops or reflows is decided in `src/render/render.css` against those labels, so a
 * teaser can never disagree with a guest page about what a section *is* — only about whether
 * this particular box has room to show it.
 */
export const InvitationRenderer = ({ invitation, surface }: InvitationRendererProps) => {
  const size = leadSize(invitation.style.fontSize);
  const color = safeColor(invitation.style.color);
  const fontFamily = safeFont(invitation.style.font);
  const textAlign = invitation.style.alignment ?? 'center';

  const normalized = normalizeInvitationSections(invitation);
  const drawn = normalized.sections.filter((section) => sectionDrawsSomething(section, invitation));
  const opening = drawn.filter((section) => section.region === 'opening');
  const body = drawn.filter((section) => section.region === 'body');
  const closing = drawn.filter((section) => section.region === 'closing');

  // The frozen list's own order, indexed: a section's key is a platform identifier and two
  // sections can share one heading, so neither is a React key.
  const keyFor = (section: RenderSection, index: number) => `${section.key ?? 'section'}-${index}`;

  return (
    <article
      lang={invitation.language.primary ?? undefined}
      aria-label={`${invitation.title} — wedding invitation`}
      {...(surface === undefined ? {} : { 'data-render-surface': surface })}
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
        {opening.map((section, index) => (
          <SectionBlock
            key={keyFor(section, index)}
            section={section}
            invitation={invitation}
            surface={surface}
          />
        ))}
      </header>

      {body.map((section, index) => (
        <SectionBlock
          key={keyFor(section, index)}
          section={section}
          invitation={invitation}
          surface={surface}
        />
      ))}

      {closing.length > 0 ? (
        <footer className="pt-7">
          {closing.map((section, index) => (
            <SectionBlock
              key={keyFor(section, index)}
              section={section}
              invitation={invitation}
              surface={surface}
            />
          ))}
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
