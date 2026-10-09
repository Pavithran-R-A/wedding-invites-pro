// The host's review panel, tested against the three facts its own header says it is shaped by: an
// ask names one frozen version, the link it mints is shown exactly once, and withdrawing a link
// does not unrecord an answer.
//
// Most of this file is about what the panel is allowed to *say*, because on this screen a sentence
// is a product claim: a host who reads "their link is ready" has been handed a credential that
// exists in one HTTP response and nowhere else, and a host who reads "withdrawn" has been told
// something about a relative's already-recorded answer that an append-only table does not support.
// The vocabulary assertions run the same way — an unknown status, link state, feedback kind or
// decision is shown as an unknown word rather than a guessed one, so a future migration cannot be
// printed as this build's fact.
//
// What a jsdom test cannot pin here is a measured tap target: this environment lays nothing out.
// What it can pin, and does, is that every control carries a name of its own — a control a screen
// reader cannot name is a defect no pixel measurement will catch, and the panel's pixel figures
// belong to `scripts/stage5-a11y-mobile.mjs`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FamilyReviewPanel from "@/components/invitation/FamilyReviewPanel";
import type { ApprovalHistoryEntry, ApprovalRequestRow } from "@/lib/familyReview";
import type { StoredInvitationVersion } from "@/integrations/supabase/weddings";

const api = vi.hoisted(() => ({
  queue: vi.fn(),
  ask: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/familyReview", () => ({
  getApprovalRequests: (...args: unknown[]) => api.queue(...args),
  requestFamilyReview: (...args: unknown[]) => api.ask(...args),
  revokeFamilyReview: (...args: unknown[]) => api.revoke(...args),
}));

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(41) + '_-';
const REQUEST = '2f6c1a44-7c31-4b1e-9a10-000000000001';

const VERSIONS: StoredInvitationVersion[] = [
  { id: 'v3', versionNumber: 3, createdAt: '2026-10-01T05:30:00+00:00' },
  { id: 'v2', versionNumber: 2, createdAt: '2026-09-20T05:30:00+00:00' },
];

const historyEntry = (overrides: Partial<ApprovalHistoryEntry> = {}): ApprovalHistoryEntry => ({
  id: '9c1e5c3a-0000-4000-8000-000000000009',
  kind: 'decision',
  decision: 'changes_requested',
  sectionKey: 'blessing',
  message: 'The blessing line reads as ours, not yours.',
  authorLabel: 'Aunty',
  createdAt: '2026-10-02T09:12:00+00:00',
  ...overrides,
});

const queueRow = (overrides: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow => ({
  requestId: REQUEST,
  versionId: 'v3',
  versionNumber: 3,
  reviewerDisplayName: 'Aunty',
  status: 'changes_requested',
  requestedAt: '2026-10-01T06:00:00+00:00',
  respondedAt: '2026-10-02T09:12:00+00:00',
  invalidatedAt: null,
  linkState: 'live',
  linkExpiresAt: '2026-10-15T06:00:00+00:00',
  linkLastUsedAt: '2026-10-02T09:12:00+00:00',
  history: [historyEntry()],
  ...overrides,
});

/** The panel's mount read resolves a promise, and the `setRows` behind it lands in a microtask
 *  after `render()`'s synchronous act scope has closed. Rendering inside an async act scope drains
 *  that read before the test's first assertion, which is the only way to keep React's `act`
 *  warning off a file whose subject happens to be an asynchronous read. */
const renderPanel = async (versions: StoredInvitationVersion[] = VERSIONS) =>
  await act(async () => render(<FamilyReviewPanel weddingId={WEDDING} versions={versions} />));

/** Drain every promise the panel chained onto a write, inside `act`, so a test that ends on an
 *  assertion about the *call* rather than the *render* does not leave a state update for React to
 *  warn about. Writes whose re-read changes what is on screen are awaited by their own text
 *  instead, which is the stronger claim. */
const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

/** Wait for the mount read to have answered, so a later click cannot race the queue. */
const settle = async () => {
  await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByText('Loading your review queue…')).toBeNull());
};

const addressLine = () => screen.getByText(new RegExp(`^https?://.+/r/${TOKEN}$`));

/** A click that starts a call leaves a chain behind it: the write's own update, then the re-read's.
 *  Crossing one macrotask boundary inside `act` drains both, so no update lands after the scope
 *  closes. A call that never resolves simply leaves the boundary empty, which is what the
 *  in-flight tests want. */
const press = async (control: HTMLElement) => {
  await act(async () => {
    fireEvent.click(control);
  });
  await flush();
};

const askedFor = async (name: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Who are you asking/i), { target: { value: name } });
  });
  await press(screen.getByRole('button', { name: /Ask them to review it/i }));
};

const successfulAsk = () =>
  api.ask.mockResolvedValue({
    data: { requestId: REQUEST, token: TOKEN, expiresAt: null },
    error: null,
  });

/** Queue reads answer in order: the first is the mount read, every one after it is the re-read a
 *  write triggers. Tests end on the re-read's row rather than on the adapter call, because a test
 *  that stops at the call leaves a state update outstanding — which React reports as an `act`
 *  warning, and because a panel that never re-read after writing would pass such a test anyway. */
const readsThen = (mount: ApprovalRequestRow[], afterWrite: ApprovalRequestRow[]) => {
  api.queue.mockResolvedValueOnce({ data: mount, error: null });
  api.queue.mockResolvedValue({ data: afterWrite, error: null });
};

const askOnce = async () => {
  successfulAsk();
  readsThen([], [queueRow()]);
  const view = await renderPanel();
  await settle();
  await askedFor('Maami');
  await waitFor(() => expect(addressLine()).toBeInTheDocument());
  // The row that only the re-read after a successful ask can put on the screen.
  await screen.findByText(/Asked for changes · Link still works/);
  return view;
};

beforeEach(() => {
  vi.resetAllMocks();
  api.queue.mockResolvedValue({ data: [], error: null });
});

describe("the ask, before it is made", () => {
  it("offers no version picker when nothing is frozen, and says what to do instead", async () => {
    await renderPanel([]);
    await settle();
    expect(screen.queryByRole('combobox', { name: /Which version should they read/i })).toBeNull();
    expect(screen.getByText(/Nothing to send yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/A review is always about one frozen version, never about a draft/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ask them to review it/i })).toBeDisabled();
    expect(screen.getByLabelText(/Who are you asking/i)).toBeDisabled();
    expect(api.ask).not.toHaveBeenCalled();
  });

  it("lists the frozen versions newest first, and names the one an ask would use", async () => {
    await renderPanel();
    await settle();
    const picker = screen.getByRole('combobox', { name: /Which version should they read/i });
    expect(Array.from(picker.querySelectorAll('option'), option => option.textContent)).toEqual([
      'Version 3 · 2026-10-01',
      'Version 2 · 2026-09-20',
    ]);
    // The default is the newest frozen version, and the day comes off the server's own stamp
    // rather than the browser's clock.
    expect(picker).toHaveValue('v3');
  });

  it("will not ask for a review addressed to nobody", async () => {
    await renderPanel();
    await settle();
    const ask = screen.getByRole('button', { name: /Ask them to review it/i });
    expect(ask).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Who are you asking/i), { target: { value: '   ' } });
    expect(ask).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Who are you asking/i), { target: { value: 'Maami' } });
    expect(ask).toBeEnabled();
    expect(api.ask).not.toHaveBeenCalled();
  });

  it("says plainly that a name here is who the host believes they are writing to, not a verified identity", async () => {
    await renderPanel();
    await settle();
    expect(screen.getByText(/does not check who opens the link/i)).toBeInTheDocument();
    expect(
      screen.getByText(/only lets the family send it to somebody they trust/i),
    ).toBeInTheDocument();
  });

  it("asks against the version the host is looking at, with the name trimmed", async () => {
    successfulAsk();
    await renderPanel();
    await settle();
    fireEvent.change(screen.getByRole('combobox', { name: /Which version/i }), {
      target: { value: 'v2' },
    });
    await askedFor('  Maami  ');
    await waitFor(() => expect(api.ask).toHaveBeenCalledWith(WEDDING, 'v2', 'Maami'));
  });

  it("takes no second action while a call is in flight, and says it is working", async () => {
    let finish: (value: unknown) => void = () => {};
    api.ask.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    readsThen([], [queueRow()]);
    await renderPanel();
    await settle();
    await askedFor('Maami');
    await waitFor(() => expect(screen.getByText('Working…')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Ask them to review it/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /Which version/i })).toBeDisabled();
    expect(api.ask).toHaveBeenCalledTimes(1);
    finish({ data: { requestId: REQUEST, token: TOKEN, expiresAt: null }, error: null });
    await screen.findByText(/Asked for changes · Link still works/);
    expect(screen.queryByText('Working…')).toBeNull();
  });
});

describe("the link an ask hands back", () => {
  it("shows the address, says it is shown once, and says nothing has been sent", async () => {
    await askOnce();
    expect(screen.getByText(/This is their review link\. It is shown once/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy it now — it cannot be shown again/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent to anyone/i)).toBeInTheDocument();
    // There is no delivery in this build, so no verb on any control implying one.
    expect(screen.queryByRole('button', { name: /send|deliver|notify|invite/i })).toBeNull();
  });

  it("keeps the credential out of storage and out of an href", async () => {
    const { container } = await askOnce();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    // An anchor would put the credential in `href`, in the browser's status bar and, on a click,
    // in `Referer`. The address is text the host copies, and this panel writes no anchors at all.
    expect(container.querySelector('a')).toBeNull();
    // And the queue that is re-read after the ask reports the link's *state*, which is all the
    // database can still answer; the credential exists in the one response that minted it.
    await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(2));
  });

  it("clears the name it was addressed to, so the next ask cannot inherit it", async () => {
    await askOnce();
    expect(screen.getByLabelText(/Who are you asking/i)).toHaveValue('');
  });

  it("copies through the clipboard when the browser offers one, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await askOnce();
    await press(screen.getByRole('button', { name: /^Copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(addressLine().textContent));
    expect(await screen.findByText('Copied to the clipboard.')).toBeInTheDocument();
  });

  it("stays honest when the clipboard refuses, because the address was never the clipboard's", async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    await askOnce();
    await press(screen.getByRole('button', { name: /^Copy$/i }));
    expect(await screen.findByText(/Nothing has been sent to anyone/)).toBeInTheDocument();
    expect(addressLine()).toBeInTheDocument();
  });

  it("refuses to show a half-formed address when the credential is not shaped like one", async () => {
    api.ask.mockResolvedValue({
      data: { requestId: REQUEST, token: 'short', expiresAt: null },
      error: null,
    });
    await renderPanel();
    await settle();
    await askedFor('Maami');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'a review link could not be formed from that answer. Nothing was sent.',
    );
    expect(screen.queryByText(/\/r\//)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("prints the adapter's own phrase when the ask fails, and keeps the form usable", async () => {
    api.ask.mockResolvedValue({ data: null, error: 'the review request could not be made' });
    await renderPanel();
    await settle();
    await askedFor('Maami');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('the review request could not be made');
    expect(screen.getByLabelText(/Who are you asking/i)).toHaveValue('Maami');
    expect(screen.getByRole('button', { name: /Ask them to review it/i })).toBeEnabled();
  });
});

describe("the queue a host reads back", () => {
  const readBack = async (row: ApprovalRequestRow) => {
    api.queue.mockResolvedValue({ data: [row], error: null });
    const { container } = await renderPanel();
    await settle();
    return container.textContent ?? '';
  };

  it("prints the ask's status and the link's state side by side, because they are two facts", async () => {
    const text = await readBack(queueRow());
    expect(text).toContain(
      'Asked for changes · Link still works · asked 2026-10-01 · answered 2026-10-02',
    );
  });

  it("keeps an answered ask and a link that was never issued as two separate statements", async () => {
    const text = await readBack(
      queueRow({ status: 'approved', linkState: 'never_issued', respondedAt: null }),
    );
    expect(text).toContain('Approved · No link was ever issued · asked 2026-10-01');
    expect(text).not.toContain('answered');
  });

  it("shows a word this build has no label for as an unknown word, in every vocabulary it reads", async () => {
    const text = await readBack(
      queueRow({
        status: 'escalated',
        linkState: 'frozen',
        history: [
          // A decision row carrying a word from a newer migration.
          historyEntry({ id: 'h1', kind: 'decision', decision: 'maybe', sectionKey: null }),
          // A row with no decision at all, which is named by its kind — here, a kind this build
          // has never seen.
          historyEntry({
            id: 'h2',
            kind: 'annotation',
            decision: null,
            sectionKey: null,
            message: null,
            authorLabel: null,
          }),
        ],
      }),
    );
    expect(text).toContain('This build has no word for “escalated” yet');
    expect(text).toContain('This build has no word for “frozen” yet');
    expect(text).toContain('A decision this build has no word for (“maybe”)');
    expect(text).toContain('This build has no word for “annotation” yet');
    // Column names never reach the screen as words a host reads.
    expect(text).not.toMatch(/section_key|link_state|approval_requests|version_id/);
  });

  it("names the part a note was about in the platform's own words", async () => {
    const text = await readBack(queueRow());
    expect(text).toContain('about a blessing');
  });

  it("refuses to print a slot key it does not know as if it were a heading", async () => {
    const text = await readBack(
      queueRow({ requestId: 'r2', history: [historyEntry({ sectionKey: 'annadanam' })] }),
    );
    expect(text).toContain('about a part of the invitation');
    expect(text).not.toContain('annadanam');
  });

  it("says what an answer that names no part did", async () => {
    const text = await readBack(
      queueRow({ requestId: 'r3', history: [historyEntry({ sectionKey: null })] }),
    );
    expect(text).toContain('not about one particular part');
  });

  it("shows the reviewer's own words and their own signature, as what they wrote", async () => {
    const text = await readBack(queueRow());
    expect(text).toContain('The blessing line reads as ours, not yours.');
    expect(text).toContain('Signed as Aunty.');
  });

  it("says an empty queue is empty rather than showing a header with nothing under it", async () => {
    await renderPanel();
    await settle();
    expect(
      screen.getByText(/You have not asked anyone to review this invitation yet/),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('list')).toHaveLength(0);
  });

  it("reports a failed read as a failure, with a retry that spends a second read", async () => {
    api.queue.mockResolvedValueOnce({ data: null, error: 'the review queue could not be read' });
    await renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('the review queue could not be read'),
    );
    await press(screen.getByRole('button', { name: /Try again/i }));
    await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe("withdrawing a link", () => {
  const PENDING = queueRow({ status: 'pending', linkState: 'live' });

  /** `afterWrite` is what the queue answers the re-read that every withdrawal triggers. */
  const withRow = async (afterWrite: ApprovalRequestRow[] = [PENDING]) => {
    readsThen([PENDING], afterWrite);
    await renderPanel();
    await settle();
    return screen.getByRole('button', { name: /Withdraw link/i });
  };

  it("says a pending ask is withdrawn, in the two facts it changed", async () => {
    api.revoke.mockResolvedValue({
      data: { requestId: REQUEST, status: 'invalidated', wasPending: true, credentialRevoked: true },
      error: null,
    });
    const withdraw = await withRow([
      queueRow({ status: 'invalidated', linkState: 'revoked', respondedAt: null, invalidatedAt: '2026-10-08T09:00:00+00:00' }),
    ]);
    await press(withdraw);
    // The outcome is read as the sentence, not as "the first live region": while the call is in
    // flight the panel legitimately has another `role=status` on the page.
    const outcome = await screen.findByText(
      'That ask is withdrawn and its link no longer opens anything.',
    );
    expect(outcome).toHaveAttribute('role', 'status');
    expect(outcome).toHaveAttribute('aria-live', 'polite');
    expect(api.revoke).toHaveBeenCalledWith(REQUEST);
    // The re-read is what puts the withdrawn state on the row, so the host's screen agrees with
    // the database rather than with the sentence the button just printed.
    expect(await screen.findByText(/Withdrawn before an answer · Link withdrawn/)).toBeInTheDocument();
  });

  it("says an answer already given stands, because the record is append-only", async () => {
    api.revoke.mockResolvedValue({
      data: { requestId: REQUEST, status: 'approved', wasPending: false, credentialRevoked: true },
      error: null,
    });
    const withdraw = await withRow([queueRow({ status: 'approved', linkState: 'revoked' })]);
    await press(withdraw);
    expect(
      await screen.findByText(
        'Their link is withdrawn. The answer they already gave stands as recorded.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('That ask is withdrawn and its link no longer opens anything.'),
    ).toBeNull();
    // The answer is still on the row it was recorded against.
    expect(await screen.findByText(/Approved · Link withdrawn/)).toBeInTheDocument();
  });

  it("says there was nothing left to withdraw when the link had already run out", async () => {
    api.revoke.mockResolvedValue({
      data: { requestId: REQUEST, status: 'changes_requested', wasPending: false, credentialRevoked: false },
      error: null,
    });
    const withdraw = await withRow();
    await press(withdraw);
    expect(await screen.findByText('That ask had no live link left to withdraw.')).toBeInTheDocument();
    // The re-read answered the same rows, so the sentence is the visible change and the queue call
    // is the rest: the panel re-read anyway.
    await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(2));
  });

  it("prints the adapter's phrase when the withdrawal fails, and still re-reads the queue", async () => {
    api.revoke.mockResolvedValue({ data: null, error: 'that review link could not be withdrawn' });
    const withdraw = await withRow();
    await press(withdraw);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'that review link could not be withdrawn',
    );
    await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(2));
  });

  it("takes no second withdrawal while one is in flight", async () => {
    api.revoke.mockReturnValue(new Promise(() => {}));
    const withdraw = await withRow();
    await press(withdraw);
    await waitFor(() => expect(withdraw).toBeDisabled());
    expect(api.revoke).toHaveBeenCalledTimes(1);
  });
});
