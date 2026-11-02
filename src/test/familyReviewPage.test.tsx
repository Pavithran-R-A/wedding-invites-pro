// The reviewer's route, tested the way a relative arrives: a pasted link on a phone, no account,
// one read, and exactly one answer.
//
// What is pinned here is mostly the same set of absences the guest page is pinned for — no sign-in
// prompt, no sentence that ranks one refusal above another, no echo of the credential — plus the
// three things only the review half has: the form disappears once an answer is in the database,
// because a second submission from the same link is a thing this product refuses by design; the
// section a note is pinned to is named in the release's own words rather than in the platform's
// slot keys; and the reviewer's name is presented as a signature, not as a verified identity.
//
// The document under test comes from the real parser around the real guest fixture, so a page that
// renders a reviewer a different invitation than a guest would see goes red here rather than in a
// browser at the end of the stage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({ resolve: vi.fn(), submit: vi.fn() }));

vi.mock("@/integrations/supabase/publicReview", () => ({
  REVIEW_UNAVAILABLE: 'This review link is not available.',
  REVIEW_NOT_RECORDED: 'Your note could not be recorded.',
  resolveFamilyReview: (...args: unknown[]) => api.resolve(...args),
  submitFamilyReview: (...args: unknown[]) => api.submit(...args),
}));

import FamilyReviewPage from "@/pages/FamilyReview";
import { parseFamilyReviewDocument } from "@/lib/familyReview";
import { guestInvitation, guestInvitationPacked } from "@/test/invitationFixture";

/** The same 43-character credential the ask mints, used as a route parameter. */
const TOKEN = 'a'.repeat(41) + '_-';
const REVIEW_ID = '2f6c1a44-7c31-4b1e-9a10-000000000001';
const FEEDBACK_ID = '7b4d92e0-1c5a-4f77-8d31-000000000002';

const defaultTitle = document.title;

const documentOf = (invitation: unknown, sectionKeys: string[]) =>
  parseFamilyReviewDocument({
    available: true,
    review: {
      request_id: REVIEW_ID,
      reviewer_display_name: 'Maami',
      version_number: 7,
      requested_at: '2026-10-07T10:00:00+00:00',
      expires_at: '2026-10-21T10:00:00+00:00',
      invitation,
      section_keys: sectionKeys,
    },
  });

const visit = () =>
  render(
    <MemoryRouter initialEntries={[`/r/${TOKEN}`]}>
      <Routes>
        <Route path="/r/:token" element={<FamilyReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );

const readyDocument = () => documentOf(guestInvitation(), ['welcome', 'ceremonies', 'blessing']);

beforeEach(() => {
  api.resolve.mockReset();
  api.submit.mockReset();
  document.title = defaultTitle;
});

describe("a relative arriving on a working link", () => {
  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: readyDocument(), error: null });
  });

  it("reads the review through the one resolver, with the link's own credential", async () => {
    visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(api.resolve).toHaveBeenCalledTimes(1);
    expect(api.resolve).toHaveBeenCalledWith(TOKEN);
  });

  it("draws the guest's document, not a second opinion of it", async () => {
    const { container } = visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    // The same words the guest page prints, from the same renderer.
    expect(container.textContent).toContain('With the blessings of our elders');
    expect(container.textContent).toContain('Sri Kanchi Mahal');
    // The page's one level-1 heading is the document's own title — the same heading the guest
    // route puts on the same words — so a reviewer navigating by headings finds one invitation,
    // not two page-level destinations. `scripts/stage5-a11y-mobile.mjs` counts exactly one `h1`
    // per page for this reason, and the reviewer page had two until this assertion named it.
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent))
      .toEqual(['Arun weds Deepa']);
    expect(screen.getByRole('heading', { name: /Send your answer/i })).toBeInTheDocument();
    // The salutation is still read: it is the page's own text, just not a second title over it.
    expect(screen.getByText('Maami, this invitation is waiting for you')).toBeInTheDocument();
  });

  it("names the version, the day they were asked, and the day the link stops working", async () => {
    visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).toContain('version 7 exactly as they froze it');
    expect(text).toContain('You were asked on');
    expect(text).toContain('This link stops working on');
  });

  it("needs no account, offers none, and says plainly that its signature is not an identity", async () => {
    const { container } = visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    const text = container.textContent ?? '';
    expect(screen.queryByRole('link', { name: /log ?in|sign ?in|dashboard|create account/i })).toBeNull();
    expect(text).toContain('Reading this needs no account');
    expect(text).toContain('not a verified identity');
    // The credential is this page's own address, so it is in the URL bar — but never echoed into
    // the document, where a screenshot of the page would be a screenshot of a key.
    expect(text).not.toContain(TOKEN);
  });

  it("stores nothing on a shared family phone", async () => {
    visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("titles the tab with the family's names, and puts it back on leaving", async () => {
    const { unmount } = visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    await waitFor(() => expect(document.title).toBe('Arun weds Deepa — family review'));
    unmount();
    expect(document.title).toBe(defaultTitle);
  });
});

describe("the answer form, before anything is sent", () => {
  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: readyDocument(), error: null });
  });

  it("asks one choose-one question, and pressing it means choosing it", async () => {
    visit();
    const approve = await screen.findByRole('radio', { name: /I approve this invitation as it is/i });
    const change = screen.getByRole('radio', { name: /Please change something/i });
    expect(approve.getAttribute('name')).toBe('review-decision');
    expect(change.getAttribute('name')).toBe('review-decision');
    // Every actionable control on this page is measured against the label a user aims at, so the
    // radios have to be inside one — a bare 16px radio is the defect `scripts/stage5-a11y-mobile.mjs`
    // counts, and jsdom cannot lay out a box to prove the 44px figure.
    expect(approve.closest('label')).not.toBeNull();
    expect(change.closest('label')).not.toBeNull();
  });

  it("will not send without an answer and a name, and says so", async () => {
    visit();
    const send = await screen.findByRole('button', { name: /Send my answer/i });
    expect(send).toBeDisabled();
    // The hint speaks about the choice that has not been made, so it is checked while that is
    // still true: choosing an answer retires the sentence, and a page that kept saying "choose
    // one of the two answers" beside a chosen one would be lying about its own state.
    expect(screen.getByText('Choose one of the two answers above to send it.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /I approve this invitation as it is/i }));
    expect(screen.queryByText('Choose one of the two answers above to send it.')).toBeNull();
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Your name, as the family should see it/i), {
      target: { value: 'Maami' },
    });
    expect(send).toBeEnabled();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("switches the note between optional and required as the answer changes, in the family's words", async () => {
    visit();
    const note = await screen.findByRole('textbox', { name: /A note for the family \(optional\)/i });
    expect(note).not.toBeRequired();
    fireEvent.click(screen.getByRole('radio', { name: /Please change something/i }));
    const requiredNote = screen.getByRole('textbox', { name: /What should change\?/i });
    expect(requiredNote).toBeRequired();
    expect(screen.getByText(/A request for changes is not recorded without the note/i)).toBeInTheDocument();
  });

  it("names the sections in the release's own words, and the machine key stays on the wire", async () => {
    api.resolve.mockResolvedValue({
      data: documentOf(guestInvitationPacked(), ['ceremonies', 'blessing', 'welcome']),
      error: null,
    });
    visit();
    const picker = await screen.findByRole('combobox', { name: /Which part is this about/i });
    const options = Array.from(picker.querySelectorAll('option'));
    // `ceremonies` carries the release's heading on this document, so that is what the option says.
    expect(options.map(option => option.textContent)).toContain('[placeholder heading from the release]');
    // `blessing` has no heading of its own, so the platform's word for the slot is used.
    expect(options.map(option => option.textContent)).toContain('A blessing');
    // and the values are the keys the database records against.
    expect(Array.from(picker.querySelectorAll('option'), option => option.getAttribute('value')))
      .toEqual(['', 'ceremonies', 'blessing', 'welcome']);
  });

  it("refuses to print a slot key it does not know as if it were a heading", async () => {
    api.resolve.mockResolvedValue({
      data: documentOf(guestInvitation(), ['annadanam']),
      error: null,
    });
    visit();
    const picker = await screen.findByRole('combobox', { name: /Which part is this about/i });
    expect(picker.querySelector('option[value="annadanam"]')?.textContent).toBe('One of the sections');
  });

  it("offers no section question at all when the document names none", async () => {
    api.resolve.mockResolvedValue({
      data: documentOf(guestInvitationV1Document(), []),
      error: null,
    });
    visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: /Which part is this about/i })).toBeNull();
  });
});

/** A document frozen before section lists existed: the parser answers it, with no keys. */
function guestInvitationV1Document() {
  const invitation = guestInvitation() as Record<string, unknown>;
  delete invitation.sections;
  return invitation;
}

describe("sending an answer", () => {
  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: readyDocument(), error: null });
  });

  const fill = (name: string, note = '') => {
    fireEvent.change(screen.getByLabelText(/Your name, as the family should see it/i), {
      target: { value: name },
    });
    if (note !== '') {
      fireEvent.change(screen.getByRole('textbox', { name: /A note for the family \(optional\)|What should change\?/i }), {
        target: { value: note },
      });
    }
  };

  it("sends the decision, the signature, the note and the section it is about", async () => {
    api.submit.mockResolvedValue({
      data: { feedbackId: FEEDBACK_ID, status: 'changes_requested', respondedAt: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
    visit();
    fireEvent.click(await screen.findByRole('radio', { name: /Please change something/i }));
    fill('Maami', 'Move the muhurtham note to the morning.');
    fireEvent.change(screen.getByRole('combobox', { name: /Which part is this about/i }), {
      target: { value: 'ceremonies' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));

    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(api.submit).toHaveBeenCalledWith(TOKEN, {
      decision: 'changes_requested',
      reviewerLabel: 'Maami',
      message: 'Move the muhurtham note to the morning.',
      sectionKey: 'ceremonies',
    });
  });

  it("sends the absences the schema records for an approval with no note", async () => {
    api.submit.mockResolvedValue({
      data: { feedbackId: FEEDBACK_ID, status: 'approved', respondedAt: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
    visit();
    fireEvent.click(await screen.findByRole('radio', { name: /I approve this invitation as it is/i }));
    fill('  Maami  ');
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));

    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(api.submit).toHaveBeenCalledWith(TOKEN, {
      decision: 'approved',
      reviewerLabel: 'Maami',
      message: null,
      sectionKey: null,
    });
  });

  it("replaces the whole form once the answer is in, because a second send is refused by design", async () => {
    api.submit.mockResolvedValue({
      data: { feedbackId: FEEDBACK_ID, status: 'approved', respondedAt: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
    const { container } = visit();
    fireEvent.click(await screen.findByRole('radio', { name: /I approve this invitation as it is/i }));
    fill('Maami');
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));

    await waitFor(() => expect(screen.getByText('Your answer is recorded')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Send my answer/i })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(container.textContent).not.toContain(TOKEN);

    // What they sent, shown back to them in their own words, and pinned to the version they read.
    expect(screen.getByText('You approved this invitation as it stands.')).toBeInTheDocument();
    expect(screen.getByText('Signed as Maami.')).toBeInTheDocument();
    expect(screen.getByText(/recorded against version 7/)).toBeInTheDocument();
    expect(screen.getByText(/changed nothing on that version/)).toBeInTheDocument();
    // The document they approved is still on the page, unchanged.
    expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument();
  });

  it("keeps the note the reviewer typed when the database refuses it", async () => {
    api.submit.mockResolvedValue({
      data: null,
      error: 'that note is too long to record',
    });
    visit();
    fireEvent.click(await screen.findByRole('radio', { name: /Please change something/i }));
    fill('Maami', 'A note far longer than this product records.');
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('that note is too long to record');
    expect(screen.getByRole('textbox', { name: /What should change\?/i })).toHaveValue(
      'A note far longer than this product records.',
    );
    expect(screen.getByRole('button', { name: /Send my answer/i })).toBeEnabled();
    expect(screen.queryByText('Your answer is recorded')).toBeNull();
  });

  it("holds a request for changes back until the note is written, and keeps the server as the authority", async () => {
    api.submit.mockResolvedValue({
      data: { feedbackId: FEEDBACK_ID, status: 'changes_requested', respondedAt: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
    visit();
    fireEvent.click(await screen.findByRole('radio', { name: /Please change something/i }));
    fill('Maami');
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));

    // The note is marked required for this answer and the family's own sentence explains why
    // beside it, so a reviewer is not sent on a round trip for a refusal the page already knows.
    expect(screen.getByRole('textbox', { name: /What should change\?/i })).toBeRequired();
    expect(screen.getByText(/A request for changes is not recorded without the note/i)).toBeInTheDocument();
    expect(api.submit).not.toHaveBeenCalled();
    // The gate is a convenience, not the rule: the workflow refuses the same case on its own
    // (`20261008120000_stage7_family_approval_review.sql:554-560`, pinned at both battery tiers),
    // so the page has no authority to invent one. With a note written, the answer goes out.
    fill('Maami', 'Move the muhurtham note to the morning.');
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    // The gate delayed the answer; it did not veto it.
    await waitFor(() => expect(screen.getByText('Your answer is recorded')).toBeInTheDocument());
  });

  it("folds an unrecognised server sentence into the one phrase the page is allowed to show", async () => {
    api.submit.mockResolvedValue({ data: null, error: 'Your note could not be recorded.' });
    visit();
    fireEvent.click(await screen.findByRole('radio', { name: /I approve this invitation as it is/i }));
    fill('Maami');
    fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your note could not be recorded.');
  });

  it("sends once and never retries on its own", async () => {
    let resolveSubmit: (value: unknown) => void = () => {};
    api.submit.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    visit();
    fireEvent.click(await screen.findByRole('radio', { name: /I approve this invitation as it is/i }));
    fill('Maami');
    const send = screen.getByRole('button', { name: /Send my answer/i });
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(send).toBeDisabled();
    expect(send.textContent).toBe('Sending…');
    resolveSubmit({
      data: { feedbackId: FEEDBACK_ID, status: 'approved', respondedAt: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
    await waitFor(() => expect(screen.getByText('Your answer is recorded')).toBeInTheDocument());
  });
});

describe("a link that answers nothing", () => {
  const refusals = [
    { data: null, error: 'This review link is not available.' },
    { data: null, error: null },
    { data: undefined, error: undefined },
  ];

  it("says the same sentence for a withdrawn, expired, answered, forged or mistyped link", async () => {
    for (const response of refusals) {
      api.resolve.mockResolvedValueOnce(response);
      const { container, unmount } = visit();
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This review link is not available.');
      expect(screen.getByText(/Only the family can send a working review link/)).toBeInTheDocument();
      expect(container.textContent).toContain('Nothing was signed in');
      // No way to tell one refusal from another, and no invented way out of it.
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link', { name: /access|support|help|contact|log ?in/i })).toBeNull();
      expect(container.textContent).not.toContain('42501');
      expect(container.textContent).not.toContain(TOKEN);
      unmount();
    }
  });

  it("refuses a bare /r/ without spending a request", async () => {
    render(
      <MemoryRouter initialEntries={['/r/']}>
        <Routes>
          <Route path="/r/:token" element={<FamilyReviewPage />} />
          <Route path="/r/" element={<FamilyReviewPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(api.resolve).not.toHaveBeenCalled();
  });
});

describe("while the review is being read", () => {
  it("announces what is happening", () => {
    api.resolve.mockReturnValue(new Promise(() => {}));
    visit();
    expect(screen.getByRole('status')).toHaveTextContent('Opening the review');
  });
});

describe("what a crawler is told about this address", () => {
  it("asks for no index and no link before the door has answered", () => {
    // Same rule as the guest's route, and it matters more here: `/r/<credential>` is a reviewer's
    // address, and the page behind it names the household and the relative. The `Disallow: /r/` in
    // `public/robots.txt` is the half that reaches a crawler without a fetch; this meta is the half
    // that reaches one which runs the bundle anyway. Mounted before the resolver answers, so an
    // expired or already-answered review link is no more indexable than a live one.
    const content = () =>
      document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
    api.resolve.mockReturnValue(new Promise(() => {}));
    expect(content()).toBeNull();
    const { unmount } = visit();
    expect(content()).toBe('noindex, nofollow');
    unmount();
    expect(content()).toBeNull();
  });
});
