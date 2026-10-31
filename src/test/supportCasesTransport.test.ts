// The host's four doors, seen as a caller — who is knocked on, with which argument, and what a refusal says.
//
// This file tests the transport, not the reader. `src/test/supportCasesShape.test.ts` already drives the six
// parsers in `@/lib/supportCases` against payloads shaped like the deployed bodies, so the fixtures below are
// only as detailed as they need to be to reach a success. What is pinned here is the four things a component
// cannot see from its own mount: the door names, the argument sets, the fixed sentences, and what this module
// deliberately does not offer.
//
// Three of those four are decisions with a customer-facing consequence, which is why they get cells.
//
//   * **The nulls are the call.** `api.get_my_support_cases` means "no filter" and "the door's own page size"
//     by receiving NULL (`supabase/migrations/20261020190100_stage11_support_cases.sql:642-651`), and
//     `api.open_support_case` means "a ticket about the account" the same way (`:92`). PostgREST resolves an
//     RPC by its exact argument set, so omitting a key is a different call and answers 404/PGRST202 — a host
//     with no filter set would see "your support tickets could not be read" on every mount. The cells below
//     assert the key is *present and null*, not absent.
//   * **The idempotency key belongs to the form.** The door replays the ticket it already opened for a key
//     this account used (`:571-574`), so a double-tap cannot put the same paragraph in the queue twice — but
//     only while the key survives the round trip. An adapter that minted its own key per call would keep the
//     UI's `useRef` intact and defeat the door anyway, silently. That is what `carries the caller's key` measures.
//   * **A refusal is one phrase.** PostgREST's `message`, `details` and `hint` name tables, columns and
//     policies; `describe()` reduces the error to a category and a code (`src/lib/safeError.ts`) and the
//     caller gets the sentence the adapter chose. A test asserting the database's prose reached the page would
//     be testing a leak.
//
// What this file does NOT claim. That the caller may only reach their own rows — `:656` filters on
// `requester_user_id` and `:716-718` raises `insufficient_privilege` for somebody else's ref, and both are
// measured by `supabase/tests/stage11/85_support_lifecycle.sql` and the HTTP tier. That the four doors exist
// with these arguments: the generated catalogue in `./types.ts` is the record of the shipped surface, and a
// `rpc()` call this module makes against a name that is not in it is a compile error, which
// `npm run typecheck` runs. And that the module's export list is the product's scope: the thirteen
// queue-side doors of §10 are excluded from `src/` by `product:check`'s own textual rule, and the cell below
// is this file's smaller, matching statement — this module offers four reads and writes, all of them about
// the signed-in account. Nothing here touches a running stack, and a throw out of the client library is not
// handled here, which is the convention of this directory: no adapter catches one, because the transport's
// contract is the resolved `{ data, error }` pair.

import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const schema = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn(() => {
  throw new Error('a support thread has no object behind it: nothing here reads or writes Storage');
}));
const from = vi.hoisted(() => vi.fn(() => {
  throw new Error('tickets are read through the api doors, never from a table with a hand-written filter');
}));

schema.mockReturnValue({ rpc });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { schema, storage: { from: storageFrom }, from },
}));

import * as supportCasesModule from '@/integrations/supabase/supportCases';
import {
  getMySupportCase,
  getMySupportCases,
  openSupportCase,
  replyToSupportCase,
} from '@/integrations/supabase/supportCases';

const CASE_REF = 'SV-MFRV2XQ7';
const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const KEY = '3f2b6c1e-9a44-4d07-8f52-000000000007';

/** The ten keys of `:658-662`, as one list row. */
const summaryRow = (overrides: Record<string, unknown> = {}) => ({
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

/** The envelope `:642-651` writes around the rows. */
const list = (rows: Record<string, unknown>[] = [summaryRow()], overrides: Record<string, unknown> = {}) => ({
  cases: rows,
  status_filter: null,
  limit: 25,
  ...overrides,
});

const thread = (overrides: Record<string, unknown> = {}) => ({
  ...summaryRow({ status: 'awaiting_information' }),
  reply_allowed: true,
  resume_expected: true,
  events: [{
    seq: 1, kind: 'status', actor_kind: 'host', from_status: null,
    to_status: 'open', body: null, created_at: '2026-10-20T09:12:00+00:00',
  }],
  ...overrides,
});

const openReceipt = (overrides: Record<string, unknown> = {}) => ({
  case_ref: CASE_REF, wedding_id: WEDDING, category: 'guest_rsvp', severity: 'high',
  status: 'open', opened_at: '2026-10-20T09:12:00+00:00', replayed: false,
  ...overrides,
});

const replyReceipt = (overrides: Record<string, unknown> = {}) => ({
  case_ref: CASE_REF, status: 'in_progress', seq: 3, replayed: false,
  ...overrides,
});

/** The PostgREST shape of a refusal whose prose describes the database. */
const REFUSAL = {
  code: '42501',
  message: 'the caller may not read this support case',
  details: 'Policy on table support_cases blocks the read.',
  hint: 'Re-check auth.uid() against support_cases.requester_user_id',
};

let warnSpy: MockInstance;

beforeEach(() => {
  rpc.mockReset();
  schema.mockClear();
  storageFrom.mockClear();
  from.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the list door', () => {
  it('sends both filters as explicit nulls when the caller asks for everything', async () => {
    rpc.mockResolvedValue({ data: list(), error: null });

    const result = await getMySupportCases();

    expect(schema).toHaveBeenCalledWith('api');
    expect(schema).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    // Not `{ p_status: undefined }`, and not `{}`: the argument set is how PostgREST picks the overload, so
    // a missing key is a 404 rather than the unfiltered list. The keys have to arrive, holding null.
    expect(rpc).toHaveBeenCalledWith('get_my_support_cases', { p_status: null, p_limit: null });
    expect(result.error).toBeNull();
    expect(result.data?.cases).toHaveLength(1);
  });

  it('passes a status and a page size through unchanged, including the door default', async () => {
    rpc.mockResolvedValue({ data: list([summaryRow()], { status_filter: 'open', limit: 50 }), error: null });

    const { data } = await getMySupportCases('open', 50);

    expect(rpc).toHaveBeenCalledWith('get_my_support_cases', { p_status: 'open', p_limit: 50 });
    expect(data?.statusFilter).toBe('open');
    expect(data?.limit).toBe(50);
  });

  it('treats an account that has never written to support as an answer', async () => {
    // `:657` is a plain filtered aggregate: no rows is a real result, and a page that said "we could not read
    // your tickets" to a customer who has none would teach them the product is broken.
    rpc.mockResolvedValue({ data: list([]), error: null });

    const result = await getMySupportCases();
    expect(result.error).toBeNull();
    expect(result.data?.cases).toEqual([]);
  });

  it('hands the component the host’s names, not the column names', async () => {
    rpc.mockResolvedValue({ data: list(), error: null });
    const { data } = await getMySupportCases();
    expect(Object.keys(data!).sort()).toEqual(['cases', 'limit', 'statusFilter']);
    expect(Object.keys(data!.cases[0]).sort()).toEqual([
      'caseRef', 'category', 'hostSummary', 'openedAt', 'resolutionCode', 'resolvedAt', 'severity',
      'status', 'updatedAt', 'weddingId',
    ]);
    expect(JSON.stringify(data)).not.toContain('host_summary');
  });
});

describe('the thread door', () => {
  it('knocks with the ref and nothing else', async () => {
    rpc.mockResolvedValue({ data: thread(), error: null });

    const result = await getMySupportCase(CASE_REF);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_my_support_case', { p_case_ref: CASE_REF });
    expect(result.error).toBeNull();
    expect(result.data?.replyAllowed).toBe(true);
    expect(result.data?.events).toHaveLength(1);
  });

  it('gives an account-level ticket its null wedding as an answer', async () => {
    // `:92` documents `wedding_id IS NULL` as the shape of a case about the account rather than an invitation,
    // so the page has to be able to tell "about my account" from "about this wedding" — both are data.
    rpc.mockResolvedValue({ data: thread({ wedding_id: null }), error: null });

    const { data, error } = await getMySupportCase(CASE_REF);
    expect(error).toBeNull();
    expect(data?.weddingId).toBeNull();
  });
});

describe('the open door', () => {
  it('sends the wedding id it was given, with the other four as text', async () => {
    rpc.mockResolvedValue({ data: openReceipt(), error: null });

    const result = await openSupportCase({
      weddingId: WEDDING, category: 'guest_rsvp', severity: 'high',
      summary: 'Three guests say their RSVP link is a 404.', idempotencyKey: KEY,
    });

    expect(rpc).toHaveBeenCalledWith('open_support_case', {
      p_wedding_id: WEDDING, p_category: 'guest_rsvp', p_severity: 'high',
      p_summary: 'Three guests say their RSVP link is a 404.', p_idempotency_key: KEY,
    });
    expect(result.error).toBeNull();
    expect(result.data?.caseRef).toBe(CASE_REF);
    expect(result.data?.replayed).toBe(false);
  });

  it('sends an explicit null for a ticket about the account', async () => {
    rpc.mockResolvedValue({ data: openReceipt({ wedding_id: null }), error: null });

    const result = await openSupportCase({
      weddingId: null, category: 'privacy_data_request', severity: 'normal',
      summary: 'Please remove my household from your records.', idempotencyKey: KEY,
    });

    expect(rpc).toHaveBeenCalledWith('open_support_case', {
      p_wedding_id: null, p_category: 'privacy_data_request', p_severity: 'normal',
      p_summary: 'Please remove my household from your records.', p_idempotency_key: KEY,
    });
    // The regression this slice was found by: the receipt of an account-level ticket carries
    // `wedding_id: null`, and a reader that refused that null told a host their message could not be sent one
    // second after the door had written the row.
    expect(result.error).toBeNull();
    expect(result.data?.weddingId).toBeNull();
  });

  it('reports a replay as a replay', async () => {
    rpc.mockResolvedValue({ data: openReceipt({ replayed: true }), error: null });

    const { data } = await openSupportCase({
      weddingId: WEDDING, category: 'guest_rsvp', severity: 'high', summary: 'Again.', idempotencyKey: KEY,
    });
    expect(data?.replayed).toBe(true);
  });

  it('carries the caller’s key through two attempts, unchanged and unreplaced', async () => {
    // The door's duplicate protection is the host's promise, and it only holds while the key identifies the
    // submission rather than the attempt. Minting inside this function would be invisible to the form and
    // fatal to the guarantee.
    rpc.mockResolvedValue({ data: openReceipt(), error: null });

    const input = {
      weddingId: WEDDING, category: 'other' as const, severity: 'normal' as const,
      summary: 'One paragraph, sent twice.', idempotencyKey: KEY,
    };
    await openSupportCase(input);
    await openSupportCase(input);

    expect(rpc).toHaveBeenCalledTimes(2);
    const keys = rpc.mock.calls.map(([, args]) => (args as { p_idempotency_key: string }).p_idempotency_key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(KEY);
  });
});

describe('the reply door', () => {
  it('knocks with the ref, the body and the key', async () => {
    rpc.mockResolvedValue({ data: replyReceipt(), error: null });

    const result = await replyToSupportCase({ caseRef: CASE_REF, body: 'Here is the screenshot.', idempotencyKey: KEY });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reply_to_support_case', {
      p_case_ref: CASE_REF, p_body: 'Here is the screenshot.', p_idempotency_key: KEY,
    });
    expect(result.error).toBeNull();
    expect(result.data?.seq).toBe(3);
    expect(result.data?.status).toBe('in_progress');
  });

  it('passes a closed thread’s refusal through as itself', async () => {
    // `:823-826` raises `check_violation` for a reply on a closed case. This file does not soften that into a
    // guess about whether the message landed: the page avoids offering a box at all, and a caller that races
    // the door gets one sentence and a `rejected` log line.
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'a closed support case takes no further messages', details: null, hint: null },
    });

    const result = await replyToSupportCase({ caseRef: CASE_REF, body: 'One more thing.', idempotencyKey: KEY });
    expect(result.data).toBeNull();
    expect(result.error).toBe('your reply could not be sent');
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('rejected');
    expect(logged).toContain('23514');
    expect(logged).not.toContain('takes no further messages');
  });
});

describe('what this module is not', () => {
  it('offers exactly the four host doors, in the host’s names', () => {
    expect(Object.keys(supportCasesModule).sort()).toEqual([
      'getMySupportCase', 'getMySupportCases', 'openSupportCase', 'replyToSupportCase',
    ]);
  });

  it('never reaches for a table or an object', async () => {
    rpc.mockResolvedValue({ data: list(), error: null });
    await getMySupportCases();
    rpc.mockResolvedValue({ data: thread(), error: null });
    await getMySupportCase(CASE_REF);
    rpc.mockResolvedValue({ data: openReceipt(), error: null });
    await openSupportCase({ weddingId: null, category: 'other', severity: 'low', summary: 'x', idempotencyKey: KEY });
    rpc.mockResolvedValue({ data: replyReceipt(), error: null });
    await replyToSupportCase({ caseRef: CASE_REF, body: 'x', idempotencyKey: KEY });

    // A hand-written `.from('support_cases')` would be a second, unfiltered way into the same rows — the door
    // exists so that the RLS law has one shape rather than two. `from` throws, so this is a passing assertion.
    expect(from).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(schema).toHaveBeenCalledTimes(4);
  });

  it('caches nothing: one call per read, however often the page mounts', async () => {
    rpc.mockResolvedValue({ data: list(), error: null });
    await getMySupportCases();
    await getMySupportCases();
    await getMySupportCases();
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe('what a refusal is allowed to say', () => {
  const doors: ReadonlyArray<{
    name: string;
    phrase: string;
    payload: Record<string, unknown>;
    call: () => Promise<{ data: unknown; error: string | null }>;
  }> = [
    {
      name: 'the list', payload: list(),
      phrase: 'your support tickets could not be read',
      call: () => getMySupportCases(),
    },
    {
      name: 'the thread', payload: thread(),
      phrase: 'this support thread could not be read',
      call: () => getMySupportCase(CASE_REF),
    },
    {
      name: 'the open receipt', payload: openReceipt(),
      phrase: 'your message could not be sent',
      call: () => openSupportCase({
        weddingId: WEDDING, category: 'other', severity: 'normal', summary: 'x', idempotencyKey: KEY,
      }),
    },
    {
      name: 'the reply receipt', payload: replyReceipt(),
      phrase: 'your reply could not be sent',
      call: () => replyToSupportCase({ caseRef: CASE_REF, body: 'x', idempotencyKey: KEY }),
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

      // `details` and `hint` name a table, a column and a policy expression. Neither the returned pair nor the
      // single console line may carry them; only the category and the code cross.
      expect(JSON.stringify(result), door.name).not.toContain('support_cases');
      expect(JSON.stringify(result), door.name).not.toContain('requester_user_id');
      expect(JSON.stringify(result), door.name).not.toContain('auth.uid()');
      expect(JSON.stringify(result), door.name).not.toContain('Policy on table');
      const logged = warnSpy.mock.calls.flat().join(' ');
      expect(logged, door.name).toContain('42501');
      expect(logged, door.name).toContain('forbidden');
      expect(logged, door.name).not.toContain('support_cases');
      expect(logged, door.name).not.toContain('Policy on table');
      expect(logged, door.name).toBe(`[supportCases] ${door.phrase} (forbidden, code 42501)`);
    }
  });

  it('refuses a payload that changed shape instead of rendering half of a promise', async () => {
    // Both halves of the reader's rule seen from the door: a key that stopped arriving, a value of the wrong
    // kind, and an envelope that is not an object at all. None of them is a screen; all of them are one sentence.
    const broken: unknown[] = [
      {}, null, 'open', [],
      list([], { cases: 'none' }),
      list([], { limit: null }),
    ];
    for (const door of doors) {
      for (const payload of broken) {
        rpc.mockResolvedValue({ data: payload, error: null });
        const result = await door.call();
        expect(result.data, `${door.name} ${JSON.stringify(payload)}`).toBeNull();
        expect(result.error, `${door.name} ${JSON.stringify(payload)}`).toBe(door.phrase);
      }
    }
  });

  it('logs code none for an unreadable payload, so a shape change and a refusal stay tellable apart', async () => {
    for (const door of doors) {
      rpc.mockResolvedValue({ data: door.payload, error: null });
      const good = await door.call();
      expect(good.data, door.name).not.toBeNull();

      warnSpy.mockClear();
      rpc.mockResolvedValue({ data: [], error: null });
      await door.call();
      const logged = warnSpy.mock.calls.flat().join(' ');
      expect(logged, door.name).toContain('code none');
      expect(logged, door.name).toContain('unexpected');
      expect(logged, door.name).toContain('[supportCases]');
    }
  });
});
