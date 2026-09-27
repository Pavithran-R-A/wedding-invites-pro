// Stage 3 closure repair §4: a guest's link must not mount the session machinery.
//
// The finding this file holds shut is a shape one, not a crash: `/i/:token` used to sit
// inside `AuthProvider`, whose first act on mounting is `supabase.auth.onAuthStateChange(...)`
// and `supabase.auth.getSession()`. So a visitor reading an invitation on a borrowed phone
// was making the app look for a session on that phone, subscribing to changes on it, and
// writing what it found — for a page that needs no session at all, and gets its one fact
// from an anonymous RPC.
//
// These tests run the real `App`, with `@supabase/supabase-js` replaced by a recorder, which
// is the only seam where "nothing was asked" is observable: a page that renders correctly
// while quietly reading a stranger's session would pass any assertion about what it shows.
// What the recorder cannot see is the wire, and that half — one request, the anon key, the
// token header, no `Authorization` — is qualified over real PostgREST in `supabase/tests/api/`
// and in the browser recheck recorded in `docs/audits/stage-3-public-invitation.md`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { guestPayload } from "@/test/invitationFixture";

const TOKEN = 'a'.repeat(41) + '_-';
const SESSION_KEY = 'sb-localvivaahvarnam-auth-token';

/** Every `createClient` call and every method call on the client it made, in order. */
const log = vi.hoisted(() => ({
  clients: [] as Array<{ url: unknown; key: unknown; options: Record<string, unknown> | undefined }>,
  calls: [] as string[],
  rpc: [] as Array<{ schema: string; fn: string }>,
  authCalls: [] as string[],
}));

/** A declaration, not a const: the mock factory runs while `@/App` is being imported, which
 *  is before any statement in this file has executed. Supabase's `createClient(url, key,
 *  options)` is what the app calls, so the recorder takes the same three arguments. */
function makeClient(url: unknown, key: unknown, options?: Record<string, unknown>) {
  log.clients.push({ url, key, options });
  const client = {
    auth: {
      getSession: () => {
        log.authCalls.push('getSession');
        return Promise.resolve({ data: { session: null }, error: null });
      },
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        log.authCalls.push('onAuthStateChange');
        callback('INITIAL_SESSION', null);
        return { data: { subscription: { unsubscribe: () => log.authCalls.push('unsubscribe') } } };
      },
      signOut: () => {
        log.authCalls.push('signOut');
        return Promise.resolve({ error: null });
      },
    },
    schema: (name: string) => ({
      rpc: (fn: string) => {
        log.rpc.push({ schema: name, fn });
        log.calls.push(`rpc:${fn}`);
        return Promise.resolve({ data: guestPayload(), error: null });
      },
    }),
    from: (table: string) => {
      log.calls.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'in', 'limit', 'single', 'maybeSingle', 'is', 'gte', 'lte', 'gte_', 'or', 'not', 'neq', 'gt', 'lt', 'desc', 'ascending']) {
        chain[method] = () => chain;
      }
      chain.then = (onfulfilled: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onfulfilled);
      return chain;
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: new Error('no edge function is used') }) },
  };
  return client;
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: unknown, key: unknown, options?: Record<string, unknown>) =>
    makeClient(url, key, options),
}));

import App from '@/App';

const at = (path: string) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

beforeEach(() => {
  log.clients.length = 0;
  log.calls.length = 0;
  log.rpc.length = 0;
  log.authCalls.length = 0;
  localStorage.clear();
});

describe('a guest arriving on a shared link', () => {
  it('reads the invitation without asking the device for a session', async () => {
    at(`/i/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());

    // A. and B. The two calls `AuthProvider` makes on mount were not made at all.
    expect(log.authCalls).toEqual([]);
    // D. One RPC, on the exposed schema, and the page asked for nothing else.
    expect(log.rpc).toEqual([{ schema: 'api', fn: 'resolve_public_invitation' }]);
    expect(log.calls).toEqual(['rpc:resolve_public_invitation']);
  });

  it('builds its client so it can neither keep nor send a session', async () => {
    at(`/i/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    const resolver = log.clients.find(client =>
      (client.options as { global?: { headers?: Record<string, string> } })?.global?.headers !== undefined,
    );
    expect(resolver).toBeDefined();
    expect(resolver?.options).toMatchObject({
      global: { headers: { 'x-invitation-token': TOKEN } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // The credential travels in a header only. Nothing in these options can add an
    // `Authorization` value, because nothing in them reads a session.
    expect(JSON.stringify(resolver?.options)).not.toMatch(/authorization|bearer/i);
  });

  it('leaves a session that was already on the device alone', async () => {
    // E. The borrowed-phone case: somebody signed in to this app on the phone earlier, and
    // the guest opening a link is not them.
    const stored = { access_token: 'a-host-access-token', refresh_token: 'a-host-refresh-token' };
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    at(`/i/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());

    expect(log.authCalls).toEqual([]);
    // C. Nothing written, nothing read: the guest's visit leaves the device as it found it.
    expect(localStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(stored));
    expect(Object.keys(localStorage)).toEqual([SESSION_KEY]);
  });

  it('offers no way in, on the page or in the requests it makes', async () => {
    const { container } = at(`/i/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(container.textContent).toContain('No account or app is needed to read this invitation.');
    expect(screen.queryByRole('link', { name: /log ?in|sign ?in|dashboard/i })).toBeNull();
  });
});

describe('the account half of the app', () => {
  it('still reads the session for a route that needs one', async () => {
    at('/dashboard');
    // F. The split moved the machinery out of the guest's tree, not out of the app: a
    // protected route still subscribes and still asks who is signed in.
    await waitFor(() => expect(log.authCalls).toContain('onAuthStateChange'));
    expect(log.authCalls).toContain('getSession');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument());
  });
});
