// The two privacy doors, seen as a caller — the argument sets, the two sentences, and what is not offered.
//
// The transport half of the pair with `src/test/privacyRequestsShape.test.ts`: that file asks whether a payload
// is the one the deployed body writes, this file asks whether this module knocks on the right door with the
// right keys. Both doors are one-line `SECURITY INVOKER` wrappers over bodies that re-derive the caller from
// `auth.uid()` (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:308` and `:364`, granted at
// `:320` and `:373` to `authenticated` and to nobody else), so there is no requester argument that could be
// honoured even if a caller invented one.
//
// Three cells carry the weight, because each is a decision a future edit could quietly undo.
//
//   * **The empty argument set.** `api.get_my_privacy_requests()` takes no parameters, and the client still has
//     to send `{}` — PostgREST resolves by exact argument set, so a missing body is a different call.
//   * **`p_note` present, holding null.** The filing door's third parameter is required to *arrive*
//     (`:245-248`), and an absent key answers 404/PGRST202 rather than "no note". The page turns an empty box
//     into null (`src/pages/MyData.tsx:126`); this adapter turns an omitted one into null and rewrites nothing
//     else, so the door's blank-note refusal (`:265-268`) stays reachable rather than being hidden by a trim.
//   * **Two exports, both about this account.** The queue-side doors of the same migration are excluded from
//     `src/` by `product:check`'s textual rule; this cell is the matching local statement that this module
//     offers a read and a filing and nothing else — no advance, no satisfaction, no decline.
//
// What this file does NOT claim. That the caller may only see their own rows (`:352`) or only file about their
// own weddings (`:269-272`) — `supabase/tests/stage11/90_privacy_intake.sql` and the host cases of
// `supabase/tests/api/stage11_operations_http.test.mjs` measure those against a running stack. That the pages
// behave: `src/test/myDataPage.test.tsx` does. And nothing here is a claim that a copy was produced or a row
// deleted, which is the limitation both doors document (`:1`, `:328-330`) and which the shape test refuses in
// the shipped sentences.

import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const schema = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn(() => {
  throw new Error('a privacy request is a row behind an api door; nothing here touches Storage');
}));
const from = vi.hoisted(() => vi.fn(() => {
  throw new Error('requests are read through api.get_my_privacy_requests, never from a table');
}));

schema.mockReturnValue({ rpc });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { schema, storage: { from: storageFrom }, from },
}));

import * as privacyModule from '@/integrations/supabase/privacyRequests';
import {
  createPrivacyRequest,
  getMyPrivacyRequests,
} from '@/integrations/supabase/privacyRequests';

const REQUEST_REF = 'PR-MFRV2XQ7';
const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';

/** The seven keys of `:348-350`, as one list row. */
const requestRow = (overrides: Record<string, unknown> = {}) => ({
  request_ref: REQUEST_REF, wedding_id: WEDDING, kind: 'export', status: 'received',
  host_note: 'Please include the RSVP answers.',
  requested_at: '2026-10-20T09:12:00+00:00', updated_at: '2026-10-20T09:12:00+00:00',
  ...overrides,
});

const envelope = (rows: Record<string, unknown>[] = [requestRow()]) => ({
  requests: rows, count: rows.length,
});

const receipt = (overrides: Record<string, unknown> = {}) => ({
  request_ref: REQUEST_REF, wedding_id: WEDDING, kind: 'erasure', status: 'received',
  requested_at: '2026-10-20T09:12:00+00:00', replayed: false,
  ...overrides,
});

/** The PostgREST shape of the ownership refusal at `:269-272`, with the prose that describes the schema. */
const REFUSAL = {
  code: '42501',
  message: 'the caller may not open a privacy request about this wedding',
  details: 'Policy on table privacy_requests blocks the read.',
  hint: 'Re-check auth.uid() against privacy_requests.requester_user_id',
};

let warnSpy: MockInstance;

beforeEach(() => {
  rpc.mockReset();
  schema.mockClear();
  storageFrom.mockClear();
  from.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the read door', () => {
  it('knocks once, on the api schema, with an explicit empty argument set', async () => {
    rpc.mockResolvedValue({ data: envelope(), error: null });

    const result = await getMyPrivacyRequests();

    expect(schema).toHaveBeenCalledWith('api');
    expect(schema).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    // `{}` and not `undefined`: the no-parameter overload is resolved by the argument set, so a call that
    // sends no body at all is a different request than the one this door answers.
    expect(rpc).toHaveBeenCalledWith('get_my_privacy_requests', {});
    expect(result.error).toBeNull();
    expect(result.data?.count).toBe(1);
  });

  it('hands the page the host’s names and nothing else', async () => {
    rpc.mockResolvedValue({ data: envelope(), error: null });
    const { data } = await getMyPrivacyRequests();
    expect(Object.keys(data!).sort()).toEqual(['count', 'requests']);
    expect(Object.keys(data!.requests[0]).sort()).toEqual([
      'hostNote', 'kind', 'requestRef', 'requestedAt', 'status', 'updatedAt', 'weddingId',
    ]);
    // The privacy boundary of `:345-346` is a fact about the projection, and the strongest thing a transport
    // test can say about it is that this layer is not where a dropped field comes back: the reader copies the
    // seven documented names and ignores any other key a payload happens to carry.
    rpc.mockResolvedValue({
      data: envelope([{ ...requestRow(), identity_check_note: 'passport, verified by phone call' }]),
      error: null,
    });
    const widened = await getMyPrivacyRequests();
    expect(widened.error).toBeNull();
    expect(Object.keys(widened.data!.requests[0])).toHaveLength(7);
    expect(JSON.stringify(widened.data)).not.toContain('verified by phone call');
  });

  it('treats an account that has asked for nothing as an answer', async () => {
    rpc.mockResolvedValue({ data: { requests: [], count: 0 }, error: null });
    const result = await getMyPrivacyRequests();
    expect(result.error).toBeNull();
    expect(result.data?.requests).toEqual([]);
    expect(result.data?.count).toBe(0);
  });

  it('makes a fresh call every time', async () => {
    rpc.mockResolvedValue({ data: envelope(), error: null });
    await getMyPrivacyRequests();
    await getMyPrivacyRequests();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('the filing door', () => {
  it('sends the wedding, the kind and an explicit null for an absent note', async () => {
    rpc.mockResolvedValue({ data: receipt(), error: null });

    const result = await createPrivacyRequest({ weddingId: WEDDING, kind: 'erasure' });

    expect(rpc).toHaveBeenCalledWith('create_privacy_request', {
      p_wedding_id: WEDDING, p_kind: 'erasure', p_note: null,
    });
    expect(result.error).toBeNull();
    expect(result.data?.requestRef).toBe(REQUEST_REF);
    expect(result.data?.replayed).toBe(false);
  });

  it('passes a note through unchanged, including one the host would not want tidied', async () => {
    rpc.mockResolvedValue({ data: receipt(), error: null });

    await createPrivacyRequest({ weddingId: WEDDING, kind: 'export', note: '  Two families, one PDF  ' });

    // No trim and no rewriting of the host's own words at the transport layer: `:292` btrims on insert, and a
    // blank note is the door's refusal to make (`:265-268`), not this file's to pre-empt.
    const [, args] = rpc.mock.calls[0];
    expect((args as { p_note: string }).p_note).toBe('  Two families, one PDF  ');
  });

  it('honours the null the page sends for an empty box', async () => {
    rpc.mockResolvedValue({ data: receipt(), error: null });
    await createPrivacyRequest({ weddingId: WEDDING, kind: 'export', note: null });
    expect(rpc).toHaveBeenCalledWith('create_privacy_request', {
      p_wedding_id: WEDDING, p_kind: 'export', p_note: null,
    });
  });

  it('reports a replay as a replay, because the queue entry was not duplicated', async () => {
    rpc.mockResolvedValue({ data: receipt({ replayed: true }), error: null });
    const { data } = await createPrivacyRequest({ weddingId: WEDDING, kind: 'erasure' });
    expect(data?.replayed).toBe(true);
  });

  it('carries a blank note to the door as the refusal it is', async () => {
    // The other half of the same rule: an empty string is not rewritten into null here, so a caller that
    // forgot to do what `src/pages/MyData.tsx:126` does meets the door's own check_violation and one sentence.
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'a privacy request note is either real text or absent', details: null, hint: null },
    });

    const result = await createPrivacyRequest({ weddingId: WEDDING, kind: 'export', note: '' });
    expect(rpc).toHaveBeenCalledWith('create_privacy_request', {
      p_wedding_id: WEDDING, p_kind: 'export', p_note: '',
    });
    expect(result.data).toBeNull();
    expect(result.error).toBe('your privacy request could not be filed');
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('rejected');
  });

  it('does not invent a shape for a request with no wedding', async () => {
    // There is no account-level privacy request (`:46` is NOT NULL), and this layer's answer to that is not a
    // client-side special case: a null still travels as the key, and the door refuses it at `:269-272`. A page
    // that let a host file "everything about me" would be the one thing this migration cannot back.
    rpc.mockResolvedValue({ data: receipt(), error: null });
    await createPrivacyRequest({ weddingId: null as unknown as string, kind: 'export' });
    expect(rpc).toHaveBeenCalledWith('create_privacy_request', {
      p_wedding_id: null, p_kind: 'export', p_note: null,
    });
  });
});

describe('what this module is not', () => {
  it('offers exactly the two host doors', () => {
    expect(Object.keys(privacyModule).sort()).toEqual(['createPrivacyRequest', 'getMyPrivacyRequests']);
  });

  it('never reaches for a table or an object', async () => {
    rpc.mockResolvedValue({ data: envelope(), error: null });
    await getMyPrivacyRequests();
    rpc.mockResolvedValue({ data: receipt(), error: null });
    await createPrivacyRequest({ weddingId: WEDDING, kind: 'export' });
    expect(from).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(schema).toHaveBeenCalledTimes(2);
  });
});

describe('what a refusal is allowed to say', () => {
  const doors = [
    {
      name: 'the list', phrase: 'your privacy requests could not be read',
      call: () => getMyPrivacyRequests(),
    },
    {
      name: 'the receipt', phrase: 'your privacy request could not be filed',
      call: () => createPrivacyRequest({ weddingId: WEDDING, kind: 'export', note: 'x' }),
    },
  ];

  it('answers every door’s refusal with that door’s one fixed sentence', async () => {
    for (const door of doors) {
      rpc.mockResolvedValue({ data: null, error: REFUSAL });
      const result = await door.call();
      expect(result.data, door.name).toBeNull();
      expect(result.error, door.name).toBe(door.phrase);
    }
  });

  it('keeps the database’s own prose out of the caller’s hands and out of the log line', async () => {
    for (const door of doors) {
      warnSpy.mockClear();
      rpc.mockResolvedValue({ data: null, error: REFUSAL });
      const result = await door.call();

      expect(JSON.stringify(result), door.name).not.toContain('privacy_requests');
      expect(JSON.stringify(result), door.name).not.toContain('requester_user_id');
      expect(JSON.stringify(result), door.name).not.toContain('auth.uid()');
      const logged = warnSpy.mock.calls.flat().join(' ');
      expect(logged, door.name).toBe(`[privacyRequests] ${door.phrase} (forbidden, code 42501)`);
      expect(logged, door.name).not.toContain('Policy on table');
    }
  });

  it('refuses a payload that changed shape instead of rendering half of a promise', async () => {
    for (const door of doors) {
      for (const payload of [{}, null, 'received', [], envelope([{ request_ref: REQUEST_REF }])]) {
        rpc.mockResolvedValue({ data: payload, error: null });
        const result = await door.call();
        expect(result.data, `${door.name} ${JSON.stringify(payload)}`).toBeNull();
        expect(result.error, `${door.name} ${JSON.stringify(payload)}`).toBe(door.phrase);
      }
    }
  });

  it('logs code none for an unreadable payload, so a shape change and a refusal stay tellable apart', async () => {
    for (const door of doors) {
      warnSpy.mockClear();
      rpc.mockResolvedValue({ data: [], error: null });
      await door.call();
      const logged = warnSpy.mock.calls.flat().join(' ');
      expect(logged, door.name).toContain('code none');
      expect(logged, door.name).toContain('unexpected');
    }
  });
});
