// The relative's page: `/r/<credential>`, with no account anywhere in it.
//
// This is the reviewer half of the same boundary the guest page holds (`PublicInvitation.tsx`),
// and it copies that file's rules deliberately rather than loosely:
//
//   * One read, one function. `resolveFamilyReview` is the app's only caller of
//     `api.resolve_family_review`, and the credential travels in a request header, never as an
//     argument the resolver could be handed (`src/integrations/supabase/publicReview.ts` explains
//     why that distinction is the point). The route parameter is this page's own address; it is
//     never echoed back into a request URL, a query string or a log line by anything here.
//   * It draws the guest's document through the guest's renderer and the guest's parser.
//     `InvitationRenderer` and the reader behind `FamilyReviewDocument.invitation` are shared
//     rather than mirrored, so a reviewer cannot be shown a better or worse invitation than the
//     family's guests will read. That identity is the whole premise of asking them to approve it.
//   * Every failure at the door is the same sentence. A mistyped link, a link the host withdrew,
//     an expiry that passed, a credential that already carries an answer and a string that is not
//     a credential at all all read identically, because the database answers them identically —
//     `stage7_family_approval.test.mjs` measures each of those shapes as the same
//     `{ available: false }`, and a page that ranked them would be handing out a way to find out
//     which links exist.
//
// What the form may promise is bounded by what the store actually does:
//   * Exactly-once. Writing the answer and moving the request out of `pending` are one
//     transaction, so a second submission from the same credential is refused by design (A-03).
//     A recorded answer therefore replaces the whole form: a page still offering "Send" would be
//     offering an action it knows will be refused, and a reviewer who believed the second note
//     had landed would have told the family something the database never recorded.
//   * It says what an approval is. The reviewer's label is a signature typed by them, not a
//     verified identity — nothing here checks who holds the link, so the copy says that beside
//     the field instead of leaving a relative to assume the family knows it is them.
//   * It cannot change the document. The invitation above the form is the frozen version the ask
//     names, read-only by grant shape as well as by JSX (`internal_api.submit_family_review`
//     writes `approval_feedback` and the ask's own status row, and its one read of
//     `invitation_versions` is the section test that refuses a note naming a section the frozen
//     snapshot does not contain — it assigns nothing to that table, and the Stage 2 immutability
//     triggers answer 42501 to anything else; see §5.2 of
//     `20261008120000_stage7_family_approval_review.sql`).
//
// What the form gates, and where the authority sits. The two field limits below are copied from
// the workflow's own refusals at `20261008120000_stage7_family_approval_review.sql:543-553` — a
// label of one to 120 characters, a note of at most 2000 — and the three rules that would make an
// answer meaningless (an answer was chosen, a signature was written, a request for changes carries
// a note) are marked the way every other form in this app marks them: native `required`, and a
// submit button that stays disabled until an answer and a name exist. An empty note beside an
// approval stays legal, because the workflow asks for a note only with `changes_requested` (`:554`).
// None of that is the authority. A form gate is a browser convenience a caller can bypass, so the
// workflow refuses the same three rules itself (`:528-541`, `:543-547`, `:554-560`), both
// batteries pin those refusals (`supabase/tests/stage7/80_family_review.sql:720-723`, and the HTTP
// battery at `stage7_family_approval.test.mjs:1056-1059`), and the sentence the workflow answers
// with is printed here verbatim rather than replaced by a guess of what it would say.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InvitationRenderer from '@/components/invitation/InvitationRenderer';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  resolveFamilyReview,
  submitFamilyReview,
  REVIEW_UNAVAILABLE,
  type ReviewDecision,
} from '@/integrations/supabase/publicReview';
import { headingOf, SECTION_LABELS } from '@/lib/invitationAuthoring';
import { PACK_SECTION_KEYS, type PackSectionKey } from '@/lib/traditionPackContract';
import { formatInstant } from '@/lib/instantText';
import type { FamilyReviewDocument } from '@/lib/familyReview';

const LABEL_MAX = 120;
const NOTE_MAX = 2000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; review: FamilyReviewDocument };

/** What the reviewer sent, kept so the receipt can show their own words back to them. */
interface SentAnswer {
  decision: ReviewDecision;
  label: string;
  message: string | null;
}

/** A section's words for someone who has never seen the platform's vocabulary. The heading the
 *  release wrote for that slot is what the reviewer is looking at on the document above, so
 *  naming the option with it is the one label that cannot disagree with the page they are
 *  reviewing. `PACK_SECTION_KEYS` is the database's own closed list: a key missing from it came
 *  from a newer migration, and the honest rendering of that is the neutral phrase rather than a
 *  machine identifier printed as a heading. */
const sectionLabel = (invitation: FamilyReviewDocument['invitation'], key: string): string => {
  if (!PACK_SECTION_KEYS.includes(key as PackSectionKey)) return 'One of the sections';
  return headingOf(invitation, key as PackSectionKey) ?? SECTION_LABELS[key as PackSectionKey];
};

const Unavailable = () => (
  <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-16 text-center">
    <BrandLockup variant="compact" className="mb-8" />
    <h1 className="font-display text-2xl font-semibold text-ink">{REVIEW_UNAVAILABLE}</h1>
    <p className="mt-3 text-ink-muted">
      The family may have withdrawn the link, it may have run out of time, it may already have
      your answer, or a character may have been missed when it was typed. Only the family can
      send a working review link.
    </p>
    <p className="mt-6 text-sm text-ink-muted">
      No account is needed to review a wedding invitation. Nothing was signed in, and no account
      was created, to show you this page.
    </p>
  </main>
);

/** The answer, after it is in the database: what the reviewer chose, in their own words where
 *  they wrote them, so they can see what was recorded rather than trust that it was. The version
 *  number is repeated because a reviewer who was shown version 7 should be able to see that their
 *  answer is pinned to version 7 and not to whatever the family is editing now. */
const Recorded = ({ answer, versionNumber }: { answer: SentAnswer; versionNumber: number }) => (
  <section
    className="mx-auto mt-8 max-w-[34rem] rounded-xl border border-gold/60 bg-paper p-5"
    aria-labelledby="review-recorded-heading"
  >
    <h2 id="review-recorded-heading" className="font-display text-lg font-semibold text-ink">
      Your answer is recorded
    </h2>
    <p role="status" className="mt-2 text-sm text-ink">
      {answer.decision === 'approved'
        ? 'You approved this invitation as it stands.'
        : 'You asked for changes.'}
    </p>
    {answer.message !== null ? (
      <p className="mt-2 whitespace-pre-line break-words text-sm text-ink-muted">
        {answer.message}
      </p>
    ) : null}
    <p className="mt-2 text-sm text-ink-muted">Signed as {answer.label}.</p>
    <p className="mt-4 text-xs text-ink-muted">
      Your answer is recorded against version {versionNumber}, the document you read above. It
      changed nothing on that version — only the family's own editor does that, and the invitation
      you just read stays exactly as it was.
    </p>
    <p className="mt-3 text-xs text-ink-muted">
      This link now opens nothing else, and it was never a sign-in to anything.
    </p>
  </section>
);

const ReviewForm = ({
  token,
  review,
  onRecorded,
}: {
  token: string;
  review: FamilyReviewDocument;
  onRecorded: (answer: SentAnswer) => void;
}) => {
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [label, setLabel] = useState('');
  const [sectionKey, setSectionKey] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const trimmedLabel = label.trim();
  const trimmedNote = message.trim();
  const noteRequired = decision === 'changes_requested';

  const send = async () => {
    if (decision === null || sending) return;
    setSending(true);
    setRefusal(null);
    const answer: SentAnswer = {
      decision,
      label: trimmedLabel,
      message: trimmedNote === '' ? null : trimmedNote,
    };
    const result = await submitFamilyReview(token, {
      decision: answer.decision,
      reviewerLabel: answer.label,
      message: answer.message,
      sectionKey: sectionKey === '' ? null : sectionKey,
    });
    if (result.data === null) {
      // The form stays exactly as it is filled in: a reviewer who typed a note and was told the
      // note was too long must not have to write it again.
      setSending(false);
      setRefusal(result.error ?? REVIEW_UNAVAILABLE);
      return;
    }
    onRecorded(answer);
  };

  return (
    <form
      className="mx-auto mt-8 max-w-[34rem] space-y-5 rounded-xl border border-gold/60 bg-paper p-5"
      onSubmit={event => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 className="font-display text-lg font-semibold text-ink">Send your answer</h2>

      <fieldset className="space-y-2">
        <legend className="font-display text-sm font-medium text-ink">Your answer</legend>
        {(['approved', 'changes_requested'] as const).map(value => (
          <label
            key={value}
            className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-lg border border-gold/50 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="radio"
              name="review-decision"
              value={value}
              checked={decision === value}
              onChange={() => {
                setDecision(value);
                setRefusal(null);
              }}
              className="h-4 w-4 shrink-0 accent-ceremonial"
            />
            {value === 'approved' ? 'I approve this invitation as it is' : 'Please change something'}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="review-label" className="text-sm">
          Your name, as the family should see it
        </Label>
        <Input
          id="review-label"
          value={label}
          onChange={event => setLabel(event.target.value)}
          maxLength={LABEL_MAX}
          className="h-11"
          required
        />
        <p className="text-xs text-ink-muted">
          There is no sign-in on this page and nothing here checks who you are. This is how your
          answer is signed.
        </p>
      </div>

      {review.sectionKeys.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor="review-section" className="text-sm">
            Which part is this about? (optional)
          </Label>
          <select
            id="review-section"
            value={sectionKey}
            onChange={event => setSectionKey(event.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Not about one particular part</option>
            {review.sectionKeys.map(key => (
              <option key={key} value={key}>
                {sectionLabel(review.invitation, key)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="review-message" className="text-sm">
          {noteRequired ? 'What should change?' : 'A note for the family (optional)'}
        </Label>
        <Textarea
          id="review-message"
          value={message}
          onChange={event => setMessage(event.target.value)}
          rows={4}
          maxLength={NOTE_MAX}
          required={noteRequired}
          className="break-words"
        />
        <p className="text-xs text-ink-muted">
          {noteRequired
            ? 'A request for changes is not recorded without the note — the family needs to know what to change.'
            : 'Leave this empty if you only want to approve.'}{' '}
          {NOTE_MAX - message.trim().length} characters left.
        </p>
      </div>

      <Button
        type="submit"
        className="h-11 w-full rounded-lg"
        disabled={sending || decision === null || trimmedLabel === ''}
      >
        {sending ? 'Sending…' : 'Send my answer'}
      </Button>

      {decision === null ? (
        <p className="text-xs text-ink-muted">Choose one of the two answers above to send it.</p>
      ) : null}

      {refusal !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      ) : null}
    </form>
  );
};

const FamilyReviewPage = () => {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [sent, setSent] = useState<SentAnswer | null>(null);

  useEffect(() => {
    // The same shape test the resolver runs, done locally so an empty `/r/` costs no round trip.
    if (!token) {
      setPhase({ kind: 'unavailable' });
      return;
    }
    let active = true;
    resolveFamilyReview(token).then(result => {
      if (!active) return;
      setPhase(result.data ? { kind: 'ready', review: result.data } : { kind: 'unavailable' });
    });
    return () => {
      active = false;
    };
  }, [token]);

  // The tab is what a relative with the family's link beside three others is scanning, so the
  // couple's names belong there once they are known. Plain text, no credential, no tagline.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const previous = document.title;
    document.title = `${phase.review.invitation.title} — family review`;
    return () => {
      document.title = previous;
    };
  }, [phase]);

  if (phase.kind === 'loading') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
        <p role="status" className="animate-pulse text-ink-muted">
          Opening the review…
        </p>
      </main>
    );
  }

  if (phase.kind === 'unavailable') return <Unavailable />;
  if (token === undefined) return <Unavailable />;

  const { review } = phase;
  const requested = formatInstant(review.requestedAt);
  const expires = formatInstant(review.expiresAt);

  return (
    <main className="min-h-dvh bg-surface px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-[34rem]">
        <BrandLockup variant="compact" className="mb-6" />
        {/* The salutation is a sentence addressed to a person, not a title over a section, so it
            is set as text rather than marked up as a heading. The document below is the page's one
            level-1 heading — the same heading a guest's route puts on the same words — and giving
            the framing a second `h1` would leave a reviewer navigating by headings with two
            page-level destinations and no way to tell which is the invitation. `scripts/
            stage5-a11y-mobile.mjs` counts exactly one level-1 heading per page for this reason. */}
        <p className="font-display text-xl font-semibold text-ink">
          {review.reviewerDisplayName}, this invitation is waiting for you
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          A family asked you to read their invitation before it goes out to their guests. What
          follows is version {review.versionNumber} exactly as they froze it — the same page a
          guest would open.
          {requested !== null ? ` You were asked on ${requested}.` : ''}
          {expires !== null ? ` This link stops working on ${expires}.` : ''}
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Reading this needs no account. Your approval is your own word, not a verified identity:
          the family trusts that they sent you this link.
        </p>
      </div>

      <div className="mt-8">
        <InvitationRenderer invitation={review.invitation} />
      </div>

      {sent === null ? (
        <ReviewForm token={token} review={review} onRecorded={setSent} />
      ) : (
        <Recorded answer={sent} versionNumber={review.versionNumber} />
      )}
    </main>
  );
};

export default FamilyReviewPage;
