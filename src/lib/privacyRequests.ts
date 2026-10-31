// What this account has asked for, in words, and nothing that is not the account's own.
//
// `api.create_privacy_request` and `api.get_my_privacy_requests`
// (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:245-373`) answer one `jsonb` object each,
// written by `jsonb_build_object`, so a key that is absent was never in the projection — which is the
// difference between "this request has no note" and "this build's privacy body is not the one this reader was
// written against". The second is a refusal.
//
// Three things this file has to be careful about, none of them stylistic.
//
//   * **No word here may promise an outcome.** Stage 11's own header for this migration is "receive a
//     request, route it, never erase anything" (`…:1`), and the five statuses are the whole vocabulary —
//     `satisfied_outside_this_build` is the one that says the work happened somewhere else. A host reading
//     their own list must not be able to mistake an intake row for a delivered copy or a completed deletion,
//     so the sentences below describe what the row *is*, not what will eventually happen to the data.
//   * **The operator's own note column is not in this file because it is not in the payload.** The
//     projection at `…:347-354` names seven keys, and the comment above it (`…:345-346`) says the omission is
//     the privacy boundary: how identity was checked is the operator's working record, not the subject's. The
//     column's name stays in the migration rather than in this bundle, because `product:check` refuses every
//     operator door name under `src/`. An interface that grows a field here has to grow it in the projection
//     first, and that is a migration.
//   * **A kind that is not `export` or `erasure` still renders.** The CHECK at `…:50-51` and the body's
//     refusal at `…:261-264` mean today's database cannot produce one; a tomorrow that adds a third kind must
//     not have its own request silently displayed as an export, which is the failure a mapping would cause.
//     The wrong *type* refuses; an unfamiliar *word* is printed as unfamiliar.

import { asObject, booleanValue, numberValue } from './jsonShape';

/** The two kinds a request may take (`…:51`). Neither one is a verb this build performs. */
export const PRIVACY_KINDS = ['export', 'erasure'] as const;

/** The five statuses of the intake queue (`…:52-54`). */
export const PRIVACY_STATUSES = [
  'received',
  'identity_verification_requested',
  'queued_for_stage13',
  'satisfied_outside_this_build',
  'declined',
] as const;

/** The seven keys one row of the host's own list carries, in the projection's order (`…:348-350`). */
const REQUEST_KEYS = [
  'request_ref',
  'wedding_id',
  'kind',
  'status',
  'host_note',
  'requested_at',
  'updated_at',
] as const;

export interface PrivacyRequest {
  requestRef: string;
  weddingId: string;
  kind: string;
  status: string;
  hostNote: string | null;
  requestedAt: string;
  updatedAt: string;
}

export interface PrivacyRequestList {
  requests: PrivacyRequest[];
  count: number;
}

/** What the door answers for the request it filed, or replayed for this account's live one (`…:285-287`, `…:298-300`). */
export interface FilePrivacyReceipt {
  requestRef: string;
  weddingId: string;
  kind: string;
  status: string;
  requestedAt: string;
  replayed: boolean;
}

const word = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const nullableWord = (value: unknown): string | null | undefined =>
  value === null ? null : word(value) ?? undefined;

/** A non-negative integer — `count` is `jsonb_array_length`, which is 0 for an account that asked for nothing. */
const nonNegativeInt = (value: unknown): number | null | undefined => {
  if (value === null) return undefined;
  const n = numberValue(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : undefined;
};

const readRequest = (value: unknown): PrivacyRequest | null => {
  const raw = asObject(value);
  if (raw === null) return null;
  for (const key of REQUEST_KEYS) if (!(key in raw)) return null;
  const requestRef = word(raw.request_ref);
  const weddingId = word(raw.wedding_id);
  const kind = word(raw.kind);
  const status = word(raw.status);
  const requestedAt = word(raw.requested_at);
  const updatedAt = word(raw.updated_at);
  if ([requestRef, weddingId, kind, status, requestedAt, updatedAt].includes(null)) return null;
  const hostNote = nullableWord(raw.host_note);
  if (hostNote === undefined) return null;
  return {
    requestRef,
    weddingId,
    kind,
    status,
    hostNote: hostNote as string | null,
    requestedAt,
    updatedAt,
  };
};

/** This account's requests, newest first (`…:353`), or null when the answer is not that object. */
export const parsePrivacyList = (value: unknown): PrivacyRequestList | null => {
  const raw = asObject(value);
  if (raw === null || !Array.isArray(raw.requests)) return null;
  const requests: PrivacyRequest[] = [];
  for (const entry of raw.requests) {
    const request = readRequest(entry);
    if (request === null) return null;
    requests.push(request);
  }
  const count = nonNegativeInt(raw.count);
  if (count === undefined) return null;
  return { requests, count };
};

/** The receipt for a filed or replayed request. `wedding_id` is NOT NULL in this table (`…:46`), so a
 *  request that names no wedding is a refusal here rather than a second answer. */
export const parseFileReceipt = (value: unknown): FilePrivacyReceipt | null => {
  const raw = asObject(value);
  if (raw === null) return null;
  const requestRef = word(raw.request_ref);
  const weddingId = word(raw.wedding_id);
  const kind = word(raw.kind);
  const status = word(raw.status);
  const requestedAt = word(raw.requested_at);
  const replayed = booleanValue(raw.replayed);
  if ([requestRef, weddingId, kind, status, requestedAt].includes(null) || replayed === null) return null;
  return { requestRef, weddingId, kind, status, requestedAt, replayed };
};

const KIND_WORDS: Record<(typeof PRIVACY_KINDS)[number], string> = {
  export: 'A copy of my data',
  erasure: 'Removing my data',
};

const STATUS_WORDS: Record<(typeof PRIVACY_STATUSES)[number], string> = {
  received: 'Filed. Nobody has started on it, and nothing has been sent or removed.',
  identity_verification_requested:
    'We have to confirm this is your account before anyone acts on it.',
  queued_for_stage13: 'Filed and waiting. The work you asked for is not something this product does yet.',
  satisfied_outside_this_build:
    'Marked as handled by a person, somewhere outside this product — not by a button here.',
  declined: 'Declined. You can file the request again if you disagree.',
};

/** What was asked for, in the words a host chose it with. */
export const kindWords = (kind: string): string =>
  (KIND_WORDS as Record<string, string | undefined>)[kind]
    ?? `this build has no words for the request “${kind}”`;

/** Where the request stands, said so that an intake row is never mistaken for a delivery. */
export const statusWords = (status: string): string =>
  (STATUS_WORDS as Record<string, string | undefined>)[status]
    ?? `this build has no words for the status “${status}”`;

/** The three statuses that are still live, and therefore still hold this account's one slot per
 *  wedding and kind (`…:78-80` — the partial unique index is what makes a second tap a replay). */
export const isLiveStatus = (status: string): boolean =>
  ['received', 'identity_verification_requested', 'queued_for_stage13'].includes(status);

/** The calendar day the server wrote on a stamp — read, not parsed. */
export const stampDay = (iso: string): string | null => {
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

/** The note limit the door enforces (`…:265-268`): real text or absent, never blank. */
export const NOTE_LIMIT = 2000;
