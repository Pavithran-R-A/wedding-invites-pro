// The host's own support thread: what they wrote, what the status did, and nothing else.
//
// `api.open_support_case`, `api.reply_to_support_case`, `api.get_my_support_case` and
// `api.get_my_support_cases` (`supabase/migrations/20261020190100_stage11_support_cases.sql`) each answer
// one `jsonb` object, and every key in it is written by `jsonb_build_object`, so a missing key means the
// projection changed rather than that a value was empty. This file's job is to notice that, and to give a
// host words for six status values that were named for an operator's queue.
//
// Four rules decide its shape.
//
//   * **A missing key is a refusal, not a `null`.** Nullable in SQL still means *present* in the object,
//     so `wedding_id: null` is the answer "this case is about my account" (`…support_cases.sql:92`)
//     while an absent `wedding_id` is a build whose body no longer matches this reader.
//   * **An unfamiliar word is kept, not mapped.** Statuses, categories, severities, resolution codes and
//     event kinds are CHECKed server-side and checked by the SQL tier; a new one added by a future
//     migration must render as "this build has no words for …" rather than as the neighbour it most
//     resembles. The wrong *kind* still refuses.
//   * **The case ref is not shape-checked here.** `^SV-[A-Z2-7]{8}$` is a row CHECK
//     (`…support_cases.sql:90-91`) and the mint is the database's; a page that refused an unfamiliar ref
//     would leave its own host unable to read the ticket they just opened, which is a worse failure than
//     printing a string this build did not expect.
//   * **Nothing here reaches beyond the host.** The thread projection filters its events to
//     `message_host` and `status` (`…:723-731`), so an operator's private note, an assignment and the
//     `operation_link` rows are absent from the payload and therefore absent from this type. A field
//     added to this interface has to be added to the projection first, and that is a migration.

import { asObject, booleanValue, numberValue } from './jsonShape';

/** The seven words a host may open a case with (`…support_cases.sql:530-532`). */
export const SUPPORT_CATEGORIES = [
  'invitation_access',
  'publication_delivery',
  'guest_rsvp',
  'render_output',
  'billing_refund_inquiry',
  'privacy_data_request',
  'other',
] as const;

/** The four severities a host may choose (`…:537`), read as the host's urgency rather than a queue rank. */
export const SUPPORT_SEVERITIES = ['low', 'normal', 'high', 'critical'] as const;

/** The six lifecycle words (`…:116-118`), of which `closed` is terminal
 *  (`20261020190200_stage11_closed_is_terminal.sql:119-136`). */
export const SUPPORT_STATUSES = [
  'open',
  'triaged',
  'awaiting_information',
  'in_progress',
  'resolved',
  'closed',
] as const;

/** The six ways a resolved case is put down (`…:130-132`); none of them is about money. */
export const SUPPORT_RESOLUTION_CODES = [
  'resolved_by_operator',
  'host_withdrew',
  'no_action_needed',
  'duplicate',
  'out_of_scope',
  'event_cancelled',
] as const;

/** The ten keys a list row carries, in the projection's own order (`…:658-662`). */
const SUMMARY_KEYS = [
  'case_ref',
  'wedding_id',
  'category',
  'severity',
  'status',
  'resolution_code',
  'host_summary',
  'opened_at',
  'updated_at',
  'resolved_at',
] as const;

/** The seven keys one event carries (`…:724-726`). */
const EVENT_KEYS = [
  'seq',
  'kind',
  'actor_kind',
  'from_status',
  'to_status',
  'body',
  'created_at',
] as const;

export interface SupportCaseSummary {
  caseRef: string;
  weddingId: string | null;
  category: string;
  severity: string;
  status: string;
  resolutionCode: string | null;
  hostSummary: string;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface SupportCaseEvent {
  seq: number;
  kind: string;
  actorKind: string;
  fromStatus: string | null;
  toStatus: string | null;
  body: string | null;
  createdAt: string;
}

export interface SupportCaseThread extends SupportCaseSummary {
  replyAllowed: boolean;
  resumeExpected: boolean;
  events: SupportCaseEvent[];
}

export interface SupportCaseList {
  cases: SupportCaseSummary[];
  statusFilter: string | null;
  limit: number;
}

/** What the door answers for the ticket it opened, or replayed for the key it was given. */
export interface OpenCaseReceipt {
  caseRef: string;
  weddingId: string | null;
  category: string;
  severity: string;
  status: string;
  openedAt: string;
  replayed: boolean;
}

export interface ReplyReceipt {
  caseRef: string;
  status: string;
  seq: number;
  replayed: boolean;
}

const word = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const nullableWord = (value: unknown): string | null | undefined =>
  value === null ? null : word(value) ?? undefined;

/** A positive integer — the seq a thread row is ordered by. */
const positiveInt = (value: unknown): number | null | undefined => {
  if (value === null) return undefined;
  const n = numberValue(value);
  return n !== null && Number.isInteger(n) && n > 0 ? n : undefined;
};

const readSummary = (raw: Record<string, unknown>): SupportCaseSummary | null => {
  for (const key of SUMMARY_KEYS) if (!(key in raw)) return null;
  const caseRef = word(raw.case_ref);
  const category = word(raw.category);
  const severity = word(raw.severity);
  const status = word(raw.status);
  const hostSummary = word(raw.host_summary);
  const openedAt = word(raw.opened_at);
  const updatedAt = word(raw.updated_at);
  if ([caseRef, category, severity, status, hostSummary, openedAt, updatedAt].includes(null)) return null;
  const weddingId = nullableWord(raw.wedding_id);
  const resolutionCode = nullableWord(raw.resolution_code);
  const resolvedAt = nullableWord(raw.resolved_at);
  if ([weddingId, resolutionCode, resolvedAt].includes(undefined)) return null;
  return {
    caseRef: caseRef as string,
    weddingId: weddingId as string | null,
    category: category as string,
    severity: severity as string,
    status: status as string,
    resolutionCode: resolutionCode as string | null,
    hostSummary: hostSummary as string,
    openedAt: openedAt as string,
    updatedAt: updatedAt as string,
    resolvedAt: resolvedAt as string | null,
  };
};

const readEvent = (value: unknown): SupportCaseEvent | null => {
  const raw = asObject(value);
  if (raw === null) return null;
  for (const key of EVENT_KEYS) if (!(key in raw)) return null;
  const kind = word(raw.kind);
  const actorKind = word(raw.actor_kind);
  const createdAt = word(raw.created_at);
  const seq = positiveInt(raw.seq);
  if (kind === null || actorKind === null || createdAt === null || seq === undefined) return null;
  const fromStatus = nullableWord(raw.from_status);
  const toStatus = nullableWord(raw.to_status);
  const body = nullableWord(raw.body);
  if ([fromStatus, toStatus, body].includes(undefined)) return null;
  return {
    seq,
    kind,
    actorKind,
    fromStatus: fromStatus as string | null,
    toStatus: toStatus as string | null,
    body: body as string | null,
    createdAt,
  };
};

/** The host's list of their own tickets, newest first, or null when the answer is not that object.
 *  An empty `cases` array is a real answer — an account with nothing open. */
export const parseCaseList = (value: unknown): SupportCaseList | null => {
  const raw = asObject(value);
  if (raw === null || !Array.isArray(raw.cases)) return null;
  const cases: SupportCaseSummary[] = [];
  for (const entry of raw.cases) {
    const item = asObject(entry);
    if (item === null) return null;
    const summary = readSummary(item);
    if (summary === null) return null;
    cases.push(summary);
  }
  const statusFilter = nullableWord(raw.status_filter);
  const limit = positiveInt(raw.limit);
  if (statusFilter === undefined || limit === undefined) return null;
  return { cases, statusFilter: statusFilter as string | null, limit };
};

/** One thread, with the two derived flags the body computes rather than stores (`…:741-742`). */
export const parseCaseThread = (value: unknown): SupportCaseThread | null => {
  const raw = asObject(value);
  if (raw === null) return null;
  const summary = readSummary(raw);
  if (summary === null || !Array.isArray(raw.events)) return null;
  const replyAllowed = booleanValue(raw.reply_allowed);
  const resumeExpected = booleanValue(raw.resume_expected);
  if (replyAllowed === null || resumeExpected === null) return null;
  const events: SupportCaseEvent[] = [];
  for (const entry of raw.events) {
    const event = readEvent(entry);
    if (event === null) return null;
    events.push(event);
  }
  return { ...summary, replyAllowed, resumeExpected, events };
};

/** The receipt for an opened case (`…:590-593`) or the one a used key already opened (`…:571-574`). */
export const parseOpenReceipt = (value: unknown): OpenCaseReceipt | null => {
  const raw = asObject(value);
  if (raw === null) return null;
  const caseRef = word(raw.case_ref);
  const category = word(raw.category);
  const severity = word(raw.severity);
  const status = word(raw.status);
  const openedAt = word(raw.opened_at);
  const replayed = booleanValue(raw.replayed);
  const weddingId = nullableWord(raw.wedding_id);
  // `weddingId` is the one key whose null is an answer — the account-level ticket of `…:92` — so it joins the
  // undefined test and not the null one. A reader that refused it here would tell a host who filed an
  // account-level case that their message could not be sent, one second after the door wrote the row.
  if ([caseRef, category, severity, status, openedAt].includes(null) ||
      replayed === null || weddingId === undefined) return null;
  return {
    caseRef: caseRef as string,
    weddingId: weddingId as string | null,
    category: category as string,
    severity: severity as string,
    status: status as string,
    openedAt,
    replayed,
  };
};

/** The receipt for a reply: which ticket, what it became, and the thread row it added (`…:847-849`). */
export const parseReplyReceipt = (value: unknown): ReplyReceipt | null => {
  const raw = asObject(value);
  if (raw === null) return null;
  const caseRef = word(raw.case_ref);
  const status = word(raw.status);
  const seq = positiveInt(raw.seq);
  const replayed = booleanValue(raw.replayed);
  if (caseRef === null || status === null || seq === undefined || replayed === null) return null;
  return { caseRef, status, seq, replayed };
};

const CATEGORY_WORDS: Record<(typeof SUPPORT_CATEGORIES)[number], string> = {
  invitation_access: 'Getting to my invitation',
  publication_delivery: 'A shared link that is not behaving',
  guest_rsvp: 'Guests and the replies they sent',
  render_output: 'A download — PDF, image or QR code',
  billing_refund_inquiry: 'A question about money',
  privacy_data_request: 'My data — a copy, or removing it',
  other: 'Something else',
};

const SEVERITY_WORDS: Record<(typeof SUPPORT_SEVERITIES)[number], string> = {
  low: 'Not urgent',
  normal: 'Normal urgency',
  high: 'Urgent',
  critical: 'It affects the day itself',
};

const STATUS_WORDS: Record<(typeof SUPPORT_STATUSES)[number], string> = {
  open: 'We have your message. Nobody has picked it up yet.',
  triaged: 'A person has read it and it is in their queue.',
  awaiting_information: 'The answer is waiting on you. Reply below and work starts again.',
  in_progress: 'Someone is working on it.',
  resolved: 'Marked resolved. If that is wrong, reply and it reopens.',
  closed: 'This thread is closed and takes no further messages.',
};

const RESOLUTION_WORDS: Record<(typeof SUPPORT_RESOLUTION_CODES)[number], string> = {
  resolved_by_operator: 'resolved by whoever handled it',
  host_withdrew: 'you withdrew it',
  no_action_needed: 'no action was needed',
  duplicate: 'a duplicate of another ticket',
  out_of_scope: 'outside what support handles',
  event_cancelled: 'the ceremony was cancelled',
};

/** The host's own words for what they are asking about, for a picker and for a list row. */
export const categoryWords = (category: string): string =>
  (CATEGORY_WORDS as Record<string, string | undefined>)[category]
    ?? `this build has no words for the topic “${category}”`;

export const severityWords = (severity: string): string =>
  (SEVERITY_WORDS as Record<string, string | undefined>)[severity]
    ?? `this build has no words for the urgency “${severity}”`;

/** Where the ticket stands, said to the person who opened it. */
export const statusWords = (status: string): string =>
  (STATUS_WORDS as Record<string, string | undefined>)[status]
    ?? `this build has no words for the status “${status}”`;

const STATUS_LABELS: Record<(typeof SUPPORT_STATUSES)[number], string> = {
  open: 'just received',
  triaged: 'in someone’s queue',
  awaiting_information: 'waiting on you',
  in_progress: 'being worked on',
  resolved: 'marked resolved',
  closed: 'closed',
};

/** The same six statuses in the three words a history line needs. `statusWords` above tells a host where
 *  they stand in a sentence; a thread that prints those sentences six times is not readable, and a thread
 *  that prints `awaiting_information` is printing the operator's vocabulary to the customer. */
export const statusLabel = (status: string): string =>
  (STATUS_LABELS as Record<string, string | undefined>)[status] ?? `${status} (unrecognised)`;

const ACTOR_WORDS: Record<'host' | 'operator' | 'system', string> = {
  host: 'you',
  operator: 'support',
  system: 'the system',
};

/** Who wrote a line of the thread (`…:354`). `operator` is the only one that could be mistaken for a name:
 *  the projection carries the actor's *kind* and not their account, by the same boundary that keeps an
 *  operator's private note out of this read. */
export const actorWords = (actorKind: string): string =>
  (ACTOR_WORDS as Record<string, string | undefined>)[actorKind]
    ?? `someone this build has no words for (“${actorKind}”)`;

/** Why a resolved case was put down, or null while it is not resolved. */
export const resolutionWords = (code: string | null): string | null => {
  if (code === null) return null;
  return (RESOLUTION_WORDS as Record<string, string | undefined>)[code]
    ?? `this build has no words for the outcome “${code}”`;
};

export const isKnownStatus = (status: string): boolean =>
  (SUPPORT_STATUSES as readonly string[]).includes(status);

/** Whether this line of the thread is something the host wrote rather than a status move. */
export const isHostMessage = (event: SupportCaseEvent): boolean => event.kind === 'message_host';

/** The calendar day the server wrote on a stamp — read, not parsed, because a ticket's dates are
 *  records about when things happened, not a ceremony time the visitor's clock gets to move. */
export const stampDay = (iso: string): string | null => {
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

/** The summary text limit the door enforces (`…:542-548`), kept here so the form and the server agree
 *  before a host types past it rather than after. */
export const SUMMARY_LIMIT = 2000;

/** The reply limit the door enforces (`…:793-798`). */
export const REPLY_LIMIT = 4000;

/**
 * A fresh idempotency key for one submission of a form.
 *
 * The door requires one (`…:789-792`) and its promise is the host's: the same key from the same account
 * answers with the ticket the first delivery made rather than opening a second one, so a send that appeared
 * to fail and is pressed again cannot put the same paragraph in the thread twice. That only holds if the
 * key belongs to the *submission* rather than to the attempt, which is why the caller mints it once and
 * keeps it while the form is open.
 *
 * Written over `getRandomValues` rather than `crypto.randomUUID()` because the two are not equally available
 * where this function runs. `randomUUID` is a secure-context-only API — MDN states it "is available only in
 * secure contexts (HTTPS)" — and this project's acceptance stack is served over plain http, so a page that
 * minted a key with it would throw on mount for anyone who reached it that way. `getRandomValues` has no such
 * flag in its own documentation. Measured here rather than assumed: jsdom 20.0.3, which the unit tests mount
 * in, gives `window.crypto.getRandomValues` as a function and `window.crypto.randomUUID` as undefined — while
 * the bare `crypto` a vitest test resolves is Node's own WebCrypto, which has both. That last half is why
 * `src/test/supportCasesShape.test.ts` pins the mint's *shape* and not the absence of `randomUUID`: this
 * environment cannot observe the browser's restriction, and a test that asserted it would be asserting the
 * harness rather than the shipped surface.
 */
export const newIdempotencyKey = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The shape PostgREST needs to read the key as the `uuid` argument it is. */
export const IDEMPOTENCY_KEY_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
