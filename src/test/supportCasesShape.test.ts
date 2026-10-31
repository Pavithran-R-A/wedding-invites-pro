// The host's own support thread, read as a reader — what may be missing, what may only be strange.
//
// Six parsers sit in `@/lib/supportCases`, and all six answer the same question in the same way: is this the
// object the deployed body writes, or is it a payload from a build whose projection changed? The bodies are
// one `jsonb_build_object` call each (`supabase/migrations/20261020190100_stage11_support_cases.sql:658-662`
// for a list row, `:724-726` for an event, `:734-743` for a thread, `:590-593` and `:571-574` for an open
// receipt, `:847-849` for a reply receipt), and `jsonb_build_object` writes every key it is given, so a key
// that is absent was never in the projection. That is the whole reason a missing key is a refusal here and a
// `null` is an answer: `wedding_id: null` is documented as "this ticket is about my account" (`:92`), while
// an absent `wedding_id` is a body that no longer matches this reader.
//
// The second law is about words. Statuses, categories, severities, resolution codes and event kinds are all
// CHECKed server-side (`:111-118`, `:130-132`, `:349`, `:354`), so today's database cannot produce a word
// outside the lists below — but a future migration can, and the customer-facing failure would be a
// *mapping*: `escalated` printed as "Someone is working on it" is a lie told in the neighbour's words. So an
// unfamiliar word survives the parse and is labelled unfamiliar by the word functions, and only a value of
// the wrong *kind* refuses.
//
// What this file does NOT claim. That a host may only see their own tickets — the `requester_user_id` filters
// (`:664`, `:715`) and the 42501 for somebody else's ref are `supabase/tests/stage11/85_support_lifecycle.sql`
// and the HTTP tier's cases. That the vocabularies are the six/seven/four lists — the SQL tier checks the
// constraints; this file only checks that the reader's lists are *complete* against the migration's own text
// in one place, in `the door and the form agree on the bounds`. And nothing here renders a screen: the
// components' behaviour is `src/test/supportPage.test.tsx`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  IDEMPOTENCY_KEY_SHAPE,
  REPLY_LIMIT,
  SUMMARY_LIMIT,
  SUPPORT_CATEGORIES,
  SUPPORT_RESOLUTION_CODES,
  SUPPORT_SEVERITIES,
  SUPPORT_STATUSES,
  actorWords,
  categoryWords,
  isHostMessage,
  isKnownStatus,
  newIdempotencyKey,
  parseCaseList,
  parseCaseThread,
  parseOpenReceipt,
  parseReplyReceipt,
  resolutionWords,
  severityWords,
  stampDay,
  statusLabel,
  statusWords,
} from '@/lib/supportCases';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261020190100_stage11_support_cases.sql',
);

const CASE_REF = 'SV-MFRV2XQ7';
const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';

/** The ten keys of a list row, in the order `:658-662` writes them. */
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

/** The seven keys of one event, in the order `:724-726` writes them. */
const eventRow = (overrides: Record<string, unknown> = {}) => ({
  seq: 1,
  kind: 'status',
  actor_kind: 'host',
  from_status: null,
  to_status: 'open',
  body: null,
  created_at: '2026-10-20T09:12:00+00:00',
  ...overrides,
});

/** A thread: ten summary keys, the two derived flags of `:741-742`, and the events of `:723-731`. */
const thread = (overrides: Record<string, unknown> = {}) => ({
  ...summaryRow({ status: 'awaiting_information' }),
  reply_allowed: true,
  resume_expected: true,
  events: [eventRow(), eventRow({ seq: 2, kind: 'message_host', body: 'It started after I edited the venue.' })],
  ...overrides,
});

/** What the open door answers (`:590-593`), or replays (`:571-574`). */
const openReceipt = (overrides: Record<string, unknown> = {}) => ({
  case_ref: CASE_REF,
  wedding_id: WEDDING,
  category: 'guest_rsvp',
  severity: 'high',
  status: 'open',
  opened_at: '2026-10-20T09:12:00+00:00',
  replayed: false,
  ...overrides,
});

const replyReceipt = (overrides: Record<string, unknown> = {}) => ({
  case_ref: CASE_REF,
  status: 'in_progress',
  seq: 3,
  replayed: false,
  ...overrides,
});

const LIST_KEYS = ['case_ref', 'wedding_id', 'category', 'severity', 'status', 'resolution_code',
  'host_summary', 'opened_at', 'updated_at', 'resolved_at'] as const;
const EVENT_KEYS = ['seq', 'kind', 'actor_kind', 'from_status', 'to_status', 'body', 'created_at'] as const;

describe('a list row is ten keys or nothing', () => {
  it('reads a well-formed list into the host-side names', () => {
    const list = parseCaseList({ cases: [summaryRow()], status_filter: null, limit: 25 });
    expect(list).not.toBeNull();
    expect(list!.cases).toHaveLength(1);
    expect(list!.statusFilter).toBeNull();
    expect(list!.limit).toBe(25);
    expect(list!.cases[0]).toEqual({
      caseRef: CASE_REF,
      weddingId: WEDDING,
      category: 'render_output',
      severity: 'normal',
      status: 'in_progress',
      resolutionCode: null,
      hostSummary: 'The PDF download stops at the first page.',
      openedAt: '2026-10-20T09:12:00+00:00',
      updatedAt: '2026-10-21T07:45:00+00:00',
      resolvedAt: null,
    });
  });

  it('reads an account with no tickets as an empty list, not as a failure', () => {
    // `jsonb_agg` is coalesced to `[]` at `:657`, so "this account never wrote to support" is a real answer.
    const list = parseCaseList({ cases: [], status_filter: null, limit: 25 });
    expect(list).toEqual({ cases: [], statusFilter: null, limit: 25 });
  });

  it('keeps the filter word the door echoes back', () => {
    const list = parseCaseList({ cases: [summaryRow({ status: 'open' })], status_filter: 'open', limit: 5 });
    expect(list!.statusFilter).toBe('open');
    expect(list!.limit).toBe(5);
  });

  it('refuses a row that lost one key, one at a time', () => {
    // The list has to survive the drop, so each case removes the key from a single row and expects the whole
    // page to refuse — a reader that skipped the broken row would silently shorten a host's ticket list.
    for (const key of LIST_KEYS) {
      const row = { ...summaryRow() } as Record<string, unknown>;
      delete row[key];
      const list = parseCaseList({ cases: [row], status_filter: null, limit: 25 });
      expect(list, `a list row without ${key} is not a list row`).toBeNull();
    }
  });

  it('refuses a list envelope whose own keys are missing or wrong', () => {
    for (const broken of [
      {},
      { cases: 'none', status_filter: null, limit: 25 },
      { cases: [summaryRow()], limit: 25 }, // status_filter absent: present-and-null is the no-filter answer
      { cases: [summaryRow()], status_filter: null },
      { cases: [summaryRow()], status_filter: null, limit: null }, // `:650` guarantees a number
      { cases: [summaryRow()], status_filter: null, limit: 0 },
      { cases: [summaryRow()], status_filter: null, limit: 2.5 },
      { cases: [summaryRow()], status_filter: null, limit: '25' },
      [summaryRow()], // an array where the object of `:658` was promised
      null,
    ]) {
      expect(parseCaseList(broken), JSON.stringify(broken)).toBeNull();
    }
  });

  it('refuses a row whose required text arrived empty', () => {
    // `NOT NULL` plus a non-blank CHECK at `:122-123` means an empty summary cannot exist on disk; a reader
    // that accepted it would be inventing a ticket nobody can triage.
    expect(parseCaseList({ cases: [summaryRow({ host_summary: '' })], status_filter: null, limit: 25 })).toBeNull();
    expect(parseCaseList({ cases: [summaryRow({ case_ref: '' })], status_filter: null, limit: 25 })).toBeNull();
    expect(parseCaseList({ cases: [summaryRow({ status: 7 })], status_filter: null, limit: 25 })).toBeNull();
  });

  it('refuses the whole page when one row is malformed', () => {
    const row = { ...summaryRow() } as Record<string, unknown>;
    delete row.updated_at;
    expect(parseCaseList({ cases: [summaryRow(), row], status_filter: null, limit: 25 })).toBeNull();
  });
});

describe('a thread adds the two flags and the events', () => {
  it('reads a thread in the host’s own names', () => {
    const parsed = parseCaseThread(thread());
    expect(parsed).not.toBeNull();
    expect(parsed!.caseRef).toBe(CASE_REF);
    expect(parsed!.replyAllowed).toBe(true);
    expect(parsed!.resumeExpected).toBe(true);
    expect(parsed!.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(parsed!.events[1].body).toBe('It started after I edited the venue.');
  });

  it('refuses when a derived flag is missing, not a boolean, or null', () => {
    // `:741-742` computes both from the status, so a null here is a body that stopped computing them.
    for (const broken of [
      { reply_allowed: undefined },
      { resume_expected: undefined },
      { reply_allowed: 'true' },
      { reply_allowed: null },
      { resume_expected: 1 },
    ]) {
      expect(parseCaseThread(thread(broken)), JSON.stringify(broken)).toBeNull();
    }
  });

  it('refuses an event that lost one key, one at a time', () => {
    for (const key of EVENT_KEYS) {
      const event = { ...eventRow() } as Record<string, unknown>;
      delete event[key];
      expect(parseCaseThread(thread({ events: [event] })), `an event without ${key}`).toBeNull();
    }
  });

  it('refuses a seq that is not a positive integer', () => {
    for (const seq of [null, 0, -1, 1.5, '1', true]) {
      expect(parseCaseThread(thread({ events: [eventRow({ seq })] })), `seq ${String(seq)}`).toBeNull();
    }
  });

  it('reads a thread whose events are only the opening edge', () => {
    const parsed = parseCaseThread(thread({ events: [eventRow()] }));
    expect(parsed!.events).toHaveLength(1);
  });

  it('keeps an event kind this build has no case for rather than dropping it', () => {
    // The host filter at `:729` means `message_operator`, `assignment` and `operation_link` never arrive
    // today; a reader that skipped an unknown kind would be the thing that lets one through unnoticed.
    const parsed = parseCaseThread(thread({ events: [eventRow({ kind: 'assignment' })] }));
    expect(parsed!.events[0].kind).toBe('assignment');
    expect(parsed!.events[0].body).toBeNull();
  });

  it('refuses a thread that is not the object `:734` builds', () => {
    for (const broken of [null, 'SV-MFRV2XQ7', [], 42, { ...thread(), events: {} }]) {
      expect(parseCaseThread(broken)).toBeNull();
    }
  });
});

describe('a receipt is an answer about money-free work', () => {
  it('reads an opened case and a replayed one as the same shape', () => {
    for (const replayed of [false, true]) {
      const parsed = parseOpenReceipt(openReceipt({ replayed }));
      expect(parsed).toEqual({
        caseRef: CASE_REF,
        weddingId: WEDDING,
        category: 'guest_rsvp',
        severity: 'high',
        status: 'open',
        openedAt: '2026-10-20T09:12:00+00:00',
        replayed,
      });
    }
  });

  it('reads a ticket about the account, which is the documented null at `:92`', () => {
    const parsed = parseOpenReceipt(openReceipt({ wedding_id: null }));
    expect(parsed!.weddingId).toBeNull();
  });

  it('refuses a receipt with a key missing or a flag that is not a flag', () => {
    const noRef = { ...openReceipt() } as Record<string, unknown>;
    delete noRef.case_ref;
    for (const broken of [noRef, { ...openReceipt(), replayed: 'false' }, { ...openReceipt(), replayed: undefined },
      { ...openReceipt(), opened_at: '' }, { ...openReceipt(), severity: null }]) {
      expect(parseOpenReceipt(broken)).toBeNull();
    }
  });

  it('refuses a reply receipt whose seq is not a row number', () => {
    for (const seq of [null, 0, '3', 2.5]) {
      expect(parseReplyReceipt(replyReceipt({ seq })), `seq ${String(seq)}`).toBeNull();
    }
    expect(parseReplyReceipt(replyReceipt({ seq: 3, replayed: true }))).toEqual({
      caseRef: CASE_REF, status: 'in_progress', seq: 3, replayed: true,
    });
  });
});

describe('words a host can be shown', () => {
  it('has a sentence for every word the door can produce', () => {
    for (const category of SUPPORT_CATEGORIES) expect(categoryWords(category)).not.toContain('no words');
    for (const severity of SUPPORT_SEVERITIES) expect(severityWords(severity)).not.toContain('no words');
    for (const status of SUPPORT_STATUSES) {
      expect(statusWords(status)).not.toContain('no words');
      expect(statusLabel(status)).not.toContain('unrecognised');
    }
    for (const code of SUPPORT_RESOLUTION_CODES) expect(resolutionWords(code)).not.toContain('no words');
    expect(SUPPORT_CATEGORIES).toHaveLength(7);
    expect(SUPPORT_SEVERITIES).toHaveLength(4);
    expect(SUPPORT_STATUSES).toHaveLength(6);
    expect(SUPPORT_RESOLUTION_CODES).toHaveLength(6);
  });

  it('says four different things about four urgencies', () => {
    // A ladder where `normal` and `high` share a sentence teaches the host that nothing changed by choosing
    // higher, so the four strings must be four.
    const words = SUPPORT_SEVERITIES.map(severityWords);
    expect(new Set(words).size).toBe(4);
    expect(words).toEqual(['Not urgent', 'Normal urgency', 'Urgent', 'It affects the day itself']);
  });

  it('names an unfamiliar word instead of borrowing a neighbour’s', () => {
    expect(categoryWords('wedding_rescheduling')).toContain('wedding_rescheduling');
    expect(severityWords('definitely_urgent')).toContain('definitely_urgent');
    expect(statusWords('escalated')).toContain('escalated');
    expect(resolutionWords('resolved_with_gift')).toContain('resolved_with_gift');
    expect(statusLabel('escalated')).toBe('escalated (unrecognised)');
    expect(statusWords('escalated')).not.toBe(statusWords('in_progress'));
  });

  it('says who wrote a line, and keeps an unknown actor unknown', () => {
    expect(actorWords('host')).toBe('you');
    expect(actorWords('operator')).toBe('support');
    expect(actorWords('system')).toBe('the system');
    expect(actorWords('volunteer')).toContain('volunteer');
  });

  it('reads the six statuses as known and anything else as not', () => {
    for (const status of SUPPORT_STATUSES) expect(isKnownStatus(status)).toBe(true);
    expect(isKnownStatus('escalated')).toBe(false);
    expect(isKnownStatus('')).toBe(false);
  });

  it('tells a message the host wrote from a move in the history', () => {
    const visible = (kind: string) =>
      parseCaseThread(thread({ events: [eventRow({ kind })] }))!.events[0];
    expect(isHostMessage(visible('message_host'))).toBe(true);
    expect(isHostMessage(visible('status'))).toBe(false);
    expect(isHostMessage(visible('message_operator'))).toBe(false);
  });

  it('has no words that promise a reply time or an outcome', () => {
    // The page comment in `src/pages/Support.tsx` says the substrate has no deadline column; the sentences
    // are where that promise would sneak in, so the check belongs next to them.
    const all = [
      ...SUPPORT_STATUSES.map(statusWords),
      ...SUPPORT_RESOLUTION_CODES.map((code) => resolutionWords(code) ?? ''),
    ];
    for (const sentence of all) {
      expect(sentence.toLowerCase()).not.toMatch(/\d+\s*(hour|day|week)/);
      expect(sentence.toLowerCase()).not.toContain('we will');
    }
  });
});

describe('stamps, bounds and keys', () => {
  it('reads the server’s day without moving it across time zones', () => {
    // `timestamptz` arrives as an offset string. A ticket's dates are records of when things happened, so
    // the day the server wrote is the day the host reads — the local clock gets no vote.
    expect(stampDay('2026-10-20T23:30:00+00:00')).toBe('2026-10-20');
    expect(stampDay('2026-10-21T00:15:00+00:00')).toBe('2026-10-21');
    expect(stampDay('not a stamp')).toBeNull();
    expect(stampDay('')).toBeNull();
  });

  it('agrees with the door on how long a message may be', () => {
    // The forms use these two constants as `maxLength`, so a drift between them and the CHECKs in the
    // migration is a host who is cut off mid-sentence or a door that refuses a full box.
    const migration = readFileSync(MIGRATION, 'utf8');
    expect(migration).toContain(`IF length(p_summary) > ${SUMMARY_LIMIT} THEN`);
    expect(migration).toContain(`length(host_summary) <= ${SUMMARY_LIMIT}`);
    expect(migration).toContain(`IF length(p_body) > ${REPLY_LIMIT} THEN`);
  });

  it('mints a key the door reads as a uuid, from getRandomValues alone', () => {
    // `crypto.randomUUID` is a secure-context-only API (MDN), and the acceptance stack this project tests
    // against is served over plain http, so the mint must not need it. Measured in this environment: bare
    // `crypto` is Node's WebCrypto, which has both methods, while jsdom 20.0.3's own `window.crypto` has only
    // `getRandomValues` — so the honest test is to hand the function a crypto that has the one method and
    // prove the key still lands. Nothing here asserts the absence of `randomUUID`, because that would be a
    // claim about the harness rather than about the shipped page.
    const real = globalThis.crypto;
    expect(typeof real.getRandomValues).toBe('function');
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes) });
    let keys: string[];
    try {
      keys = Array.from({ length: 500 }, newIdempotencyKey);
    } finally {
      vi.stubGlobal('crypto', real);
    }
    for (const key of keys) {
      expect(key, key).toMatch(IDEMPOTENCY_KEY_SHAPE);
      // The exported shape is checked against a uuid written out here too, so a loosened constant fails even
      // though both halves of the pair come from the same module.
      expect('3f2b6c1e-9a44-4d07-8f52-000000000001').toMatch(IDEMPOTENCY_KEY_SHAPE);
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});
