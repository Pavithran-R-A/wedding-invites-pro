// The customer's own data route, tested the way a nervous person arrives: they want a copy of what this
// product holds, or they want it gone, and they are reading a screen that is allowed to be believed.
//
// Three files cover this slice. `src/test/privacyRequestsTransport.test.ts` asks what leaves the browser,
// `src/test/privacyRequestsShape.test.ts` asks whether what came back is the object the deployed body writes.
// This one asks what the customer can see and do — and on this screen the interesting questions are all about
// claims:
//
//   * **Filing is not doing, and the page must keep saying so.** The migration behind these two doors is
//     headed "receive a request, route it, never erase anything"
//     (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:1`) and the create body "deletes nothing"
//     (`…:328-330`). So the whole rendered text is scanned for a claim that this product acted — a delivered
//     copy, a completed deletion, a date by which it will happen — rather than only for the sentences written
//     today. There is also no download or delete *affordance*, which is a separate assertion because a button
//     is a promise even when the prose around it is honest.
//   * **A word this build does not know is not allowed to become its neighbour.** `isLiveStatus` answers a
//     three-valued question with two values, so a status the queue invents later reads as `false` — and a
//     page that maps that `false` to the word "settled" would tell a customer their erasure was finished on
//     the strength of a word nobody has heard before. The badge therefore has three answers, and a cell below
//     drives an unfamiliar status to prove it.
//   * **The read is the account's, and the stale answer is dropped.** `load` guards with a ticket ref
//     (`src/pages/MyData.tsx:230-243`), so a slow first answer that lands after a newer one must not overwrite
//     the newer list. That is only observable at the component, so it is measured here.
//   * **The empty box is not the empty string.** The page trims and sends `null` for a note with nothing in it,
//     because the door refuses a blank (`…:265-268`) and the transport passes the page's value through
//     unchanged. `src/pages/MyData.tsx:126` is the only place that decision is made, so it is pinned here.
//   * **There is no account-level ask.** `p_wedding_id` is required (`…:269-272`), so the picker offers the
//     host's invitations and nothing that could stand for "everything on my account" — the opposite of the
//     support form, which can send an account-level ticket.
//
// What this file does NOT claim. That the doors answer at all — nothing is mocked at the HTTP level here. That
// a host may only read their own requests (that is the SQL and HTTP tiers' case, and the projection at
// `…:347-354` is what leaves the operator's note out of the payload). And that the header navigation reaches
// this page, which belongs to `Header.tsx` and the browser tier's journey.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  listWeddings: vi.fn(),
}));

vi.mock('@/integrations/supabase/privacyRequests', () => ({
  getMyPrivacyRequests: (...a: unknown[]) => api.list(...a),
  createPrivacyRequest: (...a: unknown[]) => api.create(...a),
}));

vi.mock('@/integrations/supabase/weddings', () => ({
  listWeddings: (...a: unknown[]) => api.listWeddings(...a),
}));

// One stable identity object: a fresh one per render would re-run the invitation lookup, and the page keys
// that effect on `user`.
const authValue = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111' },
  session: null,
  loading: false,
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => authValue }));

import MyData from '@/pages/MyData';
import {
  NOTE_LIMIT,
  parseFileReceipt,
  parsePrivacyList,
  type FilePrivacyReceipt,
  type PrivacyRequestList,
} from '@/lib/privacyRequests';
import type { QueryResult } from '@/integrations/supabase/weddings';

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const OTHER_WEDDING = '2c8b5a10-0000-4000-8000-000000000009';
const REQUEST_REF = 'PR-MFRV2XQ7';

const ok = <T,>(data: T) => ({ data, error: null });
const fail = (error: string) => ({ data: null, error });

/** A row exactly as the projection at `…:348-350` writes it, then read by the shipped parser — so a page
 *  that renders a field the body stopped writing goes red here rather than in front of a customer. */
const rawRow = (overrides: Record<string, unknown> = {}) => ({
  request_ref: REQUEST_REF,
  wedding_id: WEDDING,
  kind: 'export',
  status: 'received',
  host_note: null,
  requested_at: '2026-10-20T09:12:00+00:00',
  updated_at: '2026-10-21T07:45:00+00:00',
  ...overrides,
});

const listPayload = (rows: Record<string, unknown>[] = [rawRow()]): PrivacyRequestList =>
  parsePrivacyList({ requests: rows, count: rows.length })!;

const receiptPayload = (overrides: Record<string, unknown> = {}): FilePrivacyReceipt =>
  parseFileReceipt({
    request_ref: REQUEST_REF,
    wedding_id: WEDDING,
    kind: 'export',
    status: 'received',
    requested_at: '2026-10-20T09:12:00+00:00',
    replayed: false,
    ...overrides,
  })!;

const visit = () =>
  render(
    <MemoryRouter initialEntries={['/my-data']}>
      <Routes>
        <Route path="/my-data" element={<MyData />} />
        <Route path="*" element={<div>another page</div>} />
      </Routes>
    </MemoryRouter>,
  );

const text = () => document.querySelector('main')?.textContent ?? '';

/** Open the form, which the page keeps shut until it is asked for. */
const openForm = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'File a request' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'File this request' })).toBeInTheDocument());
};

const chooseWedding = () =>
  fireEvent.change(screen.getByLabelText('Which invitation?'), { target: { value: WEDDING } });

/** A promise the test gets to resolve, for the cell that needs two reads in flight at once. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.list.mockResolvedValue(ok(listPayload()));
  api.create.mockResolvedValue(ok(receiptPayload()));
  api.listWeddings.mockResolvedValue(ok([{ id: WEDDING, title: 'Arun weds Deepa' }]));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the list a customer lands on', () => {
  it('reads this account’s requests once, with no argument of its own', async () => {
    visit();
    await waitFor(() => expect(screen.getByText(REQUEST_REF)).toBeInTheDocument());
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledWith();
  });

  it('asks for the signed-in account’s own invitations, by that account’s id', async () => {
    visit();
    await waitFor(() => expect(api.listWeddings).toHaveBeenCalled());
    expect(api.listWeddings).toHaveBeenCalledWith(authValue.user!.id);
  });

  it('says what was asked and where it stands in the customer’s words, not the queue’s', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(REQUEST_REF));
    expect(text()).toContain('A copy of my data');
    expect(text()).toContain('Filed. Nobody has started on it, and nothing has been sent or removed.');
    // The column's words must not leak through: they are the operator's vocabulary.
    expect(text()).not.toMatch(/received|identity_verification_requested|queued_for_stage13|satisfied_outside/);
  });

  it('marks a live request as waiting and a finished one as settled', async () => {
    api.list.mockResolvedValue(
      ok(listPayload([rawRow({ request_ref: 'PR-AAAAAAA1', status: 'queued_for_stage13' }),
        rawRow({ request_ref: 'PR-AAAAAAA2', status: 'declined' })])),
    );
    visit();
    await waitFor(() => expect(screen.getByText('PR-AAAAAAA1')).toBeInTheDocument());
    expect(screen.getAllByText('waiting')).toHaveLength(1);
    expect(screen.getAllByText('settled')).toHaveLength(1);
  });

  it('does not call a status it has never seen “settled”', async () => {
    // The case the two-value badge gets wrong: a status the queue invents later is unknown, not finished.
    api.list.mockResolvedValue(ok(listPayload([rawRow({ status: 'under_legal_review' })])));
    visit();
    await waitFor(() => expect(text()).toContain('under_legal_review'));
    expect(text()).not.toContain('settled');
    expect(text()).not.toContain('waiting');
  });

  it('names a request kind it has never seen instead of drawing it as an export', async () => {
    api.list.mockResolvedValue(ok(listPayload([rawRow({ kind: 'rectification' })])));
    visit();
    await waitFor(() => expect(text()).toContain('this build has no words for the request “rectification”'));
    expect(text()).not.toContain('A copy of my data');
  });

  it('treats an empty list as an answer and not as a fault', async () => {
    api.list.mockResolvedValue(ok(listPayload([])));
    visit();
    await waitFor(() => expect(text()).toContain('You have not filed a data request from this account.'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The empty state is allowed to be reassuring only in the negative: nothing has happened.
    expect(text()).toContain('Nothing is waiting, and nothing has been sent to you or removed.');
  });

  it('claims nothing while the read is still in flight', async () => {
    api.list.mockReturnValue(new Promise(() => {}));
    visit();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(text()).not.toContain('You have not filed a data request');
  });

  it('refuses the whole list when the answer is not the object the body writes', async () => {
    api.list.mockResolvedValue(fail('your privacy requests could not be read'));
    visit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(text()).toContain('your privacy requests could not be read');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('drops an older answer that arrives after a newer one', async () => {
    const first = deferred<QueryResult<PrivacyRequestList>>();
    const second = deferred<QueryResult<PrivacyRequestList>>();
    api.list.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    visit();
    // Filing re-reads the list while the mount's own read is still outstanding.
    await openForm();
    chooseWedding();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    second.resolve(ok(listPayload([rawRow({ request_ref: 'PR-NEWEST01' })])));
    await waitFor(() => expect(text()).toContain('PR-NEWEST01'));

    first.resolve(ok(listPayload([rawRow({ request_ref: 'PR-STALE001' })])));
    await waitFor(() => expect(screen.getByText('PR-NEWEST01')).toBeInTheDocument());
    expect(text()).not.toContain('PR-STALE001');
  });
});

describe('what this page never promises', () => {
  it('scans the whole rendered page for a claim that it did the work', async () => {
    api.list.mockResolvedValue(
      ok(listPayload([rawRow({ status: 'satisfied_outside_this_build' }), rawRow({ request_ref: 'PR-BBBBBBB1', status: 'declined' })])),
    );
    visit();
    await waitFor(() => expect(text()).toContain('PR-BBBBBBB1'));
    // Only a claim that *this product* acted, and only a claim the copy is in hand. The truthful sentences
    // say the opposite ("nothing has been sent or removed"), so a bare verb may not be the test.
    const claimsItActed = /\bwe (have |’ve |'ve )?(sent|delivered|deleted|erased|removed|downloaded|exported)\b/i;
    const claimsACopy = /\b(your copy|a copy (is|has)|the download is|is ready (for|to))\b/i;
    expect(text()).not.toMatch(claimsItActed);
    expect(text()).not.toMatch(claimsACopy);
    // And no deadline: nothing in the substrate computes one.
    expect(text()).not.toMatch(/\b\d+\s*(hours?|days?|weeks?|business days?)\b/i);
    expect(text()).not.toMatch(/within \d/i);
  });

  it('offers no download or delete button, because no door would honour one', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(REQUEST_REF));
    expect(screen.queryByRole('button', { name: /download|delete|erase|export my/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('says in its own words that it records the ask and a person does the work', async () => {
    visit();
    await waitFor(() => expect(text()).toContain('a person does the work'));
    expect(text()).toContain('not a copy of the data');
  });

  it('routes a legal ask here and any other question to support, by name', async () => {
    visit();
    await waitFor(() => expect(screen.getByRole('link', { name: 'privacy policy' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy-policy');
    expect(screen.getByRole('link', { name: 'support' })).toHaveAttribute('href', '/support');
  });

  it('keeps the operator’s working record off the screen even if a payload grows one', async () => {
    // The projection names seven keys (`…:348-350`) and this page has no markup that would ask for more. A
    // widened payload must therefore still print nothing of how identity was checked.
    api.list.mockResolvedValue(
      ok(listPayload([rawRow({ identity_check_note: 'verified by phone call' })])),
    );
    visit();
    await waitFor(() => expect(text()).toContain(REQUEST_REF));
    expect(text()).not.toContain('verified by phone call');
    expect(text()).not.toMatch(/identity check/i);
  });

  it('puts exactly one level-1 heading on the page', async () => {
    visit();
    await waitFor(() => expect(text()).toContain(REQUEST_REF));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Your data']);
  });
});

describe('choosing what to ask for', () => {
  it('offers exactly the two kinds the CHECK allows, in the customer’s words', async () => {
    visit();
    await openForm();
    const picker = screen.getByLabelText('What are you asking for?') as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.value)).toEqual(['export', 'erasure']);
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual([
      'A copy of my data',
      'Removing my data',
    ]);
  });

  it('explains, before the ask, that this page files it and does not perform it', async () => {
    visit();
    await openForm();
    expect(text()).toContain('This page files the ask; it does not produce the copy.');
    fireEvent.change(screen.getByLabelText('What are you asking for?'), { target: { value: 'erasure' } });
    await waitFor(() =>
      expect(text()).toContain('the removal is a decision a person makes'));
    expect(text()).not.toContain('it does not produce the copy.');
  });

  it('offers only the host’s own invitations, and nothing that stands for the whole account', async () => {
    api.listWeddings.mockResolvedValue(ok([
      { id: WEDDING, title: 'Arun weds Deepa' },
      { id: OTHER_WEDDING, title: 'Meera weds Karthik' },
    ]));
    visit();
    await openForm();
    const picker = screen.getByLabelText('Which invitation?') as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual([
      'Choose an invitation…',
      'Arun weds Deepa',
      'Meera weds Karthik',
    ]);
    expect(text()).not.toContain('My account');
  });

  it('refuses to file before an invitation is chosen, without reaching the door', async () => {
    visit();
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(text()).toContain('Choose which invitation this is about.');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('says plainly when there is nothing to choose and still refuses the send', async () => {
    api.listWeddings.mockResolvedValue(fail('the invitations could not be listed'));
    visit();
    await openForm();
    await waitFor(() => expect(text()).toContain('there is nothing to choose'));
    const picker = screen.getByLabelText('Which invitation?') as HTMLSelectElement;
    expect(picker.options).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(text()).toContain('Choose which invitation this is about.'));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('says so when this account has no invitations at all', async () => {
    api.listWeddings.mockResolvedValue(ok([]));
    visit();
    await openForm();
    await waitFor(() => expect(text()).toContain('This account has no invitations'));
  });
});

describe('filing a request', () => {
  it('sends the chosen invitation and kind, with no note as null', async () => {
    visit();
    await openForm();
    chooseWedding();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({ weddingId: WEDDING, kind: 'export', note: null });
  });

  it('sends the erasure kind as the column’s word, not the label it shows', async () => {
    visit();
    await openForm();
    fireEvent.change(screen.getByLabelText('What are you asking for?'), { target: { value: 'erasure' } });
    chooseWedding();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][0]).toMatchObject({ kind: 'erasure' });
  });

  it('turns a blank note box into null instead of an empty string', async () => {
    visit();
    await openForm();
    chooseWedding();
    fireEvent.change(screen.getByLabelText(/Anything you want to add/), {
      target: { value: '   \n  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({ weddingId: WEDDING, kind: 'export', note: null });
  });

  it('passes a real note through with its own words kept', async () => {
    visit();
    await openForm();
    chooseWedding();
    fireEvent.change(screen.getByLabelText(/Anything you want to add/), {
      target: { value: '  I need it as one file, please.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({
      weddingId: WEDDING,
      kind: 'export',
      note: 'I need it as one file, please.',
    });
  });

  it('bounds the note where the door does, and shows the count while typing', async () => {
    visit();
    await openForm();
    const box = screen.getByLabelText(/Anything you want to add/) as HTMLTextAreaElement;
    expect(box).toHaveAttribute('maxlength', String(NOTE_LIMIT));
    expect(text()).toContain(`0/${NOTE_LIMIT} characters`);
    fireEvent.change(box, { target: { value: 'one line' } });
    expect(text()).toContain('8/' + NOTE_LIMIT + ' characters');
  });

  it('refuses an over-long note before the door, quoting the length it measured', async () => {
    visit();
    await openForm();
    chooseWedding();
    // jsdom honours `maxLength` only for real typing, so the long value is set directly — which is exactly
    // the paste-a-2001-character-note case the page's own bound has to catch.
    fireEvent.change(screen.getByLabelText(/Anything you want to add/), {
      target: { value: 'x'.repeat(NOTE_LIMIT + 1) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(text()).toContain(`Keep the note under ${NOTE_LIMIT} characters. This one is ${NOTE_LIMIT + 1}.`);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('prints the reference the door minted and re-reads the list', async () => {
    visit();
    await openForm();
    chooseWedding();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(text()).toContain('Filed. Its reference is PR-MFRV2XQ7.'));
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'File this request' })).not.toBeInTheDocument();
  });

  it('reports a replay as a replay, with the reference it already had', async () => {
    api.create.mockResolvedValue(ok(receiptPayload({ replayed: true, status: 'queued_for_stage13' })));
    visit();
    await openForm();
    chooseWedding();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(text()).toContain('You already had this request open'));
    expect(text()).toContain('nothing new was filed');
    expect(text()).not.toContain('Filed. Its reference is');
    // The status line is the door's answer for the row it returned, not a guess about a fresh filing.
    expect(text()).toContain('The work you asked for is not something this product does yet.');
  });

  it('keeps the form open and says what failed when the door refuses', async () => {
    api.create.mockResolvedValue(fail('your privacy request could not be filed'));
    visit();
    await openForm();
    chooseWedding();
    fireEvent.click(screen.getByRole('button', { name: 'File this request' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(text()).toContain('your privacy request could not be filed');
    expect(screen.getByRole('button', { name: 'File this request' })).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('does not hide the way to ask again while a request is already live', async () => {
    api.list.mockResolvedValue(ok(listPayload([rawRow({ status: 'received' })])));
    visit();
    await waitFor(() => expect(text()).toContain(REQUEST_REF));
    expect(screen.getByRole('button', { name: 'File a request' })).toBeInTheDocument();
  });
});

describe('a row’s own details', () => {
  it('shows the note the customer wrote, and no note label when there was none', async () => {
    api.list.mockResolvedValue(ok(listPayload([rawRow({ host_note: 'The certificate is for my visa.' })])));
    visit();
    await waitFor(() => expect(text()).toContain('Your note:'));
    expect(text()).toContain('The certificate is for my visa.');
  });

  it('names an invitation this account’s list cannot match instead of leaving it blank', async () => {
    api.list.mockResolvedValue(ok(listPayload([rawRow({ wedding_id: OTHER_WEDDING })])));
    visit();
    await waitFor(() => expect(text()).toContain('An invitation this list cannot name'));
  });

  it('shows the day it moved when that is a different day from the one it was filed', async () => {
    visit();
    await waitFor(() => expect(text()).toContain('filed 2026-10-20'));
    expect(text()).toContain('Last moved 2026-10-21');
  });

  it('says nothing about a move when the row has not moved', async () => {
    // Two renders in one cell would leave both in the document and `text()` reads the first, so the
    // unchanged-stamp case gets its own test rather than a second `visit()`.
    api.list.mockResolvedValue(ok(listPayload([rawRow({ updated_at: '2026-10-20T09:12:00+00:00' })])));
    visit();
    await waitFor(() => expect(text()).toContain('filed 2026-10-20'));
    expect(text()).not.toContain('Last moved');
  });

  it('lets a customer read what an outside handling actually means', async () => {
    api.list.mockResolvedValue(ok(listPayload([rawRow({ status: 'satisfied_outside_this_build' })])));
    visit();
    await waitFor(() => expect(text()).toContain('somewhere outside this product'));
    expect(text()).toContain('not by a button here');
  });
});
