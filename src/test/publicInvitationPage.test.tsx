// The guest's route, tested the way a guest arrives: a link, no account, one request.
//
// What is pinned here is mostly absence — no sign-in prompt, no second call, no sentence
// that lets a visitor tell a retired link from a mistyped one — because those absences are
// the product promise on the public side, and they are easy to break by adding one
// well-meaning "Log in to see more" to a shared component.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { INVITATION_UNAVAILABLE } from "@/integrations/supabase/publicInvitation";

const resolve = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/publicInvitation", () => ({
  INVITATION_UNAVAILABLE: 'This invitation is not available.',
  resolvePublicInvitation: resolve,
}));

import PublicInvitationPage from "@/pages/PublicInvitation";
import { parsePublicInvitation } from "@/lib/publicInvitation";
import { guestPayload } from "@/test/invitationFixture";

const TOKEN = 'a'.repeat(41) + '_-';
const defaultTitle = document.title;

const visit = () =>
  render(
    <MemoryRouter initialEntries={[`/i/${TOKEN}`]}>
      <Routes>
        <Route path="/i/:token" element={<PublicInvitationPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  resolve.mockReset();
  document.title = defaultTitle;
});

describe("a guest arriving on a working link", () => {
  beforeEach(() => {
    resolve.mockResolvedValue({ data: parsePublicInvitation(guestPayload()), error: null });
  });

  it("reads the invitation through the one resolver, with the link's own credential", async () => {
    visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(TOKEN);
  });

  it("needs no account and offers no place to make one", async () => {
    const { container } = visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    const text = container.textContent ?? '';
    expect(screen.queryByRole('link', { name: /log ?in|sign ?in|dashboard|create account/i })).toBeNull();
    expect(text).toContain('No account or app is needed');
    // The token is a route parameter, so it is in the URL the host shared — but it is not
    // echoed into the page, where a screenshot of it would be a screenshot of a key.
    expect(text).not.toContain(TOKEN);
  });

  it("titles the tab with the family's names, and puts it back on leaving", async () => {
    const { unmount } = visit();
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    // The title is set by a passive effect, which React may flush after the commit that
    // put the names in the DOM — and under a loaded test runner that gap is real. Waiting
    // on the document, rather than the screen, is the same assertion with the effect's own
    // timing respected; it still fails if the title is never set.
    await waitFor(() => expect(document.title).toBe('Arun weds Deepa — wedding invitation'));
    unmount();
    expect(document.title).toBe(defaultTitle);
  });
});

describe("a link that answers nothing", () => {
  const refusals = [
    { data: null, error: INVITATION_UNAVAILABLE },
    { data: null, error: 'This invitation is not available.' },
  ];

  it("says the same sentence for every refusal", async () => {
    for (const response of refusals) {
      resolve.mockResolvedValueOnce(response);
      const { container, unmount } = visit();
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This invitation is not available');
      expect(screen.getByText(/Only the family can share a working link/)).toBeInTheDocument();
      // No path out that invents a workflow: no request access, no support form, no login.
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link', { name: /access|support|help|contact/i })).toBeNull();
      expect(container.textContent).not.toContain('42501');
      unmount();
    }
  });

  it("refuses a bare /i/ without spending a request", async () => {
    render(
      <MemoryRouter initialEntries={['/i/']}>
        <Routes>
          <Route path="/i/:token" element={<PublicInvitationPage />} />
          <Route path="/i/" element={<PublicInvitationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("while the invitation is being read", () => {
  it("announces what is happening", () => {
    resolve.mockReturnValue(new Promise(() => {}));
    visit();
    expect(screen.getByRole('status')).toHaveTextContent('Opening the invitation');
  });
});
