// #254 — the password-recovery landing must survive the auth client's own URL cleanup.
//
// The break this file catches, reproduced against the shipped @supabase/auth-js 2.97.0 in
// ../p1-logs/p5-recovery-repro.mjs: GoTrueClient._getSessionFromURL awaits /user and then sets
// `window.location.hash = ''` (GoTrueClient.js:1542). ResetPassword used to decide `isRecovery`
// from that fragment in a mount-time useEffect, so it won only when its lazy chunk resolved
// before the /user round trip (3 of 8 measured mount orders) and lost outright on refresh, where
// the session is persisted but the fragment is gone and no PASSWORD_RECOVERY re-fires.
//
// The fix records the redirect intent before the client can clear it. These tests exercise the
// real capture module and the real page; only the network boundary (the Supabase auth methods)
// and the toast/router seams are doubled, exactly as signupNotificationTruth.test.tsx does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  captureAuthRedirectIntent,
  readAuthRedirectIntent,
  clearAuthRedirectIntent,
} from "@/lib/authRedirectIntent";

const updateUser = vi.hoisted(() => vi.fn());
const resetPasswordForEmail = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { updateUser, resetPasswordForEmail } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import ResetPassword from "@/pages/ResetPassword";

// The fragment GoTrue's implicit-grant recovery redirect delivers, shaped as the library parses it.
const RECOVERY_HASH =
  "#access_token=eyJhbGciOiJIUzI1NiJ9.recovery.signature" +
  "&refresh_token=refresh&expires_in=3600&token_type=bearer&type=recovery";

const land = (path: string) => {
  window.history.replaceState({}, "", path);
};

beforeEach(() => {
  updateUser.mockReset();
  resetPasswordForEmail.mockReset();
  toast.mockReset();
  navigate.mockReset();
  window.sessionStorage.clear();
  land("/reset-password");
});

describe("the captured auth redirect intent", () => {
  it("records a recovery arrival from the fragment the email link carries", () => {
    land(`/reset-password${RECOVERY_HASH}`);
    captureAuthRedirectIntent();
    expect(readAuthRedirectIntent()).toBe("recovery");
  });

  it("writes nothing for a guest door, leaving a borrowed phone as it was found", () => {
    land(`/i/${"a".repeat(43)}`);
    captureAuthRedirectIntent();
    expect(window.sessionStorage.length).toBe(0);
    expect(readAuthRedirectIntent()).toBeNull();
  });

  it("keeps the intent when the fragment is later cleared and the module re-evaluates", () => {
    land(`/reset-password${RECOVERY_HASH}`);
    captureAuthRedirectIntent();
    // The library clears the hash; a lazy chunk importing the read helper re-runs the capture.
    land("/reset-password");
    captureAuthRedirectIntent();
    expect(readAuthRedirectIntent()).toBe("recovery");
  });

  it("does not treat a bare type=recovery with no token as an arrival", () => {
    land("/reset-password#type=recovery");
    captureAuthRedirectIntent();
    expect(readAuthRedirectIntent()).toBeNull();
  });

  it("clears the intent on demand", () => {
    land(`/reset-password${RECOVERY_HASH}`);
    captureAuthRedirectIntent();
    clearAuthRedirectIntent();
    expect(readAuthRedirectIntent()).toBeNull();
  });
});

describe("the reset-password landing after a recovery email", () => {
  it("offers the new-password form even though the auth client already cleared the fragment", () => {
    land(`/reset-password${RECOVERY_HASH}`);
    captureAuthRedirectIntent();
    // GoTrueClient._getSessionFromURL sets window.location.hash = '' once /user answers.
    land("/reset-password");
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Set New Password" })).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
  });

  it("still offers the email form to a visitor who did not arrive from a recovery link", () => {
    land("/reset-password");
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Reset Password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("carries the host onward and forgets the recovery intent once the password is set", async () => {
    land(`/reset-password${RECOVERY_HASH}`);
    captureAuthRedirectIntent();
    land("/reset-password");
    updateUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "a-new-password" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "a-new-password" });
    expect(readAuthRedirectIntent()).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });
});
