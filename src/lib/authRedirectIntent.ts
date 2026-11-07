// The auth redirect intent, captured before the Supabase client can delete it.
//
// @supabase/auth-js owns the URL fragment a recovery/confirmation email lands on. During
// initialization — which begins synchronously inside `createClient` — it reads the fragment,
// awaits `/user`, and then sets `window.location.hash = ''` (GoTrueClient.js:1542) so tokens do
// not linger in the address bar. A page that decides what to show by reading the fragment at
// mount time is therefore racing the client, and loses outright on refresh: the session is
// persisted, the fragment is gone, and `PASSWORD_RECOVERY` does not re-fire.
//
// This module records the *intent* (not the token) the moment it is first evaluated. `main.tsx`
// imports it before `App`, so the capture runs before `createClient` starts clearing the URL.
// The intent lives in tab-scoped sessionStorage: it survives a refresh within the tab, is never
// written for a URL that carries no auth fragment (a guest's borrowed phone is left as found),
// and is cleared once the password is set. It is a UI hint only — the authority to change a
// password remains the session, which `updateUser` requires.

const STORAGE_KEY = "vivaahvarnam-auth-redirect";

export type AuthRedirectKind = "recovery";

/** Read the fragment/search exactly as the library does: hash params first, search overrides. */
const redirectParams = (): URLSearchParams => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  new URLSearchParams(window.location.search).forEach((value, key) => params.set(key, value));
  return params;
};

/**
 * Record a recovery arrival if this URL is one. Idempotent and absence-safe: a later
 * re-evaluation (a lazy chunk importing the read helper) after the client cleared the fragment
 * must not erase the intent captured at load, so this only ever writes, never clears.
 */
export const captureAuthRedirectIntent = (): void => {
  if (typeof window === "undefined") return;
  const params = redirectParams();
  // A real implicit-grant recovery redirect always carries an access token; a bare `type=recovery`
  // with no token is not an arrival the client would honour, so it is not one we record either.
  if (params.get("type") === "recovery" && params.has("access_token")) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "recovery");
    } catch {
      // Storage can be unavailable (private mode, disabled cookies). The page still renders the
      // email form; losing the hint is graceful, never a crash.
    }
  }
};

/** The arrival this tab recorded, or null when it did not come from a recovery link. */
export const readAuthRedirectIntent = (): AuthRedirectKind | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "recovery" ? "recovery" : null;
  } catch {
    return null;
  }
};

/** Forget the intent once the password is set, so a refresh does not re-offer the form. */
export const clearAuthRedirectIntent = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
};

// Capture at first evaluation. main.tsx imports this module before App so this runs ahead of the
// client's fragment cleanup; the guard above makes any later re-evaluation harmless.
captureAuthRedirectIntent();