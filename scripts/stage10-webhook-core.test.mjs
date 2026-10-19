// S10-2: the webhook verifier's decisions, pinned with no database, no network and no provider.
//
// Why this half of Stage 10 is tested before anything touches Postgres. `stage10-webhook-core.mjs` is
// the only code in this stage that answers "did the payment provider really send this, and what does it
// say". Everything downstream — the ledger, the state machine, the entitlement, the host's panel — treats
// its answer as fact. A verifier that is *nearly* right is the worst component in a billing system: it
// turns an attacker's bytes into a paid wedding. So every case below is about the properties that make
// that impossible, and none of them needs a container.
//
// What these tests hold the core to:
//
//   * **Signature first, parsing second.** The provider signs a byte string, so the byte string is what
//     gets verified, and JSON only gets read if the bytes earned it. WH-01..WH-06 include the case where
//     a body is both unsigned *and* unparseable, and the refusal must be the signature.
//   * **A canonical comparison is not a comparison.** Re-serialised JSON — same document, different byte
//     order — must fail, because that is the exact shape of a proxy, a framework body parser, or an
//     `express.json()` middleware that "helpfully" rewrote the request.
//   * **The two providers' schemes are not interchangeable, and the difference is the point.** Razorpay
//     sends a hex digest of the raw body; Cashfree sends a base64 digest of `"<timestamp>.<body>"`. A
//     digest valid under one scheme is presented to the other and must be refused, and the encodings are
//     checked before any comparison so a wrong-shaped header cannot even reach the equality test.
//   * **Constant-time, and unbothered by length.** A mismatched-length header must not throw, because a
//     `throwing` comparison is a signal, and a crash on attacker-chosen input is a denial of service in
//     whatever host wires this up.
//   * **Freshness is claimed only where it is signed.** Cashfree's timestamp is inside the signed string,
//     so a tolerance can be enforced. Razorpay's is not, so the core refuses to pretend otherwise:
//     replay defence there is the event id, and a fixture proves the tolerance knob is inert for Razorpay.
//   * **The identity of a delivery is cross-checked, not picked.** Razorpay sends an event id in both the
//     header and the payload; a disagreement between them is a refusal, because the ledger's unique key
//     can only be as trustworthy as the column it came from.
//   * **Money arrives as a fact to be checked, never as a number to be trusted.** Minor units are derived
//     by string arithmetic, a third of a paise is refused rather than rounded, and a currency outside the
//     configured list is refused before it can reach a comparison against an order.
//   * **Nothing here receives a browser's word.** The exported surface is exactly the provider webhooks,
//     and a checkout-callback-shaped payload — including one carrying a mathematically valid
//     `order_id|payment_id` HMAC under a test secret — is refused as a delivery that has no event shape.
//   * **A secret never leaves the call.** Every returned object is scanned for the secret it was given.
//
// The fixtures sign themselves with hand-written test keys. That is deliberate: a captured real payload
// would be a second source of truth about what a provider sends, and the point of these cases is the
// *rule* the core applies to bytes, not the bytes.

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CASHFREE_TIMESTAMP_HEADER,
  DEFAULT_TIMESTAMP_TOLERANCE_MS,
  EVENT_KINDS,
  PROVIDERS,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  SUPPORTED_CURRENCIES,
  CASHFREE_SIGNATURE_HEADER,
  minorUnitsFromDecimal,
  sha256Hex,
  verifyCashfreeWebhook,
  verifyProviderWebhook,
  verifyRazorpayWebhook,
} from './stage10-webhook-core.mjs';

// Hand-written fixture keys, deliberately shaped so no credential scanner can mistake them for a
// provider's: they are not validly-formed keys, they name their own purpose, and they sign only the
// payloads in this file. The verifier takes its key as an argument, so nothing here is a configuration
// value and nothing here can authenticate a real delivery.
const RAZORPAY_TEST_KEY = 'synthetic-razorpay-fixture-key-0001';
const CASHFREE_TEST_KEY = 'synthetic-cashfree-fixture-key-0001';

// Read from the module namespace itself rather than a hand-typed list, so the list WH-41 asserts against
// cannot drift away from the file it describes.
const surface = await import('./stage10-webhook-core.mjs');

// Shared by the Cashfree block and by WH-42, which exercises both schemes.
const TS = '1760000000';

/** The signed string is the raw body, exactly. So the fixture builds bytes, then signs them. */
const razorpayBody = (event, eventId, overrides = {}) =>
  JSON.stringify({
    event,
    event_id: eventId,
    account_id: 'acc_test_123',
    created_at: 1760000000,
    payload: overrides,
  });

const cashfreeBody = (notificationId, notificationType, payload) =>
  JSON.stringify({
    notification_id: notificationId,
    notification_type: notificationType,
    notification_time: 1760000000,
    payload,
  });

const hexSign = (body, secret = RAZORPAY_TEST_KEY) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

const cfSign = (timestamp, body, secret = CASHFREE_TEST_KEY) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('base64');

const NOW = 1760000060_000;

const noSecretLeak = (result, secret) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(secret);
};

describe('the provider surface is closed', () => {
  it('WH-00: names exactly the two researched providers, the two schemes, and nothing else', () => {
    expect([...PROVIDERS].sort()).toEqual(['cashfree', 'razorpay']);
    // The header names are the ones each provider's own documentation uses. Spelling them in one place
    // is what stops a fixture from agreeing with a bug instead of with a provider.
    expect(RAZORPAY_SIGNATURE_HEADER).toBe('x-razorpay-signature');
    expect(RAZORPAY_EVENT_ID_HEADER).toBe('x-razorpay-event-id');
    expect(CASHFREE_SIGNATURE_HEADER).toBe('x-webhook-signature');
    expect(CASHFREE_TIMESTAMP_HEADER).toBe('x-webhook-timestamp');
    expect(SUPPORTED_CURRENCIES).toEqual(['INR']);
    expect(DEFAULT_TIMESTAMP_TOLERANCE_MS).toBe(300_000);
    // A pinned kind list: an unrecognised provider event is recorded as `other` and never guessed at,
    // so a provider adding an event type cannot make this build act on something it has not read.
    expect([...EVENT_KINDS].sort()).toEqual(
      [
        'chargeback_opened',
        'order_cancelled',
        'other',
        'payment_captured',
        'payment_failed',
        'payment_initiated',
        'refund_failed',
        'refund_succeeded',
      ].sort(),
    );
  });
});

describe('Razorpay: HMAC-SHA256 of the raw body, hex, in x-razorpay-signature', () => {
  const body = razorpayBody(
    'payment.captured',
    'evt_1ABCDEFGH',
    {
      payment: {
        entity: {
          id: 'pay_1ABCDEF',
          order_id: 'order_1ABCDEF',
          amount: 99900,
          amount_paid: 99900,
          currency: 'INR',
          status: 'captured',
        },
      },
      order: { entity: { id: 'order_1ABCDEF', notes: { merchant_reference: 'vv1.9f3c1a2b' } } },
    },
  );

  it('WH-01: verifies a genuine delivery and reports the facts the ledger needs', () => {
    const result = verifyRazorpayWebhook({
      rawBody: body,
      headers: { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('razorpay');
    expect(result.eventId).toBe('evt_1ABCDEFGH');
    expect(result.eventType).toBe('payment.captured');
    expect(result.kind).toBe('payment_captured');
    expect(result.facts.amountMinor).toBe(99900);
    expect(result.facts.currency).toBe('INR');
    expect(result.facts.merchantReference).toBe('vv1.9f3c1a2b');
    expect(result.facts.providerPaymentRef).toBe('pay_1ABCDEF');
    expect(result.facts.providerOrderRef).toBe('order_1ABCDEF');
    expect(result.environment).toBe('synthetic');
    // The digest is of the bytes that were signed, which is the only reason it is worth storing.
    expect(result.rawBodySha256).toBe(sha256Hex(Buffer.from(body, 'utf8')));
    noSecretLeak(result, RAZORPAY_TEST_KEY);
  });

  it('WH-02: refuses a signature made under the wrong secret', () => {
    const result = verifyRazorpayWebhook({
      rawBody: body,
      headers: { 'x-razorpay-signature': hexSign(body, 'rp_wrong_secret'), 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
    expect(result.facts).toBeUndefined();
    noSecretLeak(result, RAZORPAY_TEST_KEY);
  });

  it('WH-03: refuses a body swapped under a valid signature', () => {
    // The signature is over the original bytes; the attacker edits the amount. Verification is of the
    // bytes presented, so the edit cannot travel with the signature.
    const tampered = body.replace('"amount":99900', '"amount":1');
    const result = verifyRazorpayWebhook({
      rawBody: tampered,
      headers: { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('WH-04: refuses a re-serialised body, because a document is not the bytes that were signed', () => {
    const reparsed = JSON.stringify(JSON.parse(body), Object.keys(JSON.parse(body)));
    expect(reparsed).not.toBe(body); // guard the fixture: if this ever holds, the case proves nothing
    const result = verifyRazorpayWebhook({
      rawBody: reparsed,
      headers: { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('WH-05: accepts a Buffer and a UTF-8 string for the same bytes, and refuses a signature header of the wrong shape', () => {
    const good = { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_1ABCDEFGH' };
    expect(
      verifyRazorpayWebhook({ rawBody: Buffer.from(body, 'utf8'), headers: good, secret: RAZORPAY_TEST_KEY, environment: 'synthetic' }).ok,
    ).toBe(true);
    for (const bad of ['', 'nope', '0'.repeat(63), `${'0'.repeat(64)}aa`, '<script>']) {
      const result = verifyRazorpayWebhook({
        rawBody: body,
        headers: { 'x-razorpay-signature': bad, 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
        secret: RAZORPAY_TEST_KEY,
        environment: 'synthetic',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_shape');
    }
  });

  it('WH-06: checks the signature before parsing, so an unsigned unparseable body refuses for the signature', () => {
    const junk = '{ not json at all';
    const result = verifyRazorpayWebhook({
      rawBody: junk,
      headers: { 'x-razorpay-signature': hexSign('a different body entirely'), 'x-razorpay-event-id': 'evt_X' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.reason).toBe('signature_mismatch');
  });

  it('WH-07: refuses a missing signature header and a missing event id header', () => {
    expect(
      verifyRazorpayWebhook({ rawBody: body, headers: {}, secret: RAZORPAY_TEST_KEY, environment: 'synthetic' }).reason,
    ).toBe('missing_signature');
    expect(
      verifyRazorpayWebhook({
        rawBody: body,
        headers: { 'x-razorpay-signature': hexSign(body) },
        secret: RAZORPAY_TEST_KEY,
        environment: 'synthetic',
      }).reason,
    ).toBe('missing_event_id');
  });

  it('WH-08: refuses when the header event id and the payload event id disagree', () => {
    // The ledger's unique key is one column. Two candidate identities for one delivery is not a
    // harmless redundancy, it is a way to make a replay look like a new event.
    const result = verifyRazorpayWebhook({
      rawBody: body,
      headers: { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_2ZZZZZZZZ' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('event_id_mismatch');
  });

  it('WH-09: reads headers case-insensitively, because HTTP does', () => {
    const result = verifyRazorpayWebhook({
      rawBody: body,
      headers: { 'X-Razorpay-Signature': hexSign(body), 'X-Razorpay-Event-Id': 'evt_1ABCDEFGH' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(true);
  });

  it('WH-10: does not enforce a timestamp tolerance, because nothing timestamped is signed', () => {
    // Honest limitation, tested so it cannot be "fixed" by trusting an unsigned header. Razorpay's
    // replay defence is the event id; a freshness window here would be theatre.
    const result = verifyRazorpayWebhook({
      rawBody: body,
      headers: { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
      now: NOW + 86_400_000,
      timestampToleranceMs: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('WH-11: maps its event vocabulary and records anything else as other', () => {
    // The probe carries every entity a mapped kind could need, so a failure here means the *mapping* is
    // wrong rather than the delivery being unattributable — which WH-13, WH-16 and WH-27 pin separately.
    const payload = {
      payment: {
        entity: {
          id: 'pay_map',
          order_id: 'order_map',
          amount: 99900,
          amount_paid: 99900,
          currency: 'INR',
          status: 'captured',
        },
      },
      order: {
        entity: {
          id: 'order_map',
          amount_paid: 99900,
          currency: 'INR',
          status: 'fulfilled',
          notes: { merchant_reference: 'vv1.map' },
        },
      },
      refund: {
        entity: { id: 'rfnd_map', payment_id: 'pay_map', amount: 99900, currency: 'INR', status: 'processed' },
      },
    };
    const verdictFor = (event) => {
      const rawBody = razorpayBody(event, `evt_${event.length}`, payload);
      return verifyRazorpayWebhook({
        rawBody,
        headers: { 'x-razorpay-signature': hexSign(rawBody), 'x-razorpay-event-id': `evt_${event.length}` },
        secret: RAZORPAY_TEST_KEY,
        environment: 'synthetic',
      });
    };
    for (const [event, kind] of [
      ['payment.created', 'payment_initiated'],
      ['payment.captured', 'payment_captured'],
      ['payment.failed', 'payment_failed'],
      ['order.paid', 'payment_captured'],
      ['order.cancelled', 'order_cancelled'],
      ['refund.processed', 'refund_succeeded'],
      ['refund.failed', 'refund_failed'],
      ['subscription.charged', 'other'],
      ['some.brand.new.event', 'other'],
    ]) {
      const result = verdictFor(event);
      expect(result.ok, event).toBe(true);
      expect(result.kind, event).toBe(kind);
    }
  });

  it('WH-12: refuses a delivery with no event vocabulary at all, which is what a checkout callback is', () => {
    // Razorpay's browser callback carries `razorpay_order_id|razorpay_payment_id` and a signature that
    // is arithmetically valid under the key secret. It is still not a delivery: no event, no event id,
    // and nothing in this build may accept a signature from a page.
    const forged = JSON.stringify({
      razorpay_order_id: 'order_1ABCDEF',
      razorpay_payment_id: 'pay_1FORGED',
      razorpay_signature: hexSign('order_1ABCDEF|pay_1FORGED'),
    });
    const result = verifyRazorpayWebhook({
      rawBody: forged,
      headers: { 'x-razorpay-signature': hexSign(forged), 'x-razorpay-event-id': 'evt_forge' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_event_shape');
  });

  it('WH-13: refuses an unresolvable merchant reference rather than inventing one', () => {
    const body2 = razorpayBody('payment.captured', 'evt_no_notes', {
      payment: { entity: { id: 'pay_2', order_id: 'order_2', amount: 100, currency: 'INR' } },
    });
    const result = verifyRazorpayWebhook({
      rawBody: body2,
      headers: { 'x-razorpay-signature': hexSign(body2), 'x-razorpay-event-id': 'evt_no_notes' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unresolved_order_reference');
  });

  it('WH-14: refuses a currency outside the configured list before any amount is trusted', () => {
    const body2 = razorpayBody('payment.captured', 'evt_sgd', {
      payment: { entity: { id: 'pay_3', order_id: 'order_3', amount: 99900, currency: 'SGD' } },
      order: { entity: { id: 'order_3', notes: { merchant_reference: 'vv1.x' } } },
    });
    const result = verifyRazorpayWebhook({
      rawBody: body2,
      headers: { 'x-razorpay-signature': hexSign(body2), 'x-razorpay-event-id': 'evt_sgd' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported_currency');
  });

  it('WH-15: requires the caller to declare which environment the key it is using belongs to', () => {
    // 'live' is never a default, and 'synthetic' is never implied: the environment recorded on a money
    // row is the fact that gates `live_capture_enabled`, so it has to be asserted by the operator.
    for (const environment of [undefined, '', 'production', 'LIVE']) {
      const result = verifyRazorpayWebhook({
        rawBody: body,
        headers: { 'x-razorpay-signature': hexSign(body), 'x-razorpay-event-id': 'evt_1ABCDEFGH' },
        secret: RAZORPAY_TEST_KEY,
        environment,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('environment_undeclared');
    }
  });

  it('WH-16: refuses a body carrying no payment or order entity for an event that must name one', () => {
    const body2 = razorpayBody('payment.captured', 'evt_empty', {});
    const result = verifyRazorpayWebhook({
      rawBody: body2,
      headers: { 'x-razorpay-signature': hexSign(body2), 'x-razorpay-event-id': 'evt_empty' },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_payment_identity');
  });
});

describe('Cashfree: HMAC-SHA256 of "<timestamp>.<body>", base64, in x-webhook-signature', () => {
  const body = cashfreeBody('ntf_1captured', 'PAYMENT_STATE_CHANGED', {
    entity: 'payment',
    payment_order_id: 'vv1.9f3c1a2b',
    cf_order_id: 555123,
    cf_payment_id: 888456,
    payment_method: 'upi',
    currency_code: 'INR',
    payment_amount: '999.00',
    payment_state_change: { from: 'INITIATED', to: 'COMPLETED' },
  });
  const TS = '1760000000';
  const headersFor = (signature = cfSign(TS, body), timestamp = TS) => ({
    'x-webhook-signature': signature,
    'x-webhook-timestamp': timestamp,
  });

  it('WH-20: verifies a genuine delivery, including the timestamp that is inside the signed string', () => {
    const result = verifyCashfreeWebhook({
      rawBody: body,
      headers: headersFor(),
      secret: CASHFREE_TEST_KEY,
      environment: 'synthetic',
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('cashfree');
    expect(result.eventId).toBe('ntf_1captured');
    expect(result.eventType).toBe('PAYMENT_STATE_CHANGED');
    expect(result.kind).toBe('payment_captured');
    expect(result.facts.amountMinor).toBe(99900);
    expect(result.facts.merchantReference).toBe('vv1.9f3c1a2b');
    expect(result.facts.providerOrderRef).toBe('555123');
    expect(result.facts.providerPaymentRef).toBe('888456');
    expect(result.signedStringShape).toBe('timestamp_dot_body');
    noSecretLeak(result, CASHFREE_TEST_KEY);
  });

  it('WH-21: refuses a signature computed over the body alone, which is the Razorpay scheme', () => {
    const bodyOnly = createHmac('sha256', CASHFREE_TEST_KEY).update(body, 'utf8').digest('base64');
    const result = verifyCashfreeWebhook({
      rawBody: body,
      headers: headersFor(bodyOnly),
      secret: CASHFREE_TEST_KEY,
      environment: 'synthetic',
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('WH-22: refuses a hex digest where base64 is required, before comparing anything', () => {
    const result = verifyCashfreeWebhook({
      rawBody: body,
      headers: headersFor(hexSign(body, CASHFREE_TEST_KEY)),
      secret: CASHFREE_TEST_KEY,
      environment: 'synthetic',
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_shape');
  });

  it('WH-23: refuses a tampered body, a missing signature and a missing timestamp', () => {
    expect(
      verifyCashfreeWebhook({
        rawBody: body.replace('999.00', '0.01'),
        headers: headersFor(),
        secret: CASHFREE_TEST_KEY,
        environment: 'synthetic',
        now: NOW,
      }).reason,
    ).toBe('signature_mismatch');
    expect(
      verifyCashfreeWebhook({ rawBody: body, headers: {}, secret: CASHFREE_TEST_KEY, environment: 'synthetic', now: NOW }).reason,
    ).toBe('missing_signature');
    expect(
      verifyCashfreeWebhook({
        rawBody: body,
        headers: { 'x-webhook-signature': cfSign(TS, body) },
        secret: CASHFREE_TEST_KEY,
        environment: 'synthetic',
        now: NOW,
      }).reason,
    ).toBe('missing_timestamp');
  });

  it('WH-24: enforces freshness only where the timestamp is signed', () => {
    const stale = '1759900000'; // hours before `now`
    const signedStale = cfSign(stale, body);
    const withinTolerance = verifyCashfreeWebhook({
      rawBody: body,
      headers: headersFor(cfSign('1760000059', body), '1760000059'),
      secret: CASHFREE_TEST_KEY,
      environment: 'synthetic',
      now: NOW,
    });
    expect(withinTolerance.ok).toBe(true);
    expect(
      verifyCashfreeWebhook({
        rawBody: body,
        headers: headersFor(signedStale, stale),
        secret: CASHFREE_TEST_KEY,
        environment: 'synthetic',
        now: NOW,
      }).reason,
    ).toBe('timestamp_stale');
    // The signature is still valid when stale, which is the point: freshness is an added policy, and
    // turning it off has to be an explicit knob, not a bug.
    expect(
      verifyCashfreeWebhook({
        rawBody: body,
        headers: headersFor(signedStale, stale),
        secret: CASHFREE_TEST_KEY,
        environment: 'synthetic',
        now: NOW,
        timestampToleranceMs: null,
      }).ok,
    ).toBe(true);
  });

  it('WH-25: refuses a timestamp that is not integral seconds, because the signed string is built from it verbatim', () => {
    for (const timestamp of ['', ' 1760000000', '1760000000.5', '1760000000000', '0x1760000000']) {
      const result = verifyCashfreeWebhook({
        rawBody: body,
        headers: headersFor(cfSign(timestamp, body), timestamp),
        secret: CASHFREE_TEST_KEY,
        environment: 'synthetic',
        now: NOW,
        timestampToleranceMs: null,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('timestamp_shape');
    }
  });

  it('WH-26: maps its state vocabulary, including refunds and chargebacks', () => {
    const verdictFor = (notificationType, payload) => {
      const b = cashfreeBody(`ntf_${notificationType}`, notificationType, payload);
      return verifyCashfreeWebhook({
        rawBody: b,
        headers: headersFor(cfSign(TS, b), TS),
        secret: CASHFREE_TEST_KEY,
        environment: 'synthetic',
        now: NOW,
        timestampToleranceMs: null,
      });
    };
    const state = (to) => ({ entity: 'payment', payment_order_id: 'vv1.a', cf_payment_id: 1, currency_code: 'INR', payment_amount: '999.00', payment_state_change: { to } });
    expect(verdictFor('PAYMENT_STATE_CHANGED', state('PENDING')).kind).toBe('payment_initiated');
    expect(verdictFor('PAYMENT_STATE_CHANGED', state('COMPLETED')).kind).toBe('payment_captured');
    expect(verdictFor('PAYMENT_STATE_CHANGED', state('FAILED')).kind).toBe('payment_failed');
    expect(verdictFor('PAYMENT_STATE_CHANGED', state('USER_STATE_CHANGED'))).toMatchObject({ ok: false, reason: 'payment_status_unrecognised' });
    expect(
      verdictFor('REFUND_STATE_CHANGED', { entity: 'refund', refund_id: 'r1', refund_amount: '999.00', refund_state_change: { to: 'SUCCESS' } }).kind,
    ).toBe('refund_succeeded');
    expect(
      verdictFor('CHARGEBACK_CREATED', { chargeback_id: 'cb1', chargeback_amount: '999.00', currency_code: 'INR' }).kind,
    ).toBe('chargeback_opened');
    expect(
      verdictFor('PAYMENT_AUTH_CODE_CREATED', { entity: 'payment' }).kind,
    ).toBe('other');
  });

  it('WH-27: refuses a refund delivery that names no merchant order, so it cannot be mis-attributed', () => {
    const b = cashfreeBody('ntf_noref', 'PAYMENT_STATE_CHANGED', {
      entity: 'payment',
      cf_payment_id: 42,
      currency_code: 'INR',
      payment_amount: '999.00',
      payment_state_change: { to: 'COMPLETED' },
    });
    const result = verifyCashfreeWebhook({
      rawBody: b,
      headers: headersFor(cfSign(TS, b), TS),
      secret: CASHFREE_TEST_KEY,
      environment: 'synthetic',
      now: NOW,
      timestampToleranceMs: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unresolved_order_reference');
  });
});

describe('minor units, because an amount is the fact a webhook must not be allowed to round', () => {
  it('WH-30: reads a two-decimal rupee string by string arithmetic', () => {
    expect(minorUnitsFromDecimal('999.00')).toEqual({ ok: true, amountMinor: 99900 });
    expect(minorUnitsFromDecimal('0.01')).toEqual({ ok: true, amountMinor: 1 });
    expect(minorUnitsFromDecimal('999')).toEqual({ ok: true, amountMinor: 99900 });
    expect(minorUnitsFromDecimal('999.9')).toEqual({ ok: true, amountMinor: 99990 });
  });

  it('WH-31: refuses anything that would need rounding, and anything that is not a plain decimal', () => {
    for (const value of ['999.001', '-5', '-5.00', '', ' ', '1e3', '9,999.00', '999.00.0', 'NaN', 'Infinity', 'ॐ']) {
      expect(minorUnitsFromDecimal(value)).toEqual({ ok: false, reason: 'amount_unrepresentable' });
    }
  });

  it('WH-32: accepts an exact integer from the wire and refuses a non-integer number', () => {
    expect(minorUnitsFromDecimal(99900, { source: 'minor' })).toEqual({ ok: true, amountMinor: 99900 });
    expect(minorUnitsFromDecimal(99900.5, { source: 'minor' })).toEqual({ ok: false, reason: 'amount_unrepresentable' });
    expect(minorUnitsFromDecimal(0, { source: 'minor' })).toEqual({ ok: false, reason: 'amount_not_positive' });
    expect(minorUnitsFromDecimal(-1, { source: 'minor' })).toEqual({ ok: false, reason: 'amount_not_positive' });
  });

  it('WH-33: refuses an over-wide amount rather than storing a truncation', () => {
    // The boundary that matters is the largest integer the ledger column can hold exactly, checked after
    // the paise shift — so it is asserted against `amountMinor`, not against the rupee figure that came
    // off the wire. One below the ceiling stores; one at `MAX_SAFE_INTEGER + 1` is a refusal, never a
    // silent clamp, because a clamped amount is an amount a later comparison will be told to trust.
    expect(minorUnitsFromDecimal('90071992547409.91')).toEqual({
      ok: true,
      amountMinor: 9007199254740991,
    });
    expect(minorUnitsFromDecimal('90071992547409.92')).toEqual({
      ok: false,
      reason: 'amount_out_of_range',
    });
    expect(minorUnitsFromDecimal('9'.repeat(30))).toEqual({
      ok: false,
      reason: 'amount_out_of_range',
    });
    expect(minorUnitsFromDecimal(9007199254740992, { source: 'minor' })).toEqual({
      ok: false,
      reason: 'amount_out_of_range',
    });
  });
});

describe('the identity a refund, chargeback or cancellation is stored under', () => {
  // These four cases decide a fact the ledger cannot decide for itself. `record_commerce_event` has one
  // reference argument for a delivery that is not a payment, and it writes that argument into
  // `private.commerce_refunds.provider_refund_ref`
  // (`20261017120000_stage10_commerce_foundations.sql:1307-1320`) — the column a person uses to find the
  // movement again at the provider. A refund id and the payment it reverses are different objects, so
  // which one this module puts in that slot is the whole difference between "the reader can find the
  // credit" and "the reader is sent to the charge".
  const rzVerdict = (event, eventId, payload) => {
    const rawBody = razorpayBody(event, eventId, payload);
    return verifyRazorpayWebhook({
      rawBody,
      headers: { 'x-razorpay-signature': hexSign(rawBody), 'x-razorpay-event-id': eventId },
      secret: RAZORPAY_TEST_KEY,
      environment: 'synthetic',
    });
  };

  const cfVerdict = (type, payload) => {
    const rawBody = cashfreeBody(`ntf_${type.toLowerCase()}`, type, payload);
    return verifyCashfreeWebhook({
      rawBody,
      headers: { 'x-webhook-signature': cfSign(TS, rawBody), 'x-webhook-timestamp': TS },
      secret: CASHFREE_TEST_KEY,
      environment: 'synthetic',
      now: NOW,
    });
  };

  it('WH-43: a Razorpay refund is stored under the refund id, not the payment it reverses', () => {
    const result = rzVerdict('refund.processed', 'evt_rz_refund', {
      payment: { entity: { id: 'pay_rz1', order_id: 'order_rz1', amount: 99900, currency: 'INR', status: 'captured' } },
      order: { entity: { id: 'order_rz1', notes: { merchant_reference: 'vv1.rz' }, currency: 'INR', status: 'paid' } },
      refund: {
        entity: {
          id: 'rfnd_rz1', payment_id: 'pay_rz1', order_id: 'order_rz1', amount: 99900, currency: 'INR',
          status: 'processed', notes: { merchant_reference: 'vv1.rz' },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('refund_succeeded');
    expect(result.facts.providerPaymentRef).toBe('rfnd_rz1');
    expect(result.facts.providerOrderRef).toBe('order_rz1');
    expect(result.facts.merchantReference).toBe('vv1.rz');
    expect(result.facts.amountMinor).toBe(99900);
    noSecretLeak(result, RAZORPAY_TEST_KEY);
  });

  it('WH-44: a cancellation stores the payment it cancelled, and never its own order id in that slot', () => {
    const bare = rzVerdict('order.cancelled', 'evt_rz_cancel', {
      order: { entity: { id: 'order_rz2', notes: { merchant_reference: 'vv1.rz2' }, currency: 'INR', status: 'cancelled' } },
    });
    expect(bare.ok).toBe(true);
    expect(bare.kind).toBe('order_cancelled');
    expect(bare.facts.providerOrderRef).toBe('order_rz2');
    // `null`, not `'order_rz2'`. `commerce_attempts_payment_ref_uk` is unique on (provider,
    // provider_payment_ref), so an order id written into the payment slot would collide with the real
    // payment for that order the next time one is back-filled.
    expect(bare.facts.providerPaymentRef).toBe(null);

    const withPayment = rzVerdict('order.cancelled', 'evt_rz_cancel_b', {
      payment: { entity: { id: 'pay_rz2', order_id: 'order_rz2', amount: 99900, currency: 'INR', status: 'failed' } },
      order: { entity: { id: 'order_rz2', notes: { merchant_reference: 'vv1.rz2' }, currency: 'INR', status: 'cancelled' } },
    });
    expect(withPayment.facts.providerPaymentRef).toBe('pay_rz2');
  });

  it('WH-45: a Cashfree refund is stored under its refund_id while its payment id is also present', () => {
    const result = cfVerdict('REFUND_STATE_CHANGED', {
      entity: 'refund', refund_id: 'rfnd_cf1', cf_payment_id: 'pay_cf1', cf_order_id: 'order_cf1',
      payment_order_id: 'vv1.cf', refund_amount: '999.00', currency_code: 'INR',
      refund_state_change: { from: 'PENDING', to: 'SUCCESS' },
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('refund_succeeded');
    expect(result.facts.providerPaymentRef).toBe('rfnd_cf1');
    expect(result.facts.providerOrderRef).toBe('order_cf1');
    expect(result.facts.merchantReference).toBe('vv1.cf');
    expect(result.facts.amountMinor).toBe(99900);
    noSecretLeak(result, CASHFREE_TEST_KEY);
  });

  it('WH-46: a chargeback takes its own id, and a payment still takes cf_payment_id', () => {
    const cb = cfVerdict('CHARGEBACK_CREATED', {
      entity: 'chargeback', chargeback_id: 'cb_cf1', cf_payment_id: 'pay_cf1', cf_order_id: 'order_cf1',
      payment_order_id: 'vv1.cf', chargeback_amount: '999.00', currency_code: 'INR',
    });
    expect(cb.ok).toBe(true);
    expect(cb.kind).toBe('chargeback_opened');
    expect(cb.facts.providerPaymentRef).toBe('cb_cf1');

    // Kind-awareness must not leak into the payment arm: `cf_payment_id` is the payment's own identity and
    // the attempt row is matched on it, so a refund-shaped precedence here would strand every capture.
    const pay = cfVerdict('PAYMENT_STATE_CHANGED', {
      entity: 'payment', payment_order_id: 'vv1.cf', cf_order_id: 'order_cf1', cf_payment_id: 'pay_cf1',
      currency_code: 'INR', payment_amount: '999.00', payment_state_change: { from: 'INITIATED', to: 'COMPLETED' },
    });
    expect(pay.kind).toBe('payment_captured');
    expect(pay.facts.providerPaymentRef).toBe('pay_cf1');
  });
});

describe('the dispatcher, and what it refuses to be', () => {
  it('WH-40: routes by provider and refuses an unknown one', () => {
    expect(
      verifyProviderWebhook({ provider: 'stripe', rawBody: '{}', headers: {}, secret: 'x', environment: 'synthetic' }).reason,
    ).toBe('unknown_provider');
  });

  it('WH-41: is the only exported entry point a caller may use, and exposes no checkout-callback verifier', () => {
    // This assertion exists because the defect it prevents is a future colleague adding
    // `verifyCheckoutCallback` next to the webhook verifier and calling it from a route. A browser's
    // word is not a delivery, and the surface has to be reviewable as small.
    expect([...PROVIDERS]).toHaveLength(2);
    const exported = Object.keys(surface);
    expect(exported.sort()).toEqual(
      [
        'CASHFREE_SIGNATURE_HEADER',
        'CASHFREE_TIMESTAMP_HEADER',
        'DEFAULT_TIMESTAMP_TOLERANCE_MS',
        'EVENT_KINDS',
        'PROVIDERS',
        'RAZORPAY_EVENT_ID_HEADER',
        'RAZORPAY_SIGNATURE_HEADER',
        'SUPPORTED_CURRENCIES',
        'minorUnitsFromDecimal',
        'sha256Hex',
        'verifyCashfreeWebhook',
        'verifyProviderWebhook',
        'verifyRazorpayWebhook',
      ].sort(),
    );
  });

  it('WH-42: never returns the secret it was given, in any branch', () => {
    const branches = [
      verifyProviderWebhook({ provider: 'razorpay', rawBody: '', headers: {}, secret: RAZORPAY_TEST_KEY, environment: 'synthetic' }),
      verifyProviderWebhook({ provider: 'cashfree', rawBody: '', headers: {}, secret: CASHFREE_TEST_KEY, environment: 'synthetic' }),
      verifyProviderWebhook({ provider: 'razorpay', rawBody: '{}', headers: { 'x-razorpay-signature': 'z'.repeat(64), 'x-razorpay-event-id': 'e' }, secret: RAZORPAY_TEST_KEY, environment: 'synthetic' }),
      verifyProviderWebhook({ provider: 'cashfree', rawBody: '{}', headers: { 'x-webhook-signature': 'zzzz', 'x-webhook-timestamp': TS }, secret: CASHFREE_TEST_KEY, environment: 'sandbox' }),
    ];
    for (const result of branches) {
      expect(result.ok).toBe(false);
      const text = JSON.stringify(result);
      expect(text).not.toContain(RAZORPAY_TEST_KEY);
      expect(text).not.toContain(CASHFREE_TEST_KEY);
      expect(text).not.toContain('undefined'); // a reason is always a name
    }
  });
});
