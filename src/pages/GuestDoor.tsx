// The household's page: `/g/<credential>`, with no account anywhere in it.
//
// This is the third door of the same kind — Stage 3's wedding link (`PublicInvitation.tsx`) and Stage 7's
// reviewer link (`FamilyReview.tsx`) are the other two — and it keeps their rules deliberately:
//
//   * One read, one function, one header. `resolveGuestInvitation` is the app's only caller of
//     `api.resolve_guest_invitation`, the credential travels in `x-guest-token`, and the route parameter
//     is this page's own address: nothing here echoes it into a request URL, a query string, a log line or
//     the tab title. `scripts/check-product-contract.mjs` fails the build if the argument form is ever
//     written, and `src/test/guestDoorTransport.test.ts` measures the same property on the shipped code.
//   * The invitation is drawn through the guest's own renderer and the guest's own parser, so a family is
//     shown the document the couple published rather than a better or worse copy of it
//     (`docs/architecture/guest-rsvp-security.md`, Ruling 5.1). Everything specific to this household —
//     its greeting, its events, its own answers — is an overlay above and below that document, never a
//     rewrite of it.
//   * Every failure at the door is the same sentence. A mistyped link, a link the host withdrew, an
//     expiry that passed, a revoked publication and a string that is not a credential all read
//     identically, because the database answers them identically (`…sql:1229`).
//
// What this page may offer is bounded by what the door actually accepts:
//
//   * The greeting is host-authored free text, so it is rendered as text. A family name containing `<`
//     appears as `<`, and the markup-sink rule already refuses anything that would write it as HTML.
//   * Only the events this household was paired with appear, because the read answers with exactly its
//     own scoped rows (`…sql:650-669`). No event list, no guest list and no other household's reply is
//     reachable from any value printed here — and the household itself is never an argument, since the
//     write door derives it from the credential (`…sql:847-857`).
//   * A card the guest leaves untouched is not sent: the door upserts the events a submission names
//     (`…sql:910-922`), so an unanswered event keeps whatever the family said last.
//   * Unlike Stage 7's reviewer, a household is *not* exactly-once. A live credential answers a question
//     that stays open, so a second submission overwrites this household's own rows and the form stays
//     editable after a recorded answer (design §7). A page that vanished the form would tell a family who
//     mis-tapped that their correction could not be made.
//   * The party-size field is checked locally against the door's own shape rules (`…sql:822`,
//     `:826-827`) so a guest is not the person who discovers a database CHECK. The *cap* is not checked
//     here: `expected_party_size` is the host's expectation and the door is the authority on it, so the
//     page states it as guidance and leaves `party_size_too_large` to answer.
//   * `can_respond` is "this household has at least one event to answer" (`…sql:692`). When it is false
//     the invitation is still readable and there is simply no form — the page offers nothing that it
//     knows the door would refuse.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import InvitationRenderer from '@/components/invitation/InvitationRenderer';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  resolveGuestInvitation,
  submitGuestRsvp,
  GUEST_DOOR_UNAVAILABLE,
  GUEST_ANSWER_NOT_RECORDED,
  type GuestAttendance,
  type GuestRsvpCard,
} from '@/integrations/supabase/guestDoor';
import { ATTENDANCE_LABELS, type GuestDoorDocument, type GuestEventCard, type GuestRsvpReceipt } from '@/lib/guestInvitation';
import { formatDate, formatTime } from '@/lib/wallClock';
import { formatInstant } from '@/lib/instantText';

/** The upper bound the door's CHECK admits (`…sql:826`). It is a bound on the *column*, not the
 *  family's invitation, so hitting it is a page problem rather than a wedding problem. */
const PARTY_SIZE_MAX = 1000;

/** The door refuses a `party_size` that is not a run of digits (`…sql:822`) — a decimal reaches an
 *  integer cast and answers with a `22P02` naming the offending text. Digits, then a whole number,
 *  then the range, in that order, so the guest is told which of the three they missed. */
const PARTY_SIZE_DIGITS = /^[0-9]+$/;

type Phase =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; guest: GuestDoorDocument };

/** One card as the family is leaving it. The headcount stays text while it is being typed: a field that
 *  parses to a number on every keystroke is a field that erases the guest's own mistake before they can
 *  see it. */
interface CardDraft {
  attending: GuestAttendance | null;
  partySize: string;
}

/** A card's answer word, if this build knows it. An unfamiliar word is the family's own recorded answer
 *  and is shown as text rather than mapped onto a radio button, because silently choosing "attending"
 *  for a word this page has not read would put words in the guest's mouth. */
const knownAnswer = (value: string | null): GuestAttendance | null =>
  value !== null && (ATTENDANCE_LABELS as readonly string[]).includes(value)
    ? (value as GuestAttendance)
    : null;

const initialDraft = (event: GuestEventCard): CardDraft => ({
  attending: knownAnswer(event.attending),
  partySize:
    event.attending === 'attending' && event.partySize !== null ? String(event.partySize) : '',
});

/** The one problem with this card's headcount, or `null`. Returns the sentence rather than a boolean so
 *  two different mistakes cannot be described by the same message. */
const partySizeProblem = (draft: CardDraft): string | null => {
  if (draft.attending !== 'attending') return null;
  const text = draft.partySize.trim();
  if (text === '') return 'Tell the family how many of you are coming.';
  if (!PARTY_SIZE_DIGITS.test(text)) return 'Enter a whole number of guests, like 3.';
  const size = Number(text);
  if (!Number.isSafeInteger(size)) return 'Enter a whole number of guests, like 3.';
  if (size < 1) return 'Choose “Not coming” if nobody from your household is attending.';
  if (size > PARTY_SIZE_MAX) {
    return 'That is more guests than one reply can hold. Ask the family to write you in directly.';
  }
  return null;
};

const Unavailable = () => (
  <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-16 text-center">
    <BrandLockup variant="compact" className="mb-8" />
    <h1 className="font-display text-2xl font-semibold text-ink">{GUEST_DOOR_UNAVAILABLE}</h1>
    <p className="mt-3 text-ink-muted">
      The family may have withdrawn the link, it may have run out of time, or a character may have been
      missed when it was typed. Only the family can send a working invitation link.
    </p>
    <p className="mt-6 text-sm text-ink-muted">
      No account is needed to read a wedding invitation. Nothing was signed in, and no account was
      created, to show you this page.
    </p>
  </main>
);

/** The event's own day and times, printed the way the invitation above prints them — the snapshot's
 *  digits, no offset, no reader's timezone (`src/lib/wallClock.ts` explains why a muhurtham must not be
 *  moved across a zone). A card that has none of them still has its name, and a name alone is an
 *  answerable event. */
const EventWhen = ({ event }: { event: GuestEventCard }) => {
  const day = formatDate(event.startsAtLocal);
  const from = formatTime(event.startsAtLocal);
  const to = event.endsAtLocal !== null ? formatTime(event.endsAtLocal) : null;
  const hours = from !== null ? `${from}${to !== null ? ` – ${to}` : ''}` : null;
  return (
    <>
      {day !== null ? (
        <span className="block text-sm text-ink-muted">
          <time dateTime={event.startsAtLocal}>{day}</time>
          {hours !== null ? <span> · {hours}</span> : null}
        </span>
      ) : null}
      <span className="block text-xs text-ink-muted">{event.timezone}</span>
    </>
  );
};

/** What the household's own last answer looked like, in the database's words. `responded_at` is their
 *  fact, not the family's, so it is shown to them and to nobody else (`…sql:650-659`). */
const PreviousAnswer = ({ event }: { event: GuestEventCard }) => {
  if (event.attending === null) return null;
  const answered = formatInstant(event.respondedAt);
  const known = knownAnswer(event.attending);
  if (known === null) {
    return (
      <p className="mt-1 text-xs text-ink-muted">
        Your last reply was recorded as “{event.attending}”, a word this page cannot read. Choosing an
        answer below replaces it.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-ink-muted">
      {known === 'attending'
        ? `You last said ${event.partySize ?? 0} of you are coming`
        : 'You last said you are not coming'}
      {answered !== null ? `, on ${answered}` : ''}.
    </p>
  );
};

/** The cap is the door's rule, not this page's, so the hint names the number without claiming to
 *  enforce it: a larger answer is the family's decision to make, and the door's own
 *  `party_size_too_large` sentence is what tells a guest they reached it. */
const GuestEventCardForm = ({
  event,
  index,
  draft,
  problem,
  expected,
  onChange,
}: {
  event: GuestEventCard;
  index: number;
  draft: CardDraft;
  problem: string | null;
  expected: number | null;
  onChange: (next: CardDraft) => void;
}) => {
  const sizeId = `guest-party-size-${index}`;
  const hintId = `${sizeId}-hint`;
  const errorId = `${sizeId}-problem`;
  return (
    <fieldset className="space-y-3 rounded-lg border border-gold/50 px-3 py-3">
      <legend className="px-1 font-display text-base font-semibold text-ink">{event.displayName}</legend>
      <EventWhen event={event} />
      <PreviousAnswer event={event} />

      <div className="space-y-2">
        {(['attending', 'declined'] as const).map((value) => (
          <label
            key={value}
            className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-lg border border-gold/50 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="radio"
              name={`guest-attending-${index}`}
              value={value}
              checked={draft.attending === value}
              onChange={() => {
                // A family switching to "not coming" has no headcount to give, and leaving their old
                // number in the field would let it be sent for a different answer.
                onChange({ attending: value, partySize: value === 'attending' ? draft.partySize : '' });
              }}
              className="h-4 w-4 shrink-0 accent-ceremonial"
            />
            {value === 'attending' ? 'We are coming' : 'Not coming'}
          </label>
        ))}
      </div>

      {draft.attending === 'attending' ? (
        <div className="space-y-1">
          <Label htmlFor={sizeId} className="text-sm">
            How many of you, including you?
          </Label>
          <Input
            id={sizeId}
            type="number"
            min={1}
            max={PARTY_SIZE_MAX}
            step={1}
            inputMode="numeric"
            value={draft.partySize}
            onChange={(event_) => onChange({ ...draft, partySize: event_.target.value })}
            aria-describedby={problem === null ? hintId : `${hintId} ${errorId}`}
            aria-invalid={problem === null ? undefined : true}
            className="h-11"
          />
          <p id={hintId} className="text-xs text-ink-muted">
            Count everyone coming from this invitation, including you.
            {expected !== null ? ` The family expects ${expected}.` : ''}
          </p>
          {problem !== null ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
};

/** The door's own receipt (`…sql:930-935`): how many of this household's events the submission wrote,
 *  and when. It is deliberately the database's count rather than the page's, because a guest who sent
 *  three answers and is told "saved" for two has been told something the family will not agree with. */
const Recorded = ({ receipt }: { receipt: GuestRsvpReceipt }) => {
  const box = useRef<HTMLDivElement>(null);
  // Focus moves here on every recorded answer, including a correction of a previous one: the button the
  // guest pressed is still on screen, and a screen reader that stayed there would hear "Send my reply"
  // rather than the confirmation that their reply landed.
  useEffect(() => {
    box.current?.focus();
  }, [receipt.respondedAt, receipt.eventsRecorded]);
  const when = formatInstant(receipt.respondedAt);
  return (
    <div
      ref={box}
      tabIndex={-1}
      className="mx-auto mt-8 max-w-[34rem] rounded-xl border border-gold/60 bg-paper p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h2 className="font-display text-lg font-semibold text-ink">Your reply is recorded</h2>
      <p role="status" className="mt-2 text-sm text-ink">
        {receipt.eventsRecorded === 1
          ? 'Your answer is saved for one event.'
          : `Your answer is saved for ${receipt.eventsRecorded} events.`}
      </p>
      {when !== null ? <p className="mt-1 text-xs text-ink-muted">Recorded {when}.</p> : null}
      <p className="mt-3 text-xs text-ink-muted">
        You can change your reply below as often as you need to — the family sees your latest answer, not a
        list of the ones before it. This link is only your household’s own, and it was never a sign-in to
        anything.
      </p>
    </div>
  );
};

const GuestRsvpForm = ({
  token,
  guest,
  onRecorded,
}: {
  token: string;
  guest: GuestDoorDocument;
  onRecorded: (receipt: GuestRsvpReceipt) => void;
}) => {
  const [drafts, setDrafts] = useState<CardDraft[]>(() => guest.events.map(initialDraft));
  const [problems, setProblems] = useState<Record<number, string | null>>({});
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const answeredCount = drafts.filter((draft) => draft.attending !== null).length;

  const send = async () => {
    if (sending) return;
    setRefusal(null);
    const found: Record<number, string | null> = {};
    drafts.forEach((draft, index) => {
      found[index] = partySizeProblem(draft);
    });
    setProblems(found);
    if (Object.values(found).some((message) => message !== null)) {
      // The door is not called: an answer this page can already see is wrong is corrected here, and a
      // submission that reached it would have refused the whole set for one field.
      return;
    }
    const cards: GuestRsvpCard[] = drafts.flatMap((draft, index) => {
      if (draft.attending === null) return [];
      // A declined household sends 0 rather than being asked to invent a headcount. The door requires
      // a number on every card (`…sql:815-818`), and 0 is the arithmetic answer, not a default.
      return [{
        eventId: guest.events[index].eventId,
        attending: draft.attending,
        partySize: draft.attending === 'attending' ? Number(draft.partySize.trim()) : 0,
      }];
    });
    setSending(true);
    const result = await submitGuestRsvp(token, cards);
    if (result.data === null) {
      setSending(false);
      setRefusal(result.error ?? GUEST_DOOR_UNAVAILABLE);
      return;
    }
    setSending(false);
    if (result.data.kind === 'refused') {
      // The adapter turns a door refusal into `data: null` with its own guest-facing copy
      // (`src/integrations/supabase/guestDoor.ts:151-155`), which `src/test/guestDoorTransport.test.ts:281`
      // pins, so this arm does not reach the page in practice. It is still narrowed rather than assumed
      // away: the outcome type says an answer may not have been written, and showing the receipt block
      // for an answer the union calls refused is the exact failure this stage's receipt model exists to
      // prevent — the confirmation would be a lie the guest has no way to check.
      setRefusal(GUEST_ANSWER_NOT_RECORDED);
      return;
    }
    onRecorded(result.data.receipt);
  };

  return (
    <form
      // The field declares its own bound (`min`/`max`/`step` below, so a phone offers a keypad and a
      // screen reader can read the range) but the form does not let the browser enforce it: a control
      // that fails constraint validation stops the `submit` event from ever reaching this handler, so
      // the guest's 0, 1.5 or 1001 would be answered by a silent button rather than by the sentence
      // wired to `aria-describedby` and `role=alert`. Measured, not assumed: with validation left on,
      // `src/test/guestDoorPage.test.tsx` never entered `send()` for those three values at all.
      noValidate
      className="mx-auto mt-8 max-w-[34rem] space-y-5 rounded-xl border border-gold/60 bg-paper p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 className="font-display text-lg font-semibold text-ink">Will you be there?</h2>
      <p className="text-sm text-ink-muted">
        Answer the events you were invited to. Anything you leave untouched stays exactly as your
        household last said it.
      </p>

      {guest.events.map((event, index) => (
        <GuestEventCardForm
          key={event.eventId}
          event={event}
          index={index}
          draft={drafts[index]}
          problem={problems[index] ?? null}
          expected={guest.expectedPartySize}
          onChange={(next) => {
            setDrafts((current) => current.map((draft, i) => (i === index ? next : draft)));
            setProblems((current) => ({ ...current, [index]: null }));
            setRefusal(null);
          }}
        />
      ))}

      <p aria-live="polite" className="text-sm text-ink-muted">
        {refusal !== null
          ? refusal
          : answeredCount === 0
            ? 'Choose an answer on at least one event to send it.'
            : ''}
      </p>

      <Button
        type="submit"
        className="h-11 w-full rounded-lg"
        disabled={sending || answeredCount === 0}
      >
        {sending ? 'Sending…' : 'Send my reply'}
      </Button>
    </form>
  );
};

const GuestDoorPage = () => {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [receipt, setReceipt] = useState<GuestRsvpReceipt | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase({ kind: 'unavailable' });
      return;
    }
    let active = true;
    resolveGuestInvitation(token).then((result) => {
      if (!active) return;
      setPhase(result.data ? { kind: 'ready', guest: result.data } : { kind: 'unavailable' });
    });
    return () => {
      active = false;
    };
  }, [token]);

  // The tab is what a guest with three wedding links open is scanning. Plain text, no credential.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const previous = document.title;
    document.title = `${phase.guest.invitation.title} — your invitation`;
    return () => {
      document.title = previous;
    };
  }, [phase]);

  if (phase.kind === 'loading') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
        <p role="status" className="animate-pulse text-ink-muted">
          Opening your invitation…
        </p>
      </main>
    );
  }

  if (phase.kind === 'unavailable') return <Unavailable />;
  if (token === undefined) return <Unavailable />;

  const { guest } = phase;
  const deadline = formatInstant(guest.respondsUntil);

  return (
    <main className="min-h-dvh bg-surface px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-[34rem]">
        <BrandLockup variant="compact" className="mb-6" />
        {/* A salutation addressed to a household, so it is text rather than a heading: the invitation
            below carries this page's one level-1 heading, and giving the framing a second would leave a
            guest navigating by headings with no way to tell which one is the document. */}
        <p className="font-display text-xl font-semibold text-ink">{guest.greeting}</p>
        <p className="mt-2 text-sm text-ink-muted">
          This invitation was sent to your household by name. The document below is the one the family
          published — the same words their other guests will read.
          {deadline !== null ? ` You can reply until ${deadline}.` : ''}
        </p>
      </div>

      <div className="mt-8">
        <InvitationRenderer invitation={guest.invitation} />
      </div>

      {guest.canRespond ? (
        <>
          {receipt !== null ? <Recorded receipt={receipt} /> : null}
          <GuestRsvpForm token={token} guest={guest} onRecorded={setReceipt} />
        </>
      ) : (
        <p className="mx-auto mt-8 max-w-[34rem] text-sm text-ink-muted">
          There is no event on this invitation for your household to answer yet. The invitation above is
          still yours to read, and nothing has gone wrong with your link.
        </p>
      )}

      <p className="mx-auto mt-6 max-w-[34rem] text-center text-xs text-ink-muted">
        No account or app is needed to read this invitation, and only your household can see the replies
        you send.
      </p>
    </main>
  );
};

export default GuestDoorPage;
