// What the sign-up screen is allowed to promise about email.
//
// `supabase/config.toml:72` sets `enable_confirmations = false`, so GoTrue hands back a usable
// session from `signUp` on this stack and there is no confirmation mail to wait for. The copy used
// to say "Check your email to confirm your account." unconditionally, which promised a message this
// stack is configured never to send; §36's sign-up journey measured that there is no confirmation
// step, and the page now branches on the one fact that decides it — whether a session came back.
//
// The branch is the regression surface, so both arms are pinned: a run that only tests the local
// case would pass again the moment someone sets `enable_confirmations = true` and leaves the copy
// hard-wired to "nothing was emailed". Reading the words out of the `toast()` call rather than the
// rendered card keeps the assertion on the sentence the host is shown, not on Radix's markup.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const signUp = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp } },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import Signup from "@/pages/Signup";

const createAccount = async () => {
  render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "A11y Host" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "host@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "local-only" } });
  // The press kicks off an awaited `signUp`, and the copy decision happens in the continuation
  // after it. Flushing that microtask queue inside `act` is what keeps React's own state updates
  // (the loading flag) from arriving after the test has moved on — an unwrapped update is the
  // warning that a run is measuring a half-committed component.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
  });
  if (toast.mock.calls.length === 0) {
    throw new Error("the sign-up finished and the screen raised no notification to read");
  }
};

const raised = () => toast.mock.calls[0][0] as { title?: string; description?: string };

beforeEach(() => {
  signUp.mockReset();
  toast.mockReset();
  navigate.mockReset();
});

describe("a sign-up that this stack can answer straight away", () => {
  it("does not tell the host to look for an email, and says what happens instead", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "issued" } }, error: null });
    await createAccount();
    const words = `${raised().title} ${raised().description}`;
    expect(words).not.toMatch(/check your email|confirm your account/i);
    expect(raised().description).toMatch(/log ?in/i);
    expect(raised().description).toMatch(/nothing was emailed/i);
  });

  it("carries the host to the login screen", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "issued" } }, error: null });
    await createAccount();
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});

describe("a sign-up that is waiting on a confirmation", () => {
  it("tells the host about the email, because now there is one", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    await createAccount();
    expect(raised().description).toMatch(/check your email/i);
    expect(raised().description).not.toMatch(/nothing was emailed/i);
  });
});

describe("a sign-up the server refused", () => {
  it("reports the refusal in the server's own words, and does not navigate", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "User already registered" },
    });
    await createAccount();
    expect(raised().title).toBe("Signup failed");
    expect(raised().description).toBe("User already registered");
    expect(navigate).not.toHaveBeenCalled();
  });
});
