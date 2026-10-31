// The privacy intake, read as a reader — and read as a promise this build is not allowed to make.
//
// Two doors answer one `jsonb` object each (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:298-300`
// and `:285-287` for the receipt, `:348-350` and `:356` for the list), and `jsonb_build_object` writes every key
// it was given, so a key that is absent was never in the projection. That is the first half of what this file
// measures: a `null` is an answer, a missing key is a changed build.
//
// The second half matters more to a customer. This migration's own header is "receive a request, route it,
// never erase anything" (`:1`), the create wrapper's comment says "it deletes nothing" (`:328-330`), and the
// destructive decision belongs to Stage 13 (`:238-239`). So the five status sentences are the surface where a
// reader could accidentally promise a copy or a deletion that no code performs. The cells below refuse that
// vocabulary in the shipped strings, which is the only place a future edit could introduce it by accident.
//
// The asymmetry worth naming, because it is easy to get wrong in the helpful direction: a support case may
// have `wedding_id: null` — that is the documented account-level ticket — while a privacy request may not
// (`:46` is `NOT NULL`, and the body's ownership test at `:269-272` refuses a NULL before it can reach the
// foreign key). The reader here refuses the null, and that refusal is correct for this table only.
//
// What this file does NOT claim. That only the caller's own rows are returned — the filter at `:352` is the
// body's, and `supabase/tests/stage11/90_privacy_intake.sql` plus the host cases of
// `supabase/tests/api/stage11_operations_http.test.mjs` measure it against a running stack. That the CHECKs at
// `:51` and `:53-54` hold: the SQL tier drives the refusals. Nothing here renders a screen; that is
// `src/test/myDataPage.test.tsx`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NOTE_LIMIT,
  PRIVACY_KINDS,
  PRIVACY_STATUSES,
  kindWords,
  isLiveStatus,
  parseFileReceipt,
  parsePrivacyList,
  stampDay,
  statusWords,
} from '@/lib/privacyRequests';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261020190300_stage11_privacy_intake.sql',
);

const REQUEST_REF = 'PR-MFRV2XQ7';
const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';

/** The seven keys `:348-350` writes, in the projection's own order. */
const REQUEST_KEYS = ['request_ref', 'wedding_id', 'kind', 'status', 'host_note', 'requested_at', 'updated_at'];

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  request_ref: REQUEST_REF,
  wedding_id: WEDDING,
  kind: 'export',
  status: 'received',
  host_note: 'Please include the RSVP answers.',
  requested_at: '2026-10-20T09:12:00+00:00',
  updated_at: '2026-10-20T09:12:00+00:00',
  ...overrides,
});

const envelope = (rows: Record<string, unknown>[] = [requestRow()], overrides: Record<string, unknown> = {}) => ({
  requests: rows,
  count: rows.length,
  ...overrides,
});

const receipt = (overrides: Record<string, unknown> = {}) => ({
  request_ref: REQUEST_REF,
  wedding_id: WEDDING,
  kind: 'erasure',
  status: 'received',
  requested_at: '2026-10-20T09:12:00+00:00',
  replayed: false,
  ...overrides,
});

describe('the host’s own list', () => {
  it('reads a filed request into the host’s names', () => {
    const parsed = parsePrivacyList(envelope());
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual(['count', 'requests']);
    expect(Object.keys(parsed!.requests[0]).sort()).toEqual([
      'hostNote', 'kind', 'requestRef', 'requestedAt', 'status', 'updatedAt', 'weddingId',
    ]);
    expect(parsed!.count).toBe(1);
    expect(parsed!.requests[0].hostNote).toBe('Please include the RSVP answers.');
  });

  it('accepts an account that has asked for nothing as an answer', () => {
    // `:356` counts the aggregate it just built, so `count: 0` with an empty array is the shape of a customer
    // who has never touched this page — data, and not an error to be apologised for.
    const parsed = parsePrivacyList({ requests: [], count: 0 });
    expect(parsed).toEqual({ requests: [], count: 0 });
  });

  it('refuses a projection that dropped a key', () => {
    for (const key of REQUEST_KEYS) {
      const row: Record<string, unknown> = { ...requestRow() };
      delete row[key];
      expect(parsePrivacyList({ requests: [row], count: 1 }), `drop ${key}`).toBeNull();
    }
  });

  it('refuses an envelope whose count is not a count', () => {
    // `:356` writes `jsonb_array_length`, so a count that arrives as text, as a fraction, as negative or not at
    // all is not this build's envelope. A page that showed "1 request" beside an empty list is the failure.
    for (const count of [undefined, null, -1, 1.5, '1', true, {}]) {
      expect(parsePrivacyList({ requests: [], count }), `count ${String(count)}`).toBeNull();
    }
  });

  it('refuses an answer that is not the object the door writes', () => {
    for (const value of [{}, [], null, 'received', { requests: 'none', count: 0 }, { count: 0 }]) {
      expect(parsePrivacyList(value)).toBeNull();
    }
  });

  it('refuses the whole page when one row is unreadable', () => {
    // Half a privacy list on screen would be a host believing they had filed the row that did not arrive.
    const broken = envelope([requestRow(), requestRow({ request_ref: 'PR-MFRV2XQ7', kind: 7 })]);
    expect(parsePrivacyList(broken)).toBeNull();
  });

  it('keeps a word this build has not been told about, and says so', () => {
    // `:51` and `:53-54` CHECK these today, so an unfamiliar word is a future migration's value. Mapping it to
    // its neighbour would be a lie in the customer's own list: an `annotated` status shown as `declined`.
    const parsed = parsePrivacyList(envelope([requestRow({ kind: 'restriction', status: 'on_hold' })]));
    expect(parsed?.requests[0].kind).toBe('restriction');
    expect(kindWords('restriction')).toContain('restriction');
    expect(kindWords('restriction')).toContain('no words');
    expect(statusWords('on_hold')).toContain('on_hold');
  });

  it('treats a missing note as null and a blank note as a changed body', () => {
    expect(parsePrivacyList(envelope([requestRow({ host_note: null })]))?.requests[0].hostNote).toBeNull();
    // `:58` forbids a blank note in a row, so an empty string in the payload means the projection stopped
    // going through the CHECK — the reader declines to guess whether the host wrote something.
    expect(parsePrivacyList(envelope([requestRow({ host_note: '' })]))).toBeNull();
  });

  it('refuses the wedding id that a privacy request cannot have', () => {
    // The support reader accepts a null wedding (an account-level ticket); this table cannot produce one
    // (`:46` NOT NULL), so a null here is a body that no longer matches this reader.
    expect(parsePrivacyList(envelope([requestRow({ wedding_id: null })]))).toBeNull();
    expect(parseFileReceipt(receipt({ wedding_id: null }))).toBeNull();
  });
});

describe('the receipt the filing door answers with', () => {
  it('reads a newly filed request', () => {
    const parsed = parseFileReceipt(receipt());
    expect(parsed).toEqual({
      requestRef: REQUEST_REF, weddingId: WEDDING, kind: 'erasure', status: 'received',
      requestedAt: '2026-10-20T09:12:00+00:00', replayed: false,
    });
  });

  it('reads the replay of a live request as a replay', () => {
    // `:285-287` returns the existing row with `replayed: true` and writes nothing (`:322-326`). A page that
    // lost that flag would tell a host they had queued a second request when they had not.
    const parsed = parseFileReceipt(receipt({ replayed: true }));
    expect(parsed?.replayed).toBe(true);
  });

  it('refuses a replayed flag that is not a boolean', () => {
    for (const replayed of [undefined, null, 'true', 1, 0]) {
      expect(parseFileReceipt(receipt({ replayed })), `replayed ${String(replayed)}`).toBeNull();
    }
  });

  it('refuses an envelope that dropped a key or changed kind', () => {
    for (const key of ['request_ref', 'wedding_id', 'kind', 'status', 'requested_at', 'replayed']) {
      const value: Record<string, unknown> = { ...receipt() };
      delete value[key];
      expect(parseFileReceipt(value), `drop ${key}`).toBeNull();
    }
    expect(parseFileReceipt(receipt({ request_ref: '' }))).toBeNull();
    expect(parseFileReceipt(receipt({ kind: null }))).toBeNull();
    expect(parseFileReceipt([])).toBeNull();
    expect(parseFileReceipt(null)).toBeNull();
  });
});

describe('the words', () => {
  it('covers exactly the two kinds and five statuses the table allows', () => {
    expect(PRIVACY_KINDS).toEqual(['export', 'erasure']);
    expect(PRIVACY_STATUSES).toEqual([
      'received', 'identity_verification_requested', 'queued_for_stage13',
      'satisfied_outside_this_build', 'declined',
    ]);
    for (const kind of PRIVACY_KINDS) expect(kindWords(kind)).not.toContain('no words');
    for (const status of PRIVACY_STATUSES) expect(statusWords(status)).not.toContain('no words');
  });

  it('gives every status its own sentence', () => {
    // Five distinct rows of a queue collapsing into two identical sentences would be a list that looks
    // informative and says nothing.
    const said = PRIVACY_STATUSES.map(statusWords);
    expect(new Set(said).size).toBe(PRIVACY_STATUSES.length);
  });

  it('never lets a status sentence claim that this product performed the request', () => {
    // The claim this page exists to avoid: Stage 11 files and routes and deletes nothing (`:1`, `:238-239`,
    // `:328-330`). A future edit to a status sentence is where such a promise would enter, so it is refused here.
    // The instrument is about *who acted*: `received` legitimately says "nothing has been sent or removed", and a
    // regex that forbade those verbs outright would only train this cell to be edited away. What is not
    // sayable is the product claiming it did the deed, or a copy presenting itself as ready.
    const performed = /\bwe (have |’ve |'ve )?(sent|delivered|deleted|erased|removed|downloaded|exported)\b/i;
    const ready = /\b(your copy|a copy (is|has)|the download is|is ready (for|to))\b/i;
    for (const status of PRIVACY_STATUSES) {
      expect(statusWords(status), status).not.toMatch(performed);
      expect(statusWords(status), status).not.toMatch(ready);
    }
  });

  it('keeps the one status that reports an outside act honest about where it happened', () => {
    // `satisfied_outside_this_build` is the word for a person acting somewhere else, and the CHECK at `:67-69`
    // is what makes it name an operator note. Its sentence has to keep saying "not by a button here": the
    // moment it reads as a completion, this page has promised a deletion it cannot perform.
    expect(statusWords('satisfied_outside_this_build')).toMatch(/outside this product/i);
    expect(statusWords('satisfied_outside_this_build')).toMatch(/not by a button here/i);
  });

  it('promises no deadline, because the migration sets none', () => {
    for (const status of PRIVACY_STATUSES) {
      expect(statusWords(status), status).not.toMatch(/\d+\s*(hour|day|week|month)/i);
      expect(statusWords(status), status).not.toMatch(/\b(we will|we.ll respond)\b/i);
    }
  });

  it('knows which three statuses still hold this account’s slot', () => {
    // `:78-80` is a partial unique index over exactly these three, which is why a second tap replays rather
    // than queues; a declined or satisfied request is not live, and asking again is allowed.
    expect(PRIVACY_STATUSES.filter(isLiveStatus)).toEqual([
      'received', 'identity_verification_requested', 'queued_for_stage13',
    ]);
    expect(isLiveStatus('satisfied_outside_this_build')).toBe(false);
    expect(isLiveStatus('declined')).toBe(false);
    expect(isLiveStatus('on_hold')).toBe(false);
  });

  it('reads a server stamp’s day without moving it', () => {
    expect(stampDay('2026-10-20T18:40:00+00:00')).toBe('2026-10-20');
    expect(stampDay('2026-10-20T02:10:00+05:30')).toBe('2026-10-20');
    expect(stampDay('not a timestamp')).toBeNull();
  });
});

describe('the bound the form and the door share', () => {
  it('is the number the migration actually checks', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // Read from the migration's own text rather than copied here, so a note limit that moves in a future
    // migration fails this cell instead of letting the form accept text the door then refuses.
    expect(sql).toContain(`IF p_note IS NOT NULL AND (length(btrim(p_note)) = 0 OR length(p_note) > ${NOTE_LIMIT}) THEN`);
    expect(sql).toContain(`length(btrim(host_note)) > 0 AND length(host_note) <= ${NOTE_LIMIT}`);
    expect(sql).toContain(`RAISE EXCEPTION 'a privacy request note is either real text or absent, and % characters is neither',`);
  });

  it('is a bound a host can read, and an absent note is still allowed', () => {
    expect(NOTE_LIMIT).toBe(2000);
    expect(parsePrivacyList(envelope([requestRow({ host_note: 'x'.repeat(NOTE_LIMIT) })])))
      .not.toBeNull();
  });
});
