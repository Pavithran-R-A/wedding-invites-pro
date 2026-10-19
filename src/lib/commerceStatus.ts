// The host's one reading of their own purchase: a state, and possibly a price.
//
// `internal_api.commerce_host_summary` answers one `jsonb` object for one wedding, and Requirement 8 of
// the Stage 10 order asks that object to be enough to tell a host what is true: pending, failed,
// cancelled, verified. Nothing in it is a status anybody can write. `state` is a CASE over the order,
// its newest payment attempt, the entitlement that purchase bought and the latest refund
// (`20261019130000_stage10_host_failed_state.sql:99-116`), and the twelve columns around it are those
// rows' own words. So this file's job is not to work out what is happening — it is to notice when the
// answer is not the shape the body promises.
//
// Four rules decide its shape.
//
//   * **A missing key is a refusal, not a `null`.** `jsonb_build_object` writes every key it is handed
//     (`jsonShape.ts:16-22`), so a projection that stopped mentioning `attempt_status` did not lose a
//     value — it changed. Twelve of the sixteen always-present keys really are nullable, which is
//     exactly why presence has to be tested separately from type: `undefined` is the one thing that
//     must never render as "no refund".
//   * **The price is absent, not null.** §7 of `docs/architecture/commerce-foundations.md` requires an
//     unapproved price to be *missing* from the payload rather than emptied, so that a stale screen cannot
//     print a figure and a careless copy change cannot surface one. That is only a requirement if the
//     reader enforces it, so `amount_minor` or `currency` appearing beside `price_display_enabled: false`
//     refuses the payload instead of quietly dropping the field.
//   * **An unknown word is kept, not defaulted.** `state`, the five status columns and `publish_gate`
//     are typed as `string`, and the label functions fall back to "this build has no words for …". A
//     fourteenth state added by a future migration is a sentence a host should see as unfamiliar rather
//     than one rendered as `payment_pending` — Stages 7 and 8 took the same posture at their own doors.
//     The wrong *kind* still refuses.
//   * **Nothing here turns a state into an action.** There is no `startPayment`, no checkout address and
//     no provider name in this file or in the projection it reads, because §12 of the design note keeps
//     this build read-only about money: capture happens in the ledger, through a delivery no browser
//     session can make. `src/components/invitation/CommerceStatusPanel.tsx` prints what is true and offers
//     nothing to press except a re-read.
//
// WHERE THIS FILE HAS BEEN MEASURED. The unit tier is `src/test/commerceStatusShape.test.ts` (every
// field, both presence halves of the price rule, the thirteen state words and the unfamiliar-word
// fallback). The transport half lives beside it in `src/test/commerceStatusTransport.test.ts` and the
// panel's own sentences in `src/test/commerceStatusPanel.test.tsx`. Against the running stack, the same
// door is driven by `supabase/tests/stage10/90_commerce_functions.sql` group H — including H23a..H33,
// which are the failed attempt and the retry that takes the failure off the screen — and by
// `supabase/tests/api/stage10_commerce_http.test.mjs` D-17, which reads the sixteen-key set, the derived
// `state` and `attempt_status`, and the absence of both price keys out of the deployed function over
// HTTP. Still read off the migration rather than measured here: that a host cannot write any of these
// columns, which is an RLS and trigger fact asserted in `80_commerce_ledger.sql` and not something a
// client-side reader can see; and the thirteen sentences below, which are this file's own wording for
// words the database supplies — nothing on either tier compares them with the CASE.

import { asObject, booleanValue, numberValue } from './jsonShape';

/** The thirteen words the CASE at `20261019130000_stage10_host_failed_state.sql:99-116` can answer. */
export const HOST_STATES = [
  'no_purchase',
  'quote_open',
  'payment_attempt_failed',
  'payment_pending',
  'cancelled',
  'quote_expired',
  'dispute_open_review',
  'refunded_pending_review',
  'refunded_entitlement_revoked',
  'entitlement_active',
  'entitlement_revoked',
  'entitlement_expired',
  'captured_awaiting_entitlement',
] as const;
export type HostState = (typeof HOST_STATES)[number];

// The other columns in this projection carry their own vocabularies — five order statuses
// (`20261017120000_stage10_commerce_foundations.sql:122-123`), three attempt statuses (`:219-220`),
// three entitlement statuses (`20260925120400_stage2_assets_entitlements_secrets.sql:52-53`), two refund
// kinds and four refund statuses (`…foundations.sql:381-383`), and two publish gates (`:429-430`) — and
// they are not restated here. Those CHECKs are enforced by the schema and asserted by
// `supabase/tests/stage10/80_commerce_ledger.sql`; a client copy of each would be a second source of
// truth about a word the server owns, and the one thing this file has to do with a word it has never
// read is print it as it arrived. `state` is different: it exists only in a CASE, so the sentence below
// is the only place a host's vocabulary for it is written down.

/** The sixteen keys the body writes on every call, in the projection's own order (`…:118-143`).
 *  The price's two keys are deliberately NOT in this list — they are the conditional pair. */
const ALWAYS_PRESENT = [
  'wedding_id',
  'state',
  'price_available',
  'package_code',
  'price_version',
  'order_status',
  'attempt_status',
  'merchant_reference',
  'quote_expires_at',
  'captured_at',
  'closed_at',
  'entitlement_status',
  'refund_kind',
  'refund_status',
  'publish_gate',
  'price_display_enabled',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An ISO-4217-shaped code. Deliberately a shape rather than a list: the orders table CHECKs `INR`
 *  today (`…:121`), and a client that hard-coded that list would refuse a host's own reading the day
 *  the price list grows. What it may not do is print a figure whose unit it cannot name — which is what
 *  `formatAmountMinor`'s absence of a symbol decides. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * One reading of one wedding's purchase, in the host's vocabulary.
 *
 * Field order follows the projection, not the tables: a reviewer comparing this type to the `jsonb`
 * should be able to run their eye down both and find the same names.
 */
export interface CommerceSummary {
  weddingId: string;
  state: string;
  priceAvailable: boolean;
  packageCode: string | null;
  priceVersion: number | null;
  orderStatus: string | null;
  attemptStatus: string | null;
  merchantReference: string | null;
  quoteExpiresAt: string | null;
  capturedAt: string | null;
  closedAt: string | null;
  entitlementStatus: string | null;
  refundKind: string | null;
  refundStatus: string | null;
  publishGate: string | null;
  priceDisplayEnabled: boolean;
  amountMinor: number | null;
  currency: string | null;
}

/** A present, non-blank word — the shape every CHECKed text column in this projection has. */
const word = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** A nullable word: `null` is an answer, any other type is not. */
const nullableWord = (value: unknown): string | null | undefined =>
  value === null ? null : word(value) ?? undefined;

/** A nullable positive integer, which is what both `price_version` and `amount_minor` are CHECKed to. */
const nullablePositive = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  const n = numberValue(value);
  return n !== null && Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * The host's reading of this wedding's purchase, or null when the answer is not that object.
 *
 * null covers a non-object, an array, a missing key, a value of the wrong kind, and a payload that shows
 * a figure it also says is not approved to display. The caller turns any of those into one sentence;
 * nothing here partially succeeds, because a half-read purchase is a half-told promise about money.
 */
export const parseCommerceSummary = (value: unknown): CommerceSummary | null => {
  const raw = asObject(value);
  if (raw === null) return null;

  for (const key of ALWAYS_PRESENT) {
    if (!(key in raw)) return null;
  }

  const weddingId = word(raw.wedding_id);
  const state = word(raw.state);
  const priceAvailable = booleanValue(raw.price_available);
  const displayEnabled = booleanValue(raw.price_display_enabled);
  if (weddingId === null || !UUID.test(weddingId)) return null;
  if (state === null) return null;
  if (priceAvailable === null || displayEnabled === null) return null;

  const packageCode = nullableWord(raw.package_code);
  const orderStatus = nullableWord(raw.order_status);
  const attemptStatus = nullableWord(raw.attempt_status);
  const merchantReference = nullableWord(raw.merchant_reference);
  const quoteExpiresAt = nullableWord(raw.quote_expires_at);
  const capturedAt = nullableWord(raw.captured_at);
  const closedAt = nullableWord(raw.closed_at);
  const entitlementStatus = nullableWord(raw.entitlement_status);
  const refundKind = nullableWord(raw.refund_kind);
  const refundStatus = nullableWord(raw.refund_status);
  const publishGate = nullableWord(raw.publish_gate);
  const priceVersion = nullablePositive(raw.price_version);
  if ([packageCode, orderStatus, attemptStatus, merchantReference, quoteExpiresAt, capturedAt,
       closedAt, entitlementStatus, refundKind, refundStatus, publishGate, priceVersion].includes(undefined)) {
    return null;
  }

  // The conditional pair. `…:146-153` of the live body adds both keys together or adds neither, so the two
  // readings below are both "the body is not the one this file was written against": a figure without
  // approval is §7's leak, and an approval whose own branch carries no figure — absent or null — is a
  // projection that dropped or emptied half of what it promised.
  if (!displayEnabled) {
    if ('amount_minor' in raw || 'currency' in raw) return null;
    return build(weddingId, state, priceAvailable, packageCode, priceVersion, orderStatus,
      attemptStatus, merchantReference, quoteExpiresAt, capturedAt, closedAt, entitlementStatus,
      refundKind, refundStatus, publishGate, false, null, null);
  }
  const amountMinor = numberValue(raw.amount_minor);
  const currencyCode = raw.currency;
  if (amountMinor === null || !Number.isInteger(amountMinor) || amountMinor <= 0) return null;
  if (!(typeof currencyCode === 'string' && CURRENCY_CODE.test(currencyCode))) return null;
  return build(weddingId, state, priceAvailable, packageCode, priceVersion, orderStatus,
    attemptStatus, merchantReference, quoteExpiresAt, capturedAt, closedAt, entitlementStatus,
    refundKind, refundStatus, publishGate, true, amountMinor, currencyCode);
};

/** The one place the object is assembled, so both return paths above are checked against the same type. */
const build = (
  weddingId: string,
  state: string,
  priceAvailable: boolean,
  packageCode: string | null,
  priceVersion: number | null,
  orderStatus: string | null,
  attemptStatus: string | null,
  merchantReference: string | null,
  quoteExpiresAt: string | null,
  capturedAt: string | null,
  closedAt: string | null,
  entitlementStatus: string | null,
  refundKind: string | null,
  refundStatus: string | null,
  publishGate: string | null,
  priceDisplayEnabled: boolean,
  amountMinor: number | null,
  currency: string | null,
): CommerceSummary => ({
  weddingId,
  state,
  priceAvailable,
  packageCode,
  priceVersion,
  orderStatus,
  attemptStatus,
  merchantReference,
  quoteExpiresAt,
  capturedAt,
  closedAt,
  entitlementStatus,
  refundKind,
  refundStatus,
  publishGate,
  priceDisplayEnabled,
  amountMinor,
  currency,
});

const STATE_WORDS: Record<HostState, string> = {
  no_purchase: 'Nothing has been quoted for this invitation yet.',
  quote_open: 'A price has been quoted and nobody has been asked to pay it yet.',
  payment_attempt_failed: 'The last attempt to pay did not go through. Trying again is still open.',
  payment_pending: 'A payment has been started and is not confirmed yet.',
  cancelled: 'The order was cancelled.',
  quote_expired: 'The quoted price lapsed before it was taken up.',
  dispute_open_review: 'A disputed charge is on record and is waiting for a human review.',
  refunded_pending_review: 'A refund is on record. What the purchase bought is being reviewed before it changes.',
  refunded_entitlement_revoked: 'A refund is on record and what the purchase bought has been taken back.',
  entitlement_active: 'The payment is confirmed and what you bought is active.',
  entitlement_revoked: 'The payment is confirmed and what you bought has been taken back.',
  entitlement_expired: 'The payment is confirmed and what you bought has run out.',
  captured_awaiting_entitlement: 'The payment is confirmed and the thing it buys is still being recorded.',
};

/**
 * The host's sentence for a derived state.
 *
 * `payment_attempt_failed` reads as a fact and an opening, not a failure of the wedding: §4 keeps the
 * order pending precisely so a refused card does not close the purchase, and the sentence has to carry
 * that or it will tell a host they lost something they can still finish.
 */
export const stateWords = (state: string): string =>
  (STATE_WORDS as Record<string, string | undefined>)[state]
    ?? `this build has no words for the state “${state}”`;

/**
 * A figure written out, or nothing.
 *
 * The minor unit is divided by 100 because that is what the shipped price list means by `amount_minor`
 * (`199900` is one thousand nine hundred ninety-nine rupees), and only a currency with a symbol in this
 * table gets that treatment: `₹1,999` printed for a code this build has not read would be a guess about
 * somebody's money, so an unknown code returns null and the panel says it cannot write that currency
 * rather than writing it wrong.
 */
export const formatAmountMinor = (amountMinor: number, currency: string): string | null => {
  const symbol = currency === 'INR' ? '₹' : null;
  if (symbol === null) return null;
  const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amountMinor / 100);
  return `${symbol}${grouped}`;
};

/** The price sentence a host is allowed to see, or null when nothing about a figure may be printed. */
export const priceWords = (summary: CommerceSummary): string | null => {
  if (!summary.priceDisplayEnabled || summary.amountMinor === null || summary.currency === null) return null;
  const figure = formatAmountMinor(summary.amountMinor, summary.currency);
  if (figure === null) return null;
  const version = summary.priceVersion === null ? '' : ` — price list version ${summary.priceVersion}`;
  return `${figure} once, for this invitation${version}`;
};

/** Whether this build knows the word. The panel renders a state it does not know as a note about its own
 *  reading rather than as a fact about the purchase, which is the only way a fourteenth state stays
 *  legible instead of looking like one of the thirteen. */
export const isKnownState = (state: string): state is HostState =>
  (HOST_STATES as readonly string[]).includes(state);
