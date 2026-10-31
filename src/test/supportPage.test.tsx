// The host's support route, tested the way a host arrives: signed in, something is broken, and they want to
// tell whoever runs this product about it.
//
// Three files cover this slice, and each asks a different question. `src/test/supportCasesTransport.test.ts`
// asks what leaves the browser. `src/test/supportCasesShape.test.ts` asks whether what came back is the object
// the deployed body writes. This one asks what a host can see and do about it — and the answers worth pinning
// are the ones where a page could lie:
//
//   * **The screen shows the door's answer, not its own guess.** The list rows, the status sentence, the
//     history lines and the "this is the first N" note are all read out of payloads that go through the real
//     parsers in `@/lib/supportCases` below. A projection that stops writing a key fails here rather than
//     quietly rendering a stale field.
//   * **`reply_allowed` decides whether a control exists.** A disabled textarea on a closed thread tells the
//     host the product could answer them and is choosing not to; the door refuses a reply on a closed case
//     (`supabase/migrations/20261020190100_stage11_support_cases.sql:823-826`), so the box is absent instead.
//   * **One submission, one idempotency key.** The key lives in a `useRef` and is reused after a failed send
//     and re-minted only after one that landed (`:571-574`, `…:789-792`), so a second tap on a slow send
//     cannot put the same paragraph in the queue twice. That is the page's behaviour, not the adapter's, so
//     it can only be measured here.
//   * **Nothing on this page promises a time.** No column of `private.support_cases` is a deadline and no door
//     computes one, so the whole-page text is scanned for the promise rather than only the sentence written
//     today — this is the class of defect a truth pass exists to catch before a customer finds it.
//   * **A privacy ask is not a support message.** `privacy_data_request` is a category a ticket may carry, and
//     the intake row is a different door. The page says which is which, twice.
//
// What this file does NOT claim. That the doors answer at all — nothing is mocked below at the HTTP level, so
// every cell here is about a component and a stub. That the host may only see their own tickets (that is the
// SQL and HTTP tiers' case). And that the header navigation reaches this page, which is `Header.tsx` and the
// browser tier's journey.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listCases: vi.fn(),
  oneCase: vi.fn(),
  open: vi.fn(),
  reply: vi.fn(),
  listWeddings: vi.fn(),
}));

vi.mock('@/integrations/supabase/supportCases', () => ({
  getMySupportCases: (...a: unknown[]) => api.listCases(...a),
  getMySupportCase: (...a: unknown[]) => api.oneCase(...a),
  openSupportCase: (...a: unknown[]) => api.open(...a),
  replyToSupportCase: (...a: unknown[]) => api.reply(...a),
}));

vi.mock('@/integrations/supabase/weddings', () => ({
  listWeddings: (...a: unknown[]) => api.listWeddings(...a),
}));

const authValue = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111' },
  session: null,
  loading: false,
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => authValue }));

import Support from '@/pages/Support';
import {
  parseCaseList,
  parseCaseThread,
  parseOpenReceipt,
  parseReplyReceipt,
  SUMMARY_LIMIT,
} from '@/lib/supportCases';

const CASE_REF = 'SV-MFRV2XQ7';
const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';

/** A list row exactly as `…:658-662` writes it, then read by the shipped parser. */
const rawRow = (overrides: Record<string, unknown> = {}) => ({
  case_ref: CASE_REF,
  wedding_id: WEDDING,
  category: 'render_output',
  severity: 'normal',
  status: 'in_progress',
  resolution_code: null,
  host_summary: 'The PDF download stops at the first page.',
  opened_at: '2026-10-20T09:12:00+00:00',
  updated_at: '2026-10-21T07:45:00+00:00',
  resolved_at: null,
  ...overrides,
});

const listPayload = (rows: Record<string, unknown>[] = [rawRow()], limit = 25) =>
  parseCaseList({ cases: rows, status_filter: null, limit });

const rawEvent = (overrides: Record<string, unknown> = {}) => ({
  seq: 1, kind: 'status', actor_kind: 'system', from_status: 'open', to_status: 'triaged',
  body: null, created_at: '2026-10-21T02:00:00+00:00',
  ...overrides,
});

const threadPayload = (overrides: Record<string, unknown> = {}) =>
  parseCaseThread({
    ...rawRow({ status: 'awaiting_information' }),
    reply_allowed: true,
    resume_expected: true,
    events: [
      rawEvent({ seq: 1, kind: 'status', actor_kind: 'host', from_status: null, to_status: 'open' }),
      rawEvent({ seq: 2, kind: 'message_host', actor_kind: 'host', from_status: null, to_status: null, body: 'It started after I edited the venue.' }),
      rawEvent({ seq: 3, kind: 'status', actor_kind: 'system', from_status: 'open', to_status: 'triaged' }),
    ],
    ...overrides,
  });

const openPayload = (overrides: Record<string, unknown> = {}) =>
  parseOpenReceipt({
    case_ref: CASE_REF, wedding_id: WEDDING, category: 'guest_rsvp', severity: 'high',
    status: 'open', opened_at: '2026-10-20T09:12:00+00:00', replayed: false,
    ...overrides,
  });

const ok = <T,>(data: T) => ({ data, error: null });
const fail = (error: string) => ({ data: null, error });

const visit = () =>
  render(
    <MemoryRouter initialEntries={['/support']}>
      <Routes>
        <Route path="/support" element={<Support />} />
        <Route path="/my-data" element={<div>data requests page</div>} />
      </Routes>
    </MemoryRouter>,
  );

const text = () => document.querySelector('main')?.textContent ?? '';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listCases.mockResolvedValue(ok(listPayload()));
  api.listWeddings.mockResolvedValue(ok([{ id: WEDDING, title: 'Arun weds Deepa' }]));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the list a host lands on', () => {
  it('reads this account’s tickets once, with no filter and no page size of its own', async () => {
    visit();
    await waitFor(() => expect(screen.getByText('A download — PDF, image or QR code')).toBeInTheDocument());
    expect(api.listCases).toHaveBeenCalledTimes(1);
    expect(api.listCases).toHaveBeenCalledWith();
  });

  it('says where a ticket stands in the host’s words, not in the queue’s', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    // `in_progress` is the column's word; the badge is the customer's.
    expect(text()).toContain('being worked on');
    expect(text()).not.toContain('in_progress');
  });

  it('names the invitation a ticket is about, and says “My account” when it is not about one', async () => {
    api.listCases.mockResolvedValue(ok(listPayload([
      rawRow({ case_ref: 'SV-AAAABBBB', wedding_id: null, status: 'open' }),
      rawRow({ case_ref: 'SV-CCCCDDDD', status: 'resolved' }),
    ])));
    visit();
    await waitFor(() => expect(text()).toContain('SV-AAAABBBB'));
    expect(text()).toContain('My account');
    expect(text()).toContain('Arun weds Deepa');
    expect(text()).toContain('marked resolved');
  });

  it('tells a host who has never written to support that nothing is wrong', async () => {
    api.listCases.mockResolvedValue(ok(listPayload([])));
    visit();
    await waitFor(() => expect(text()).toContain('You have not written to support from this account.'));
    expect(text()).not.toContain('could not be read');
  });

  it('shows a page that is full as a page that is full', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => rawRow({ case_ref: `SV-0000000${i}` }));
    api.listCases.mockResolvedValue(ok(listPayload(rows, 2)));
    visit();
    await waitFor(() => expect(text()).toContain('SV-00000000'));
    expect(text()).toContain('This is the first 2 messages');
  });

  it('does not claim a page is full when the door simply returned everything', async () => {
    api.listCases.mockResolvedValue(ok(listPayload([rawRow()], 25)));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    expect(text()).not.toContain('This is the first');
  });

  it('answers a refusal with the adapter’s sentence and a way to try again', async () => {
    api.listCases.mockResolvedValue(fail('your support tickets could not be read'));
    visit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(text()).toContain('your support tickets could not be read');
    expect(api.listCases).toHaveBeenCalledTimes(1);
    api.listCases.mockResolvedValue(ok(listPayload()));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.listCases).toHaveBeenCalledTimes(2));
  });

  it('marks the waiting state as a live region and never as an error', async () => {
    api.listCases.mockReturnValue(new Promise(() => {}));
    visit();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('makes no promise about when anyone will answer, anywhere on the page', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    // Not one sentence on this screen may claim a reply window: no column of `private.support_cases` is a
    // deadline and no door computes one, so the page would be inventing the promise.
    expect(text()).not.toMatch(/\b(\d+\s*(hour|day|week|business day)s?\b)/i);
    expect(text()).not.toMatch(/(we (will|’ll|'ll) (reply|respond|answer)|within \d)/i);
    expect(text()).toContain('this product does not keep that clock');
  });

  it('sends a host who wants their data elsewhere, and says a ticket is not the request', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    const link = screen.getByRole('link', { name: 'your data requests' });
    expect(link.getAttribute('href')).toBe('/my-data');
    expect(text()).toContain('that is the request itself, not a message about it');
  });
});

describe('writing a new message', () => {
  it('offers the account and this host’s own invitations, and nothing else', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    const subject = await screen.findByLabelText('What is this about?');
    expect(Array.from(subject.querySelectorAll('option')).map((o) => o.textContent))
      .toEqual(['My account', 'Arun weds Deepa']);
  });

  it('sends the invitation it was shown, in the host’s choice', async () => {
    api.open.mockResolvedValue(ok(openPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    fireEvent.change(await screen.findByLabelText('What is this about?'), { target: { value: WEDDING } });
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'Three guests say their RSVP link is a 404.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
    expect(api.open.mock.calls[0][0]).toMatchObject({ weddingId: WEDDING, summary: 'Three guests say their RSVP link is a 404.' });
  });

  it('sends an account-level ticket with no wedding at all', async () => {
    api.open.mockResolvedValue(ok(openPayload({ wedding_id: null })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'I cannot sign in any more.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
    expect(api.open.mock.calls[0][0]).toMatchObject({ weddingId: null });
  });

  it('still sends when the invitation list could not be read, and says why only one choice is there', async () => {
    api.listWeddings.mockResolvedValue(fail('your invitations could not be read'));
    api.open.mockResolvedValue(ok(openPayload({ wedding_id: null })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));

    await waitFor(() => expect(text()).toContain('Your invitations could not be listed just now'));
    // One option, not a disabled control: a picker that is greyed out invites a host to fight it, while a
    // picker that simply holds the one thing that can still send — "My account" — needs no explanation.
    const subject = screen.getByLabelText('What is this about?');
    expect(subject.querySelectorAll('option')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Something else entirely.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
  });

  it('refuses an empty message before the door sees it', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(text()).toContain('Say what is wrong, in your own words');
    expect(api.open).not.toHaveBeenCalled();
  });

  it('counts the same limit the door enforces', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    const box = screen.getByLabelText('What happened?');
    expect(box).toHaveAttribute('maxlength', String(SUMMARY_LIMIT));

    fireEvent.change(box, { target: { value: 'x'.repeat(SUMMARY_LIMIT + 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(text()).toContain(`Keep it under ${SUMMARY_LIMIT} characters. This one is ${SUMMARY_LIMIT + 1}.`));
    expect(api.open).not.toHaveBeenCalled();
  });

  it('names a topic that this build has no words for instead of mapping it to a neighbour', async () => {
    api.listCases.mockResolvedValue(ok(listPayload([rawRow({ category: 'refund_dispute' })])));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    expect(text()).toContain('this build has no words for the topic “refund_dispute”');
  });

  it('keeps one idempotency key across a failed send, so a second tap cannot ask twice', async () => {
    api.open.mockResolvedValueOnce(fail('your message could not be sent'));
    api.open.mockResolvedValue(ok(openPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'One paragraph, pressed twice.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(text()).toContain('your message could not be sent'));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));

    const [first, second] = api.open.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(second).toBe(first);
  });

  it('mints a fresh key only once one has landed', async () => {
    api.open.mockResolvedValue(ok(openPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    const box = screen.getByLabelText('What happened?');

    fireEvent.change(box, { target: { value: 'First message.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));

    // Back to the list, then a genuinely new message: a second paragraph on the same account is a second
    // submission, and the door's replay rule would otherwise swallow it.
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    await waitFor(() => expect(screen.getByLabelText('What happened?').textContent).toBe(''));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Second message.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));

    const [first, second] = api.open.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(second).not.toBe(first);
  });

  it('reports the reference the door minted, and re-reads the list to get its status from the row', async () => {
    api.open.mockResolvedValue(ok(openPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'A thing is broken.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(text()).toContain('Sent. Its reference is'));
    expect(text()).toContain('SV-MFRV2XQ7');
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });

  it('tells a host asking about their data that this form is not the request', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: 'Write a new message' }));
    expect(screen.queryByText(/use your data requests page/)).toBeNull();
    fireEvent.change(await screen.findByLabelText('Topic'), { target: { value: 'privacy_data_request' } });
    await waitFor(() => expect(text()).toContain('that files the request itself'));
    expect(screen.getByRole('link', { name: 'your data requests page' })).toHaveAttribute('href', '/my-data');
  });
});

describe('one thread', () => {
  it('opens from a row and reads that thread, not the list again', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));

    await waitFor(() => expect(api.oneCase).toHaveBeenCalledWith(CASE_REF));
    expect(text()).toContain('The PDF download stops at the first page.');
    expect(text()).toContain('waiting on you');
  });

  it('draws the history in the host’s words, and who moved it', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    await waitFor(() => expect(text()).toContain('It started after I edited the venue.'));

    expect(text()).toContain('2026-10-21');
    expect(text()).toContain('you added a message');
    expect(text()).toContain('Moved from just received to in someone’s queue');
  });

  it('names an event kind it has not been told about rather than rendering it as a message', async () => {
    // The deployed projection filters to `message_host` and `status` (`…:723-731`), so a row of another kind
    // arriving here means a projection changed; the page shows its date and says it has no words for it.
    api.oneCase.mockResolvedValue(ok(threadPayload({
      events: [rawEvent({ seq: 3, kind: 'assignment', actor_kind: 'operator', body: 'internal: owner is Priya' })],
    })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    await waitFor(() => expect(text()).toContain('no words for a “assignment” entry'));
    expect(text()).toContain('internal: owner is Priya');
  });

  it('says so plainly when nothing has happened on the thread yet', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload({ events: [] })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    await waitFor(() => expect(text()).toContain('Nothing has happened on this thread yet.'));
  });

  it('prints an unknown status as unknown', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload({ status: 'escalated' })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    await waitFor(() => expect(text()).toContain('this build has no words for the status “escalated”'));
  });

  it('offers no reply box on a thread that would refuse one', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload({ reply_allowed: false, resume_expected: false, status: 'closed' })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));

    await waitFor(() => expect(text()).toContain('This thread is closed'));
    expect(screen.queryByLabelText('Add to this thread')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
  });

  it('sends a reply and re-reads the thread instead of guessing what it became', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    api.reply.mockResolvedValue(ok({ caseRef: CASE_REF, status: 'in_progress', seq: 3, replayed: false }));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    await waitFor(() => expect(api.oneCase).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Add to this thread'), { target: { value: 'Here is the screenshot you asked for.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(api.reply).toHaveBeenCalledTimes(1));
    expect(api.reply.mock.calls[0][0]).toMatchObject({
      caseRef: CASE_REF, body: 'Here is the screenshot you asked for.',
    });
    await waitFor(() => expect(api.oneCase).toHaveBeenCalledTimes(2));
    expect(text()).toContain('Your reply is on the thread.');
    expect(text()).not.toContain('Here is the screenshot you asked for.');
  });

  it('says when the door replayed a reply rather than writing a second one', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    api.reply.mockResolvedValue(ok({ caseRef: CASE_REF, status: 'in_progress', seq: 2, replayed: true }));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    fireEvent.change(await screen.findByLabelText('Add to this thread'), { target: { value: 'Same text again.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(text()).toContain('That reply had already reached us, so nothing was sent twice.'));
  });

  it('keeps the reply’s key across a failed send', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    api.reply.mockResolvedValueOnce(fail('your reply could not be sent'));
    api.reply.mockResolvedValue(ok(parseReplyReceipt({ case_ref: CASE_REF, status: 'in_progress', seq: 3, replayed: false })));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    const box = await screen.findByLabelText('Add to this thread');
    fireEvent.change(box, { target: { value: 'One reply, pressed twice.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(text()).toContain('your reply could not be sent'));
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(api.reply).toHaveBeenCalledTimes(2));

    const [first, second] = api.reply.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(second).toBe(first);
  });

  it('refuses an empty reply before the door sees it', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    fireEvent.change(await screen.findByLabelText('Add to this thread'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(text()).toContain('A reply has to say something.'));
    expect(api.reply).not.toHaveBeenCalled();
  });

  it('answers a thread that is not this account’s with the sentence that gives nothing away', async () => {
    api.oneCase.mockResolvedValue(fail('this support thread could not be read'));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));

    await waitFor(() => expect(text()).toContain('this support thread could not be read'));
    expect(text()).toContain('a thread that was never opened answer with the same message');
  });

  it('keeps one level-one heading on the thread view', async () => {
    api.oneCase.mockResolvedValue(ok(threadPayload()));
    visit();
    await waitFor(() => expect(text()).toContain(CASE_REF));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CASE_REF) }));
    await waitFor(() => expect(api.oneCase).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Support']);
  });
});
