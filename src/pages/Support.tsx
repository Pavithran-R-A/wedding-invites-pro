// Support: the page where a host writes to whoever runs this product, and reads what came back.
//
// Five things decide what is on this screen, and each of them is a fact about the doors rather than a taste.
//
//   * **Nothing here promises a reply time.** The substrate records who read a ticket and where it stands; no
//     column in `private.support_cases` is a deadline and no door computes one. So the copy says what happens
//     — a person picks it up — and stops there. A sentence like "we answer within 24 hours" would be the page
//     making a promise the database cannot keep, which is the class of defect this project's truth passes
//     exist to catch.
//   * **The thread shows exactly what the projection allows a host to see.** `api.get_my_support_case` filters
//     its events to `message_host` and `status` and derives two flags (`…support_cases.sql:723-731`,
//     `…:741-742`), so an operator's private note, an assignment and the `operation_link` rows are not in the
//     payload at all. This page has no markup for them and no "show more" that would ask for them: the
//     boundary is the door's, and a client cannot widen it.
//   * **`reply_allowed` decides whether the box exists.** A closed thread takes no further messages (`…:823-826`
//     refuses one), so the page renders no disabled textarea on it — a control that is always going to refuse
//     is a control that lies about what the product can do.
//   * **The idempotency key belongs to the submission, not the attempt.** Both write doors require one
//     (`…:526-528`, `…:789-792`) and the body's promise is that the same key from the same account answers
//     with the ticket or the reply the first delivery made rather than writing twice. A key minted inside the
//     click handler would break on the second click of a slow send, which is exactly when the customer most
//     needs the guarantee — so the key lives in a `useRef`, is reused when a send fails and is replaced only
//     after one has landed.
//   * **A privacy ask has its own page.** `privacy_data_request` is one of the seven categories a ticket may
//     be opened with, and filing one there is a note in prose; `api.create_privacy_request` is the row the
//     intake queue reads. The picker says which is which rather than letting a host believe a paragraph in a
//     support thread is the legal request.
//
// A word this build does not know is printed as unknown rather than mapped to its neighbour, by the rule the
// readers in `@/lib/supportCases` exist to enforce.

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
  getMySupportCase,
  getMySupportCases,
  openSupportCase,
  replyToSupportCase,
} from '@/integrations/supabase/supportCases';
import { listWeddings, type WeddingSummary } from '@/integrations/supabase/weddings';
import {
  REPLY_LIMIT,
  SUMMARY_LIMIT,
  SUPPORT_CATEGORIES,
  SUPPORT_SEVERITIES,
  actorWords,
  categoryWords,
  isKnownStatus,
  newIdempotencyKey,
  resolutionWords,
  severityWords,
  stampDay,
  statusLabel,
  statusWords,
  type OpenCaseReceipt,
  type SupportCaseList,
  type SupportCaseSummary,
  type SupportCaseThread,
} from '@/lib/supportCases';

/** The picker's own value for "this is not about an invitation". */
const ABOUT_ACCOUNT = 'account';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'thread'; caseRef: string };

const selectClass =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const heading = (text: string) => <h2 className="font-display text-sm font-semibold">{text}</h2>;

/** What a case is about, in the host's terms: an invitation they named, or their account. */
const subjectWords = (weddingId: string | null, weddings: WeddingSummary[]): string => {
  if (weddingId === null) return 'My account';
  const match = weddings.find((wedding) => wedding.id === weddingId);
  return match ? match.title : 'An invitation this list cannot name';
};

const NewCaseForm = ({
  weddings,
  weddingsUnavailable,
  onOpened,
  onBack,
}: {
  weddings: WeddingSummary[];
  weddingsUnavailable: boolean;
  onOpened: (receipt: OpenCaseReceipt) => void;
  onBack: () => void;
}) => {
  const [category, setCategory] = useState<string>('invitation_access');
  const [severity, setSeverity] = useState<string>('normal');
  const [subject, setSubject] = useState<string>(ABOUT_ACCOUNT);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keyRef = useRef(newIdempotencyKey());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = summary.trim();
    if (text === '') {
      setProblem('Say what is wrong, in your own words — a message with nothing in it cannot be worked on.');
      return;
    }
    if (text.length > SUMMARY_LIMIT) {
      setProblem(`Keep it under ${SUMMARY_LIMIT} characters. This one is ${text.length}.`);
      return;
    }
    setProblem(null);
    setBusy(true);
    const result = await openSupportCase({
      weddingId: subject === ABOUT_ACCOUNT ? null : subject,
      category,
      severity,
      summary: text,
      idempotencyKey: keyRef.current,
    });
    setBusy(false);
    if (result.error !== null || result.data === null) {
      // The key is kept: if the send only appeared to fail, pressing again must not put the same paragraph
      // in the queue twice.
      setProblem(result.error ?? 'your message could not be sent');
      return;
    }
    keyRef.current = newIdempotencyKey();
    setSummary('');
    onOpened(result.data);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="support-subject">What is this about?</Label>
        <select
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={selectClass}
        >
          <option value={ABOUT_ACCOUNT}>My account</option>
          {weddings.map((wedding) => (
            <option key={wedding.id} value={wedding.id}>
              {wedding.title}
            </option>
          ))}
        </select>
        {weddingsUnavailable ? (
          <p className="text-xs leading-snug text-muted-foreground">
            Your invitations could not be listed just now, so only “My account” can be chosen. The message
            still sends.
          </p>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">
            Naming an invitation lets whoever reads this see which wedding you mean.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="support-category">Topic</Label>
          <select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={selectClass}
          >
            {SUPPORT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {categoryWords(item)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-severity">How urgent is it?</Label>
          <select
            id="support-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className={selectClass}
          >
            {SUPPORT_SEVERITIES.map((item) => (
              <option key={item} value={item}>
                {severityWords(item)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {category === 'privacy_data_request' ? (
        <p className="rounded-lg border border-line/60 bg-muted/40 p-3 text-xs leading-snug">
          If you want a copy of your data or want it removed, use{' '}
          <Link to="/my-data" className="underline underline-offset-2">
            your data requests page
          </Link>{' '}
          instead — that files the request itself. A message here is a question about it, not the request.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="support-summary">What happened?</Label>
        <Textarea
          id="support-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={6}
          maxLength={SUMMARY_LIMIT}
          placeholder="Tell us what you were trying to do and what the product did."
        />
        <p className="text-xs text-muted-foreground">
          {summary.trim().length}/{SUMMARY_LIMIT} characters. This reaches whoever runs this product; it does
          not go to your guests.
        </p>
      </div>

      {problem !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="min-h-11 rounded-xl" disabled={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

const ThreadView = ({
  caseRef,
  weddings,
  onBack,
}: {
  caseRef: string;
  weddings: WeddingSummary[];
  onBack: () => void;
}) => {
  const [thread, setThread] = useState<SupportCaseThread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyProblem, setReplyProblem] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const keyRef = useRef(newIdempotencyKey());
  const ticket = useRef(0);

  const load = useCallback(async () => {
    ticket.current += 1;
    const mine = ticket.current;
    setBusy(true);
    const result = await getMySupportCase(caseRef);
    if (mine !== ticket.current) return;
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setLoadError(result.error ?? 'this support thread could not be read');
      return;
    }
    setThread(result.data);
    setLoadError(null);
  }, [caseRef]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = reply.trim();
    if (text === '') {
      setReplyProblem('A reply has to say something.');
      return;
    }
    if (text.length > REPLY_LIMIT) {
      setReplyProblem(`Keep it under ${REPLY_LIMIT} characters. This one is ${text.length}.`);
      return;
    }
    setReplyProblem(null);
    setReplyNotice(null);
    setSending(true);
    const result = await replyToSupportCase({
      caseRef,
      body: text,
      idempotencyKey: keyRef.current,
    });
    setSending(false);
    if (result.error !== null || result.data === null) {
      setReplyProblem(result.error ?? 'your reply could not be sent');
      return;
    }
    keyRef.current = newIdempotencyKey();
    setReply('');
    setReplyNotice(
      result.data.replayed
        ? 'That reply had already reached us, so nothing was sent twice.'
        : 'Your reply is on the thread.',
    );
    // The status line and the history are re-read rather than guessed from the receipt, because the door
    // decides what a reply does to a ticket's status and this page does not get to say it.
    void load();
  };

  const resolution = thread === null ? null : resolutionWords(thread.resolutionCode);
  const unknownStatus = thread !== null && !isKnownStatus(thread.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" className="min-h-11 rounded-lg" onClick={onBack}>
          All messages
        </Button>
        <Button type="button" variant="outline" size="sm" className="min-h-11 rounded-lg" onClick={() => { void load(); }} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {thread === null && loadError === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading…
        </p>
      ) : null}

      {loadError !== null ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{loadError}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            A thread you do not own and a thread that was never opened answer with the same message, so this
            page cannot tell you which happened. Check the reference you came from.
          </p>
          <Button type="button" variant="outline" size="sm" className="min-h-11 rounded-lg" onClick={() => { void load(); }}>
            Try again
          </Button>
        </div>
      ) : null}

      {thread !== null ? (
        <>
          <div>
            <p className="text-xs text-muted-foreground">
              Reference <span className="font-mono">{thread.caseRef}</span> ·{' '}
              {subjectWords(thread.weddingId, weddings)} · {categoryWords(thread.category)} ·{' '}
              {severityWords(thread.severity)}
            </p>
            <p
              role="status"
              aria-live="polite"
              className={
                unknownStatus
                  ? 'mt-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-snug text-warning'
                  : 'mt-2 text-sm leading-snug'
              }
            >
              {statusWords(thread.status)}
            </p>
            {resolution !== null ? (
              <p className="mt-1 text-xs text-muted-foreground">Recorded outcome: {resolution}.</p>
            ) : null}
          </div>

          <Card>
            <CardContent className="pt-6 space-y-3">
              {heading('What you wrote')}
              <p className="text-sm leading-relaxed whitespace-pre-line">{thread.hostSummary}</p>
              <p className="text-xs text-muted-foreground">
                Opened {stampDay(thread.openedAt) ?? thread.openedAt}
                {thread.resolvedAt !== null
                  ? ` · marked resolved ${stampDay(thread.resolvedAt) ?? thread.resolvedAt}`
                  : ''}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {heading('The thread')}
            {thread.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing has happened on this thread yet.
              </p>
            ) : (
              <ol className="space-y-2">
                {thread.events.map((event) => (
                  <li key={event.seq} className="rounded-lg border border-line/60 p-3">
                    <p className="text-xs text-muted-foreground">
                      {stampDay(event.createdAt) ?? event.createdAt} ·{' '}
                      {event.kind === 'status'
                        ? `Moved ${event.fromStatus !== null ? `from ${statusLabel(event.fromStatus)} ` : ''}to ${statusLabel(event.toStatus ?? '?')} by ${actorWords(event.actorKind)}`
                        : `${actorWords(event.actorKind)} added a message`}
                    </p>
                    {event.body !== null ? (
                      <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{event.body}</p>
                    ) : null}
                    {/* The door's filter means only `message_host` and `status` rows arrive here
                        (`…support_cases.sql:723-731`), so this branch is unreachable from the deployed body.
                        It is the same posture as the rest of the readers: a kind a later projection starts
                        sending is named as unknown, not rendered as a message the host never wrote. */}
                    {event.kind !== 'status' && event.kind !== 'message_host' ? (
                      <p className="mt-1 text-xs text-warning">
                        This build has no words for a “{event.kind}” entry, so only its date is shown.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {thread.replyAllowed ? (
            <form onSubmit={send} className="space-y-3">
              <Label htmlFor="support-reply">Add to this thread</Label>
              {thread.resumeExpected ? (
                <p className="text-xs leading-snug text-warning">
                  Whoever handled this is waiting on something from you before they can go on.
                </p>
              ) : null}
              <Textarea
                id="support-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={5}
                maxLength={REPLY_LIMIT}
              />
              <p className="text-xs text-muted-foreground">
                {reply.trim().length}/{REPLY_LIMIT} characters.
              </p>
              {replyProblem !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {replyProblem}
                </p>
              ) : null}
              {replyNotice !== null ? (
                <p role="status" className="text-sm">
                  {replyNotice}
                </p>
              ) : null}
              <Button type="submit" className="min-h-11 rounded-xl" disabled={sending}>
                {sending ? 'Sending…' : 'Send reply'}
              </Button>
            </form>
          ) : (
            <p className="text-sm leading-snug text-muted-foreground">
              This thread is closed, so it takes no further messages. If the answer was wrong, open a new
              one and quote the reference above — a closed thread cannot be reopened from here.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
};

const Support = () => {
  const { user } = useAuth();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [list, setList] = useState<SupportCaseList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentRef, setSentRef] = useState<string | null>(null);
  const [weddings, setWeddings] = useState<WeddingSummary[]>([]);
  const [weddingsUnavailable, setWeddingsUnavailable] = useState(false);

  const loadList = useCallback(async () => {
    setBusy(true);
    const result = await getMySupportCases();
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setListError(result.error ?? 'your support tickets could not be read');
      return;
    }
    setList(result.data);
    setListError(null);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // The picker needs the host's own invitations and nothing else from them, so a failure here narrows the
    // form rather than breaking the page: an account-level ticket is still sendable.
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl px-4 md:px-6 py-8">
        <div className="mb-8">
          <h1 className="font-display text-2xl md:text-3xl font-bold">Support</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-snug">
            Write about something that is not working, on one of your invitations or on your account. A
            person reads what arrives; nothing on this page promises how long that takes, because this
            product does not keep that clock.
          </p>
          <p className="text-sm text-muted-foreground mt-2 leading-snug">
            For a copy of your data or for removing it, use{' '}
            <Link to="/my-data" className="underline underline-offset-2">
              your data requests
            </Link>{' '}
            — that is the request itself, not a message about it.
          </p>
        </div>

        {view.kind === 'list' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              {heading('Your messages')}
              <Button className="min-h-11 rounded-xl" onClick={() => setView({ kind: 'new' })}>
                Write a new message
              </Button>
            </div>

            {sentRef !== null ? (
              <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                Sent. Its reference is <span className="font-mono">{sentRef}</span> —{' '}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => {
                    setSentRef(null);
                    setView({ kind: 'thread', caseRef: sentRef });
                  }}
                >
                  open the thread
                </button>
                .
              </p>
            ) : null}

            {listError !== null ? (
              <div className="space-y-2" role="alert">
                <p className="text-sm text-destructive">{listError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 rounded-lg"
                  onClick={() => { void loadList(); }}
                  disabled={busy}
                >
                  Try again
                </Button>
              </div>
            ) : null}

            {list === null && listError === null ? (
              <div className="space-y-3" role="status">
                <p className="sr-only">Loading your messages…</p>
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : null}

            {list !== null && list.cases.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <p className="text-muted-foreground">You have not written to support from this account.</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Nothing is waiting on you, and nothing is queued behind you.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {list !== null && list.cases.length > 0 ? (
              <>
                <ul className="space-y-3">
                  {list.cases.map((item: SupportCaseSummary) => (
                    <li key={item.caseRef}>
                      <button
                        type="button"
                        className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => setView({ kind: 'thread', caseRef: item.caseRef })}
                      >
                        <Card className="hover:border-primary/30 transition-colors">
                          <CardContent className="py-4 space-y-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-medium text-sm truncate">{categoryWords(item.category)}</p>
                              <Badge
                                variant={item.status === 'closed' || item.status === 'resolved' ? 'secondary' : 'default'}
                                className="shrink-0"
                              >
                                {statusLabel(item.status)}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{item.caseRef}</span> ·{' '}
                              {subjectWords(item.weddingId, weddings)} ·{' '}
                              {stampDay(item.openedAt) ?? item.openedAt}
                            </p>
                          </CardContent>
                        </Card>
                      </button>
                    </li>
                  ))}
                </ul>
                {list.cases.length >= list.limit ? (
                  <p className="text-xs leading-snug text-muted-foreground">
                    This is the first {list.limit} messages on your account. Anything older is still there —
                    ask for it by reference, or from a screen that can page.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {view.kind === 'new' ? (
          <Card>
            <CardContent className="pt-6">
              <div className="mb-5">{heading('A new message')}</div>
              <NewCaseForm
                weddings={weddings}
                weddingsUnavailable={weddingsUnavailable}
                onBack={() => {
                  setView({ kind: 'list' });
                  void loadList();
                }}
                onOpened={(receipt) => {
                  setSentRef(receipt.caseRef);
                  setView({ kind: 'list' });
                  void loadList();
                }}
              />
            </CardContent>
          </Card>
        ) : null}

        {view.kind === 'thread' ? (
          <ThreadView
            key={view.caseRef}
            caseRef={view.caseRef}
            weddings={weddings}
            onBack={() => {
              setView({ kind: 'list' });
              void loadList();
            }}
          />
        ) : null}
      </main>
    </div>
  );
};

export default Support;
