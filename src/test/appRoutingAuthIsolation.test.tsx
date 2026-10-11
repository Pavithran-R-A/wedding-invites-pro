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
//
// Stage 8 adds two doors to the same boundary rather than a new one, and this file is where
// their App-level shape belongs:
//   * `/g/:token` — the household's own link — must clear the same bar `/i/:token` was moved
//     to: no session machinery, one argument-free RPC, its credential in `x-guest-token` and
//     nowhere else, and a borrowed phone left exactly as it was found.
//   * The separation the directive asks for is measurable here and nowhere else in the
//     browser: a wedding credential, a review credential and a household credential each
//     appear on their own door and never on another one's headers. The three doors share a
//     router, so this is the seam where "fully separated" can be observed as an absence.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { guestInvitation, guestPayload } from "@/test/invitationFixture";

const TOKEN = 'a'.repeat(41) + '_-';
const SESSION_KEY = 'sb-localvivaahvarnam-auth-token';
const EVENT_ID = '1c9b4d70-3e62-4a58-bf19-000000000014';

/** Every `createClient` call and every method call on the client it made, in order. */
const log = vi.hoisted(() => ({
  clients: [] as Array<{ url: unknown; key: unknown; options: Record<string, unknown> | undefined }>,
  calls: [] as string[],
  rpc: [] as Array<{ schema: string; fn: string }>,
  /** The same calls with their arguments, kept apart from `rpc` so Stage 3's equality assertion
   *  stays exactly as it was written: this is the half that measures "no door was handed a
   *  credential as an argument", which is what the three checker rules refuse in source. */
  rpcArgs: [] as unknown[][],
  authCalls: [] as string[],
}));

/** The household door's envelope, key for key as `…stage8_guest_invitations_rsvp.sql:684-697` writes
 *  it. Only enough of it is here for the real parser to accept it: this file asks what the app *did*,
 *  and `guestDoorTransport.test.ts` is where the payload's own claims are measured. */
const guestDoorPayload = (): unknown => ({
  available: true,
  guest: {
    household_id: '9d2a6f3e-5b18-4c7a-a0e4-000000000011',
    display_name: 'Raman Family',
    greeting: 'Dear Raman Family',
    expected_party_size: 4,
    version_number: 3,
    can_respond: true,
    responds_until: '2026-11-01T09:00:00+00:00',
    events: [
      {
        event_id: EVENT_ID,
        display_name: 'Wedding ceremony',
        starts_at_local: '2026-11-14T07:30:00',
        ends_at_local: '2026-11-14T09:00:00',
        timezone: 'Asia/Kolkata',
        attending: null,
        party_size: null,
        responded_at: null,
      },
    ],
  },
  invitation: guestInvitation(),
});

/** The reviewer door's envelope, as `…stage7_family_approval_review.sql`'s projection writes it. */
const familyReviewPayload = (): unknown => ({
  available: true,
  review: {
    request_id: '2f6c1a44-7c31-4b1e-9a10-000000000001',
    reviewer_display_name: 'Maami',
    version_number: 7,
    requested_at: '2026-10-07T10:00:00+00:00',
    expires_at: '2026-10-21T10:00:00+00:00',
    invitation: guestInvitation(),
    section_keys: ['welcome'],
  },
});

/** One payload per anonymous door, chosen by the function name the app actually called. A recorder that
 *  answered every RPC with the wedding document would let a page pass by parsing the wrong door's
 *  answer. */
const answerFor = (fn: string): unknown => {
  if (fn === 'resolve_guest_invitation') return guestDoorPayload();
  if (fn === 'resolve_family_review') return familyReviewPayload();
  return guestPayload();
};

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
      rpc: (fn: string, ...args: unknown[]) => {
        log.rpc.push({ schema: name, fn });
        log.rpcArgs.push(args);
        log.calls.push(`rpc:${fn}`);
        return Promise.resolve({ data: answerFor(fn), error: null });
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
  log.rpcArgs.length = 0;
  log.authCalls.length = 0;
  localStorage.clear();
});

/** The headers of the client that carried a credential, as one sorted list of its header names. */
const doorHeaders = () =>
  log.clients
    .map(client => Object.keys((client.options as { global?: { headers?: Record<string, string> } })?.global?.headers ?? {}))
    .filter(names => names.length > 0);

/** The single header map a door's client was built with, for the assertions that name it. */
const onlyDoorHeaders = () => {
  const all = doorHeaders();
  expect(all).toHaveLength(1);
  return (log.clients.find(client =>
    (client.options as { global?: { headers?: Record<string, string> } })?.global?.headers !== undefined,
  )?.options as { global: { headers: Record<string, string> } }).global.headers;
};

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

describe('a household arriving on its own link', () => {
  it('reads its invitation without asking the device for a session', async () => {
    at(`/g/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());

    expect(log.authCalls).toEqual([]);
    expect(log.rpc).toEqual([{ schema: 'api', fn: 'resolve_guest_invitation' }]);
    expect(log.calls).toEqual(['rpc:resolve_guest_invitation']);
    // The door is called with no arguments at all, so the credential has no argument to travel in.
    expect(log.rpcArgs).toEqual([[]]);
  });

  it('builds its client so the credential travels in one header and can keep no session', async () => {
    at(`/g/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(onlyDoorHeaders()).toEqual({ 'x-guest-token': TOKEN });
    const resolver = log.clients.find(client =>
      (client.options as { global?: { headers?: Record<string, string> } })?.global?.headers !== undefined,
    );
    expect(resolver?.options).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(JSON.stringify(resolver?.options)).not.toMatch(/authorization|bearer/i);
    // Nothing written to the device: a household's guest list is not something to leave on a shared
    // phone, and this is the door a family opens from a message thread on somebody's handset.
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('leaves a session that was already on the device alone', async () => {
    const stored = { access_token: 'a-host-access-token', refresh_token: 'a-host-refresh-token' };
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    at(`/g/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());

    expect(log.authCalls).toEqual([]);
    expect(localStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(stored));
    expect(Object.keys(localStorage)).toEqual([SESSION_KEY]);
  });

  it('offers no way in, and says plainly whose replies it can see', async () => {
    const { container } = at(`/g/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());
    expect(container.textContent).toContain('No account or app is needed to read this invitation');
    expect(container.textContent).toContain('only your household can see the replies');
    expect(screen.queryByRole('link', { name: /log ?in|sign ?in|dashboard/i })).toBeNull();
    // The credential is the page's address, so it is in the URL bar — but never printed into the
    // document, where a screenshot of an invitation would be a screenshot of a key.
    expect(container.textContent).not.toContain(TOKEN);
  });
});

describe('the three credentials stay on their own doors', () => {
  /** Each door's own header name, from the three adapters' shipped constants. */
  const HEADER_BY_ROUTE: Record<string, string> = {
    '/i/': 'x-invitation-token',
    '/r/': 'x-review-token',
    '/g/': 'x-guest-token',
  };
  const RPC_BY_ROUTE: Record<string, string> = {
    '/i/': 'resolve_public_invitation',
    '/r/': 'resolve_family_review',
    '/g/': 'resolve_guest_invitation',
  };

  for (const route of Object.keys(HEADER_BY_ROUTE)) {
    it(`${route} carries its own credential and never another door's`, async () => {
      at(`${route}${TOKEN}`);
      await waitFor(() => expect(screen.getByText('Arun weds Deepa')).toBeInTheDocument());

      const headers = onlyDoorHeaders();
      expect(Object.keys(headers)).toEqual([HEADER_BY_ROUTE[route]]);
      expect(headers[HEADER_BY_ROUTE[route]]).toBe(TOKEN);
      // One read, on one door: a page that also asked another door's RPC would be a page that could
      // turn a guest into a reviewer, or a family's answer into a host's panel.
      expect(log.rpc).toEqual([{ schema: 'api', fn: RPC_BY_ROUTE[route] }]);
      expect(log.authCalls).toEqual([]);
    });
  }
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
