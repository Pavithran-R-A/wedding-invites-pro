// Your data: the two things a customer may ask of this product, and an honest account of what asking does.
//
// This page is an intake desk, and the whole design problem is saying so without making the customer feel
// brushed off. Four facts fix the words.
//
//   * **Filing is not doing.** Stage 11's own header for the migration behind this screen reads "receive a
//     request, route it, never erase anything"
//     (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:1`), and the create door "deletes
//     nothing" (`…:328-330`). So there is no download button here, because no door hands a bundle of data to a
//     browser, and no "we have deleted your data", because nothing has been deleted. Both would be claims the
//     substrate cannot support, on the one screen where a customer is entitled to believe the product.
//   * **The status line is the truth of the row, not of the work.** Five statuses exist (`…:52-54`), and the
//     sentences in `@/lib/privacyRequests` describe what each row *is*. `satisfied_outside_this_build` means a
//     person acted somewhere else — this product has no evidence of it beyond that flag, and says so. The
//     badge follows the same law and so has three answers, not two: `isLiveStatus` reports an unfamiliar
//     status as `false`, and a page that printed `false` as "settled" would tell a customer their erasure was
//     finished on the strength of a word this build has never read (`badgeOf` below).
//   * **One live request per wedding and kind.** The partial unique index (`…:78-80`) makes a second tap a
//     replay: the door returns the row it already had with `replayed: true` (`…:283-287`) and writes nothing.
//     The page therefore reports a replay as itself rather than as a fresh filing, and does not hide the
//     button while a request is live — asking again is how a customer reaches the same row.
//   * **`wedding_id` is required, and the operator's own note is not on this page.** There is no account-level
//     privacy request: a missing wedding fails the ownership test at `…:269-272` the same way somebody else's
//     wedding does, so the picker offers invitations and nothing else. The read projection names seven keys and
//     leaves out how identity was checked (`…:345-350`), because that is the operator's working record; a field
//     that is not in the payload cannot appear here even by accident, and this file adds no markup that would
//     ask for it.
//
// The note a host types is their own words, bounded by the door at 2 000 characters and required to be real
// text if present (`…:265-268`); it reaches the operator's screen and stays out of the audit trail (`…:55-56`).
// The legal description of what the product does with personal data is `/privacy-policy`, linked below, and
// this page does not pretend to replace it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '@/components/landing/Header';
import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createPrivacyRequest,
  getMyPrivacyRequests,
} from '@/integrations/supabase/privacyRequests';
import { listWeddings, type WeddingSummary } from '@/integrations/supabase/weddings';
import {
  NOTE_LIMIT,
  PRIVACY_KINDS,
  PRIVACY_STATUSES,
  isLiveStatus,
  kindWords,
  stampDay,
  statusWords,
  type FilePrivacyReceipt,
  type PrivacyRequestList,
} from '@/lib/privacyRequests';

const selectClass =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** What each of the two asks means, in the customer's terms, said before they choose one. */
const KIND_EXPLAINED: Record<(typeof PRIVACY_KINDS)[number], string> = {
  export:
    'Ask for a copy of what this product holds about one invitation of yours. This page files the ask; it does not produce the copy.',
  erasure:
    'Ask for the data behind one invitation to be removed. This page files the ask; the removal is a decision a person makes, and the status line is all this page can honestly say about it.',
};

/** null for a kind this build has no sentence for — which today's select cannot produce and tomorrow's CHECK
 *  might, and a guessed sentence would be the worse failure. */
const explainKind = (kindName: string): string | null =>
  (KIND_EXPLAINED as Record<string, string | undefined>)[kindName] ?? null;

/**
 * The one word a row is badged with — and it has three answers, because two would be a guess.
 *
 * `isLiveStatus` is the partial unique index read back as a boolean (`…:78-80`): it says whether a row still
 * holds this account's slot for that wedding and kind. Answering from a status it has never heard is *false*,
 * and `false` on this screen means "settled" — which would tell a customer that their erasure finished on the
 * strength of a word no reader in `@/lib/privacyRequests` has a sentence for. The vocabulary law this project
 * applies everywhere else (an unfamiliar *word* is kept and labelled, never mapped to its neighbour) has to
 * reach the badge too, because a badge is the shortest and loudest claim on the card.
 */
const badgeOf = (status: string): { words: string; variant: 'default' | 'secondary' | 'outline' } => {
  if (!(PRIVACY_STATUSES as readonly string[]).includes(status)) {
    return { words: 'a word this build does not know', variant: 'outline' };
  }
  return isLiveStatus(status)
    ? { words: 'waiting', variant: 'default' }
    : { words: 'settled', variant: 'secondary' };
};

const NewRequestForm = ({
  weddings,
  weddingsUnavailable,
  onFiled,
}: {
  weddings: WeddingSummary[];
  weddingsUnavailable: boolean;
  onFiled: (receipt: FilePrivacyReceipt) => void;
}) => {
  const [kind, setKind] = useState<string>('export');
  const [weddingId, setWeddingId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (weddingId === '') {
      setProblem('Choose which invitation this is about.');
      return;
    }
    const text = note.trim();
    if (text.length > NOTE_LIMIT) {
      setProblem(`Keep the note under ${NOTE_LIMIT} characters. This one is ${text.length}.`);
      return;
    }
    setProblem(null);
    setBusy(true);
    const result = await createPrivacyRequest({
      weddingId,
      kind,
      note: text === '' ? null : text,
    });
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setProblem(result.error ?? 'your privacy request could not be filed');
      return;
    }
    setNote('');
    onFiled(result.data);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="privacy-kind">What are you asking for?</Label>
        <select
          id="privacy-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={selectClass}
        >
          {PRIVACY_KINDS.map((item) => (
            <option key={item} value={item}>
              {kindWords(item)}
            </option>
          ))}
        </select>
        {explainKind(kind) !== null ? (
          <p className="text-xs leading-snug text-muted-foreground">{explainKind(kind)}</p>
        ) : (
          <p className="text-xs leading-snug text-warning">
            This build has no description for the request kind “{kind}”, so nothing here says what it would
            ask for. The door that receives it decides whether it knows that word.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="privacy-wedding">Which invitation?</Label>
        <select
          id="privacy-wedding"
          value={weddingId}
          onChange={(e) => setWeddingId(e.target.value)}
          className={selectClass}
        >
          <option value="">Choose an invitation…</option>
          {weddings.map((wedding) => (
            <option key={wedding.id} value={wedding.id}>
              {wedding.title}
            </option>
          ))}
        </select>
        {weddingsUnavailable ? (
          <p className="text-xs leading-snug text-muted-foreground">
            Your invitations could not be listed just now, so there is nothing to choose. Try again in a
            moment — a request has to name one of them.
          </p>
        ) : weddings.length === 0 ? (
          <p className="text-xs leading-snug text-muted-foreground">
            This account has no invitations, so there is nothing a request could be about.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="privacy-note">Anything you want to add? (optional)</Label>
        <Textarea
          id="privacy-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={NOTE_LIMIT}
          placeholder="Only if something needs explaining — a deadline, or a detail."
        />
        <p className="text-xs text-muted-foreground">
          {note.trim().length}/{NOTE_LIMIT} characters. Whoever handles the request reads this; your guests
          never do.
        </p>
      </div>

      {problem !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <Button type="submit" className="min-h-11 rounded-xl" disabled={busy}>
        {busy ? 'Filing…' : 'File this request'}
      </Button>
    </form>
  );
};

const MyData = () => {
  const { user } = useAuth();
  const [list, setList] = useState<PrivacyRequestList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [filed, setFiled] = useState<FilePrivacyReceipt | null>(null);
  const [weddings, setWeddings] = useState<WeddingSummary[]>([]);
  const [weddingsUnavailable, setWeddingsUnavailable] = useState(false);
  const ticket = useRef(0);

  const load = useCallback(async () => {
    ticket.current += 1;
    const mine = ticket.current;
    setBusy(true);
    const result = await getMyPrivacyRequests();
    if (mine !== ticket.current) return;
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setLoadError(result.error ?? 'your privacy requests could not be read');
      return;
    }
    setList(result.data);
    setLoadError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void listWeddings(user.id).then((result) => {
      if (cancelled) return;
      if (result.error !== null || result.data === null) {
        setWeddingsUnavailable(true);
        return;
      }
      setWeddings(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const titleOf = (weddingId: string): string => {
    const match = weddings.find((wedding) => wedding.id === weddingId);
    return match ? match.title : 'An invitation this list cannot name';
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl px-4 md:px-6 py-8">
        <div className="mb-8">
          <h1 className="font-display text-2xl md:text-3xl font-bold">Your data</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-snug">
            Ask for a copy of what this product holds about one of your invitations, or ask for it to be
            removed. What you see below is the request and where it stands — not a copy of the data and not a
            finished deletion, because this product records the ask and a person does the work.
          </p>
          <p className="text-sm text-muted-foreground mt-2 leading-snug">
            How personal data is handled here is written up in the{' '}
            <Link to="/privacy-policy" className="underline underline-offset-2">
              privacy policy
            </Link>
            . Questions about an invitation that are not about your data belong in{' '}
            <Link to="/support" className="underline underline-offset-2">
              support
            </Link>
            .
          </p>
        </div>

        {loadError !== null ? (
          <div className="space-y-2 mb-6" role="alert">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 rounded-lg"
              onClick={() => { void load(); }}
              disabled={busy}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {filed !== null ? (
          <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm mb-6">
            {filed.replayed
              ? `You already had this request open — its reference is ${filed.requestRef}, and nothing new was filed.`
              : `Filed. Its reference is ${filed.requestRef}.`}{' '}
            {statusWords(filed.status)}
          </p>
        ) : null}

        <section className="mb-8 space-y-3" aria-labelledby="requests-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="requests-heading" className="font-display text-sm font-semibold">
              Your requests
            </h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 rounded-lg"
              onClick={() => { void load(); }}
              disabled={busy}
            >
              {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          {list === null && loadError === null ? (
            <div className="space-y-3" role="status">
              <p className="sr-only">Loading your requests…</p>
              <div className="h-20 bg-muted animate-pulse rounded-lg" />
            </div>
          ) : null}

          {list !== null && list.requests.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <p className="text-muted-foreground">You have not filed a data request from this account.</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Nothing is waiting, and nothing has been sent to you or removed.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {list !== null && list.requests.length > 0 ? (
            <ul className="space-y-3">
              {list.requests.map((request) => {
                const badge = badgeOf(request.status);
                return (
                <li key={request.requestRef}>
                  <Card>
                    <CardContent className="pt-6 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{kindWords(request.kind)}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            <span className="font-mono">{request.requestRef}</span> ·{' '}
                            {titleOf(request.weddingId)} · filed {stampDay(request.requestedAt) ?? request.requestedAt}
                          </p>
                        </div>
                        <Badge variant={badge.variant} className="shrink-0">
                          {badge.words}
                        </Badge>
                      </div>
                      <p className="text-sm leading-snug">{statusWords(request.status)}</p>
                      {request.hostNote !== null ? (
                        <p className="text-xs leading-snug text-muted-foreground">
                          Your note: <span className="whitespace-pre-line">{request.hostNote}</span>
                        </p>
                      ) : null}
                      {stampDay(request.updatedAt) !== null &&
                      request.updatedAt !== request.requestedAt ? (
                        <p className="text-[11px] text-muted-foreground">
                          Last moved {stampDay(request.updatedAt)}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section aria-labelledby="new-request-heading">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 id="new-request-heading" className="font-display text-sm font-semibold">
              File a request
            </h2>
            {formOpen ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 rounded-lg"
                onClick={() => setFormOpen(false)}
              >
                Close
              </Button>
            ) : null}
          </div>
          {formOpen ? (
            <Card>
              <CardContent className="pt-6">
                <NewRequestForm
                  weddings={weddings}
                  weddingsUnavailable={weddingsUnavailable}
                  onFiled={(receipt) => {
                    setFiled(receipt);
                    setFormOpen(false);
                    void load();
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-3 leading-snug">
                A request names one of your invitations and stays private to your account until whoever
                handles it reads it.
              </p>
              <Button className="min-h-11 rounded-xl" onClick={() => setFormOpen(true)}>
                File a request
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default MyData;
