// Stage 10 / commerce foundations — the webhook verifier core.
//
// This module answers exactly one question: *did the payment provider send these bytes, and what does it
// say?* Nothing else in Stage 10 may be consulted before it answers, because every downstream step — the
// ledger row, the order's state transition, the entitlement, the publish gate, the host's panel — treats
// its output as fact. A verifier that is nearly right converts an attacker's bytes into a paid wedding,
// so this file is written to be small and to refuse often.
//
// Deliberate properties, each one measured by a case in `stage10-webhook-core.test.mjs`:
//
//  * Verification is over **bytes**. `rawBody` is the unaltered request body as it arrived; the JSON is
//    only read after those bytes have earned it. A framework body parser that re-serialises the document
//    is therefore refused, not forgiven — that is WH-04.
//  * The two providers' schemes are **not** interchangeable: Razorpay sends a lowercase-hex HMAC-SHA256 of
//    the raw body, Cashfree sends a base64 HMAC-SHA256 of `"<timestamp>.<body>"`. Each header is checked
//    for the shape its own scheme requires before any comparison happens, so a digest from the other
//    scheme cannot even reach the equality test.
//  * Freshness is enforced **only where a timestamp is inside the signed string**. Cashfree's is;
//    Razorpay's is not, so `timestampToleranceMs` is inert for Razorpay rather than quietly trusting an
//    attacker-controlled unsigned header. Replay defence there is the event id, nothing more.
//  * **A browser's word is not a delivery.** There is no checkout-callback verifier here, and a
//    callback-shaped payload presented as a webhook is refused for having no event vocabulary — even when
//    it carries an arithmetically valid `order_id|payment_id` signature.
//  * An unrecognised provider event is reported as kind `other` with no facts. That is what makes a
//    provider adding an event type a recording event rather than an action this build took blindly.
//  * Money is a **fact to be checked later against the order**, derived by string arithmetic. A value
//    that would need rounding, or that does not fit an integer column, is refused outright.
//  * A refusal says which rule refused, and never echoes the secret it was given.
//
// Out of scope here by design: order lookup, state transitions, idempotency, entitlement. Those live in
// the database, where the state machine can be enforced against concurrent writers. This module's only
// job is to turn untrusted bytes into a trusted statement about those bytes.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const PROVIDERS = Object.freeze(['razorpay', 'cashfree']);

const EVENT_KINDS = Object.freeze([
  'payment_initiated',
  'payment_captured',
  'payment_failed',
  'order_cancelled',
  'refund_succeeded',
  'refund_failed',
  'chargeback_opened',
  'other',
]);

const SUPPORTED_CURRENCIES = Object.freeze(['INR']);

// The environment a key belongs to is asserted by the operator, never defaulted: it is the fact that
// later gates `live_capture_enabled`, and a webhook body must not be able to influence it.
const ENVIRONMENTS = Object.freeze(['synthetic', 'sandbox', 'test', 'live']);

// Cashfree's signed string carries a seconds timestamp, so a replay window is meaningful. Five minutes is
// the shipped default and `null` turns the policy off explicitly.
const DEFAULT_TIMESTAMP_TOLERANCE_MS = 300_000;

const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';
const CASHFREE_SIGNATURE_HEADER = 'x-webhook-signature';
const CASHFREE_TIMESTAMP_HEADER = 'x-webhook-timestamp';

const HEX_64 = /^[0-9a-f]{64}$/;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;
const INTEGRAL_SECONDS = /^[1-9][0-9]{0,9}$/;
const PLAIN_DECIMAL = /^[0-9]+(\.[0-9]{1,2})?$/;

const sha256Hex = (input) =>
  createHash('sha256').update(toBytes(input)).digest('hex');

const toBytes = (rawBody) => {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  return Buffer.alloc(0);
};

// HTTP header names are case-insensitive and callers hand us whatever their framework exposed.
const headerValue = (headers, name) => {
  if (!headers || typeof headers !== 'object') return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
};

const refuse = (reason) => ({ ok: false, reason });

/**
 * Constant-time comparison that never throws, so a mismatched-length header is a refusal rather than a
 * crash or a timing signal.
 */
const secureEquals = (expected, actual) => {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual ?? '', 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

/**
 * Signs bytes, not a stringified document. `signedString` is either the raw body (Razorpay) or a
 * `<timestamp>.` prefix concatenated with the raw body (Cashfree); Node's HMAC accepts a Buffer directly,
 * and passing a Buffer is what keeps the signed input byte-exact rather than re-encoded.
 */
const hmac = (secret, signedString, encoding) => {
  const mac = createHmac('sha256', secret);
  if (Buffer.isBuffer(signedString)) return mac.update(signedString).digest(encoding);
  return mac.update(String(signedString), 'utf8').digest(encoding);
};

const cashfreeSignedString = (timestamp, bytes) => {
  const prefix = Buffer.from(`${timestamp}.`, 'utf8');
  return Buffer.concat([prefix, bytes], prefix.length + bytes.length);
};

/**
 * Amount to paise, by string arithmetic.
 *
 * `source: 'decimal'` (the default) reads a provider's rupee string; `'minor'` reads an integer the
 * provider already sent in the smallest unit. Rounding is never applied: `999.001` is a refusal, not
 * `999.00`, because a rounded amount is an amount the order comparison will later be told to trust.
 */
function minorUnitsFromDecimal(value, options = {}) {
  const source = options.source ?? 'decimal';
  if (source === 'minor') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return refuse('amount_unrepresentable');
    // An integer too wide for the column is a different failure from a fraction: the sender meant an
    // amount, and the ledger simply cannot hold it exactly.
    if (!Number.isInteger(value)) return refuse('amount_unrepresentable');
    if (!Number.isSafeInteger(value)) return refuse('amount_out_of_range');
    if (value <= 0) return refuse('amount_not_positive');
    return { ok: true, amountMinor: value };
  }
  if (typeof value !== 'string' || !PLAIN_DECIMAL.test(value)) return refuse('amount_unrepresentable');
  const [whole, fraction = ''] = value.split('.');
  const digits = `${whole.replace(/^0+(?=[0-9])/, '')}${fraction.padEnd(2, '0')}`;
  const amountMinor = Number(digits);
  if (!Number.isSafeInteger(amountMinor)) return refuse('amount_out_of_range');
  if (amountMinor <= 0) return refuse('amount_not_positive');
  return { ok: true, amountMinor };
}

const asRef = (value) => {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

const parseJson = (bytes) => {
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Config-level mistakes are refused before any crypto, so a mis-wired route cannot look like an attack. */
const preflight = ({ secret, environment }) => {
  if (typeof secret !== 'string' || secret.length === 0) return refuse('secret_missing');
  if (!ENVIRONMENTS.includes(environment)) return refuse('environment_undeclared');
  return null;
};

const epochSecondsToIso = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const ms = value * 1000;
  if (!Number.isSafeInteger(ms) || ms < 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const RAZORPAY_EVENT_KINDS = Object.freeze({
  'payment.created': 'payment_initiated',
  'payment.pending': 'payment_initiated',
  'payment.authorized': 'payment_initiated',
  'payment.captured': 'payment_captured',
  'payment.paid': 'payment_captured',
  'order.paid': 'payment_captured',
  'payment.failed': 'payment_failed',
  'order.cancelled': 'order_cancelled',
  'refund.created': 'other',
  'refund.processed': 'refund_succeeded',
  'refund.failed': 'refund_failed',
});

const CASHFREE_PAYMENT_STATES = Object.freeze({
  PENDING: 'payment_initiated',
  INITIATED: 'payment_initiated',
  COMPLETED: 'payment_captured',
  PAID: 'payment_captured',
  FAILED: 'payment_failed',
});

const CASHFREE_REFUND_STATES = Object.freeze({
  PENDING: 'other',
  SUCCESS: 'refund_succeeded',
  COMPLETED: 'refund_succeeded',
  FAILED: 'refund_failed',
});

const REQUIRES_PAYMENT_IDENTITY = new Set([
  'payment_initiated',
  'payment_captured',
  'payment_failed',
]);

const success = (fields) => Object.freeze(fields);

/**
 * Razorpay: `x-razorpay-signature` is a lowercase-hex HMAC-SHA256 of the raw body, and the delivery's
 * identity arrives in both `x-razorpay-event-id` and `event_id`. Both are required to agree, because the
 * ledger's uniqueness rests on whichever one gets stored.
 */
function verifyRazorpayWebhook(input = {}) {
  const configFailure = preflight(input);
  if (configFailure) return configFailure;
  const { rawBody, headers, secret } = input;
  const bytes = toBytes(rawBody);

  const signature = headerValue(headers, RAZORPAY_SIGNATURE_HEADER);
  if (signature === undefined) return refuse('missing_signature');
  if (!HEX_64.test(signature)) return refuse('signature_shape');
  if (!secureEquals(hmac(secret, bytes, 'hex'), signature)) return refuse('signature_mismatch');

  const eventId = headerValue(headers, RAZORPAY_EVENT_ID_HEADER);
  if (eventId === undefined || eventId.length === 0) return refuse('missing_event_id');

  // The bytes have earned the right to be read. Only now does anything look at their shape.
  const doc = parseJson(bytes);
  if (!doc || typeof doc.event !== 'string' || doc.event.length === 0 || typeof doc.event_id !== 'string' || doc.event_id.length === 0) {
    return refuse('missing_event_shape');
  }
  if (doc.event_id !== eventId) return refuse('event_id_mismatch');

  const eventType = doc.event;
  const kind = RAZORPAY_EVENT_KINDS[eventType] ?? 'other';
  const rawBodySha256 = sha256Hex(bytes);
  const base = {
    ok: true,
    provider: 'razorpay',
    eventId,
    eventType,
    kind,
    occurredAt: epochSecondsToIso(doc.created_at),
    environment: input.environment,
    rawBodySha256,
    signedStringShape: 'raw_body',
  };

  // A kind this build does not act on still gets a truthful record, and no facts are invented for it.
  if (kind === 'other') return success(base);

  const order = doc.payload?.order?.entity;
  const merchantFromOrder =
    asRef(order?.notes?.merchant_reference) ?? asRef(order?.notes?.merchantReference);

  // Only a payment the host could be granted an entitlement for must be attributable. A refund or a
  // cancellation carries its own identity in its own entity, and refusing one for the shape of a payment
  // webhook would throw away exactly the evidence the reconciliation pass and the chargeback guardrail
  // exist to read.
  if (!REQUIRES_PAYMENT_IDENTITY.has(kind)) {
    const subject =
      kind === 'refund_succeeded' || kind === 'refund_failed'
        ? doc.payload?.refund?.entity
        : doc.payload?.order?.entity;
    const rawAmount = asRef(subject?.amount) ?? asRef(subject?.amount_refunded) ?? asRef(subject?.amount_paid);
    let amountMinor = null;
    if (rawAmount !== null && rawAmount !== undefined) {
      const amount = minorUnitsFromDecimal(Number(rawAmount), { source: 'minor' });
      if (!amount.ok) return amount;
      amountMinor = amount.amountMinor;
    }
    return success({
      ...base,
      facts: success({
        merchantReference: merchantFromOrder ?? asRef(subject?.notes?.merchant_reference),
        providerOrderRef: asRef(subject?.order_id) ?? asRef(order?.id),
        providerPaymentRef:
          asRef(subject?.payment_id) ?? asRef(subject?.id) ?? asRef(doc.payload?.payment?.entity?.id),
        amountMinor,
        currency: asRef(subject?.currency) ?? null,
        providerStatus: asRef(subject?.status),
      }),
    });
  }

  const payment = doc.payload?.payment?.entity;
  if (!payment || typeof payment !== 'object') return refuse('missing_payment_identity');

  const providerPaymentRef = asRef(payment.id);
  const providerOrderRef = asRef(payment.order_id) ?? asRef(order?.id);
  if (!providerPaymentRef && !providerOrderRef) return refuse('missing_payment_identity');

  const merchantReference = merchantFromOrder ?? asRef(payment.notes?.merchant_reference);
  if (!merchantReference) return refuse('unresolved_order_reference');

  const currency = asRef(payment.currency);
  if (!currency || !SUPPORTED_CURRENCIES.includes(currency)) return refuse('unsupported_currency');

  const amountSource = kind === 'payment_captured' ? payment.amount_paid ?? payment.amount : payment.amount;
  if (amountSource === undefined || amountSource === null) return refuse('amount_unrepresentable');
  const amount = minorUnitsFromDecimal(amountSource, { source: 'minor' });
  if (!amount.ok) return amount;

  return success({
    ...base,
    facts: success({
      merchantReference,
      providerOrderRef,
      providerPaymentRef,
      amountMinor: amount.amountMinor,
      currency,
      providerStatus: asRef(payment.status),
    }),
  });
}

/**
 * Cashfree: `x-webhook-signature` is a base64 HMAC-SHA256 of `"<x-webhook-timestamp>.<raw body>"`. The
 * timestamp is inside the signed string, which is what makes a freshness window an enforceable policy
 * rather than a preference.
 */
function verifyCashfreeWebhook(input = {}) {
  const configFailure = preflight(input);
  if (configFailure) return configFailure;
  const { rawBody, headers, secret } = input;
  const bytes = toBytes(rawBody);

  const signature = headerValue(headers, CASHFREE_SIGNATURE_HEADER);
  if (signature === undefined) return refuse('missing_signature');
  const timestamp = headerValue(headers, CASHFREE_TIMESTAMP_HEADER);
  if (timestamp === undefined) return refuse('missing_timestamp');
  if (!INTEGRAL_SECONDS.test(timestamp)) return refuse('timestamp_shape');
  if (!BASE64_32.test(signature)) return refuse('signature_shape');
  if (!secureEquals(hmac(secret, cashfreeSignedString(timestamp, bytes), 'base64'), signature)) {
    return refuse('signature_mismatch');
  }

  const tolerance =
    input.timestampToleranceMs === undefined
      ? DEFAULT_TIMESTAMP_TOLERANCE_MS
      : input.timestampToleranceMs;
  if (tolerance !== null) {
    const now = Number.isFinite(input.now) ? input.now : Date.now();
    const signedAt = Number(timestamp) * 1000;
    if (Math.abs(now - signedAt) > tolerance) return refuse('timestamp_stale');
  }

  const doc = parseJson(bytes);
  if (!doc || typeof doc.notification_id !== 'string' || doc.notification_id.length === 0 || typeof doc.notification_type !== 'string' || doc.notification_type.length === 0) {
    return refuse('missing_event_shape');
  }

  const eventId = doc.notification_id;
  const eventType = doc.notification_type;
  const payload = doc.payload && typeof doc.payload === 'object' ? doc.payload : {};
  const rawBodySha256 = sha256Hex(bytes);

  let kind;
  let facts = null;
  if (eventType === 'PAYMENT_STATE_CHANGED') {
    const to = asRef(payload?.payment_state_change?.to);
    kind = to ? CASHFREE_PAYMENT_STATES[to] : undefined;
    if (!kind) return refuse('payment_status_unrecognised');
  } else if (eventType === 'REFUND_STATE_CHANGED') {
    const to = asRef(payload?.refund_state_change?.to);
    kind = to ? CASHFREE_REFUND_STATES[to] : undefined;
    if (!kind) return refuse('payment_status_unrecognised');
  } else if (eventType === 'CHARGEBACK_CREATED' || eventType === 'CHARGEBACK_UPDATED') {
    kind = 'chargeback_opened';
  } else {
    kind = 'other';
  }

  const base = {
    ok: true,
    provider: 'cashfree',
    eventId,
    eventType,
    kind,
    occurredAt: epochSecondsToIso(doc.notification_time),
    environment: input.environment,
    rawBodySha256,
    signedStringShape: 'timestamp_dot_body',
  };

  if (kind === 'other') return success(base);

  const merchantReference =
    asRef(payload.payment_order_id) ??
    asRef(payload?.order_details?.order_id) ??
    asRef(payload?.refund_details?.payment_order_id);
  const providerOrderRef = asRef(payload.cf_order_id) ?? asRef(payload.order_id);
  const providerPaymentRef =
    asRef(payload.cf_payment_id) ?? asRef(payload.refund_id) ?? asRef(payload.chargeback_id);

  if (REQUIRES_PAYMENT_IDENTITY.has(kind)) {
    if (!providerPaymentRef && !providerOrderRef) return refuse('missing_payment_identity');
    // A captured payment we cannot attribute to an order is the one refusal that must never be relaxed:
    // without it, the amount comparison that authorises an entitlement has no subject.
    if (!merchantReference) return refuse('unresolved_order_reference');

    const currency = asRef(payload.currency_code);
    if (!currency || !SUPPORTED_CURRENCIES.includes(currency)) return refuse('unsupported_currency');

    const amountSource = asRef(payload.payment_amount);
    if (!amountSource) return refuse('amount_unrepresentable');
    const amount = minorUnitsFromDecimal(amountSource, { source: 'decimal' });
    if (!amount.ok) return amount;
    facts = success({
      merchantReference,
      providerOrderRef,
      providerPaymentRef,
      amountMinor: amount.amountMinor,
      currency,
      providerStatus: asRef(payload?.payment_state_change?.to),
    });
  } else {
    // Refunds and chargebacks may legitimately arrive without the fields a payment carries. They are
    // recorded with whatever they named, and the reconciliation pass decides whether that is enough —
    // refusing them here would lose the evidence the guardrail is meant to catch.
    const rawAmount =
      asRef(payload.refund_amount) ?? asRef(payload.chargeback_amount) ?? asRef(payload.payment_amount);
    const currency = asRef(payload.currency_code) ?? null;
    let amountMinor = null;
    if (rawAmount) {
      const amount = minorUnitsFromDecimal(rawAmount, { source: 'decimal' });
      if (!amount.ok) return amount;
      amountMinor = amount.amountMinor;
    }
    facts = success({
      merchantReference,
      providerOrderRef,
      providerPaymentRef,
      amountMinor,
      currency,
      providerStatus: asRef(payload?.refund_state_change?.to) ?? asRef(payload?.chargeback_id),
    });
  }

  return success({ ...base, facts });
}

/**
 * The one entry point a caller is meant to use. A provider name this build has not read a scheme for is
 * refused rather than guessed at, because guessing is how an unverified body reaches a ledger.
 */
function verifyProviderWebhook(input = {}) {
  if (input.provider === 'razorpay') return verifyRazorpayWebhook(input);
  if (input.provider === 'cashfree') return verifyCashfreeWebhook(input);
  return refuse('unknown_provider');
}

export {
  CASHFREE_SIGNATURE_HEADER,
  CASHFREE_TIMESTAMP_HEADER,
  DEFAULT_TIMESTAMP_TOLERANCE_MS,
  EVENT_KINDS,
  PROVIDERS,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  SUPPORTED_CURRENCIES,
  minorUnitsFromDecimal,
  sha256Hex,
  verifyCashfreeWebhook,
  verifyProviderWebhook,
  verifyRazorpayWebhook,
};
