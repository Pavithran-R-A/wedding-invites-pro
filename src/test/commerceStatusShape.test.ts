// The reader, cell by cell — the one tier that can prove `commerceStatus.ts` refuses what it says it
// refuses.
//
// Four claims hold this file together, and they are the four rules the reader's own header states.
//
//   * **Presence is tested apart from type.** `api.commerce_host_summary` answers one `jsonb` object built
//     by a single `jsonb_build_object` call
//     (`supabase/migrations/20261019130000_stage10_host_failed_state.sql:118-143`), which writes every key
//     it is handed, so a key that stops arriving means the projection changed. The loop below deletes each
//     of the sixteen in turn and expects a refusal every time — a reader that only checked types would
//     call that "no refund" and tell a host something the database never said.
//   * **The price pair is absent, not emptied.** §7 of `docs/architecture/commerce-foundations.md` requires
//     an unapproved amount to be missing from the payload, and the live body does that with an
//     if-statement (`…:146-153`). Only the reader can make that requirement survive a careless copy change,
//     so both directions are cells: a figure beside `price_display_enabled: false` refuses, and an approval
//     whose own branch carries no figure — dropped or nulled — refuses too.
//   * **A word this build has not read is kept, not guessed.** The state arm set is a CASE, so nothing in
//     the schema would stop a fourteenth word arriving; `state` is typed `string` and `stateWords()` prints
//     an unfamiliar word as unfamiliar. The wrong *kind* still refuses, which is what the table of bad
//     payloads below is for.
//   * **The figure is written out or not at all.** `formatAmountMinor` divides by 100 and returns null for a
//     currency it has no symbol for, because printing `₹4,999` for some other unit would be a guess about
//     somebody's money.
//
// What is NOT claimed here. The sixteen key names are restated independently of the reader, which makes a
// change to one side a finding rather than a tautology — but the list itself is kept honest by the tiers
// that read the *deployed* function (`supabase/tests/stage10/90_commerce_functions.sql` H10/H14 and
// `supabase/tests/api/stage10_commerce_http.test.mjs` S-01/D-17), not by this file. Nor is this the place
// that proves a host cannot write any of these columns, or that an unapproved price is absent from a real
// response; both are SQL- and HTTP-tier claims.

import { describe, expect, it } from "vitest";

import {
  HOST_STATES,
  formatAmountMinor,
  isKnownState,
  parseCommerceSummary,
  priceWords,
  stateWords,
} from "@/lib/commerceStatus";

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';

/** One reading, as the body writes it: a captured order, an approved price, an active entitlement. */
const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  wedding_id: WEDDING,
  state: 'entitlement_active',
  price_available: true,
  package_code: 'QCLASSIC',
  price_version: 3,
  order_status: 'captured',
  attempt_status: 'confirmed',
  merchant_reference: 'vv-2026-1019-0001',
  quote_expires_at: null,
  captured_at: '2026-10-19T09:12:00+00:00',
  closed_at: null,
  entitlement_status: 'active',
  refund_kind: null,
  refund_status: null,
  publish_gate: 'entitlement_required',
  price_display_enabled: true,
  amount_minor: 499900,
  currency: 'INR',
  ...overrides,
});

/** The names the body writes on every call — the sixteen, without the conditional pair. */
const ALWAYS_PRESENT = [
  'wedding_id', 'state', 'price_available', 'package_code', 'price_version', 'order_status',
  'attempt_status', 'merchant_reference', 'quote_expires_at', 'captured_at', 'closed_at',
  'entitlement_status', 'refund_kind', 'refund_status', 'publish_gate', 'price_display_enabled',
];

/** Every case that should refuse but did, named — so one failure reports the whole set. */
const survivors = (cases: [string, unknown][]): string[] =>
  cases.filter(([, value]) => parseCommerceSummary(value) !== null).map(([name]) => name);

/** The reading above, with overrides applied and then these keys *removed* — dropping a key is a
 *  different payload from setting it to null, and the difference is the whole subject below. */
const edited = (overrides: Record<string, unknown> = {}, dropped: string[] = []): Record<string, unknown> => {
  const value = { ...payload(), ...overrides };
  for (const key of dropped) delete value[key];
  return value;
};

describe('reading the projection', () => {
  it('takes every field from the key the body writes it under', () => {
    expect(parseCommerceSummary(payload())).toEqual({
      weddingId: WEDDING,
      state: 'entitlement_active',
      priceAvailable: true,
      packageCode: 'QCLASSIC',
      priceVersion: 3,
      orderStatus: 'captured',
      attemptStatus: 'confirmed',
      merchantReference: 'vv-2026-1019-0001',
      quoteExpiresAt: null,
      capturedAt: '2026-10-19T09:12:00+00:00',
      closedAt: null,
      entitlementStatus: 'active',
      refundKind: null,
      refundStatus: null,
      publishGate: 'entitlement_required',
      priceDisplayEnabled: true,
      amountMinor: 499900,
      currency: 'INR',
    });
  });

  it('refuses when any one of the sixteen keys has stopped arriving', () => {
    // Twelve of them are nullable columns, so this is the only way to tell "this wedding has no refund"
    // from "the projection no longer mentions refunds" — and the second is not a host-facing answer.
    const missing = ALWAYS_PRESENT.map((key) =>
      [`no ${key}`, edited({}, [key])] as [string, unknown]);
    expect(survivors(missing)).toEqual([]);
  });

  it('keeps a null that arrived as a null, including the four the panel reads as absence', () => {
    const summary = parseCommerceSummary(payload({
      attempt_status: null, refund_kind: null, refund_status: null, merchant_reference: null,
    }));
    expect(summary).not.toBeNull();
    expect(summary?.attemptStatus).toBeNull();
    expect(summary?.merchantReference).toBeNull();
    expect(summary?.refundKind).toBeNull();
    expect(summary?.refundStatus).toBeNull();
  });

  it('refuses a value of the wrong kind rather than coercing it', () => {
    const bad: [string, unknown][] = [
      ['wedding_id is not a uuid', payload({ wedding_id: 'not-a-uuid' })],
      ['wedding_id is blank', payload({ wedding_id: '' })],
      ['wedding_id is a number', payload({ wedding_id: 7 })],
      ['state is blank', payload({ state: '' })],
      ['state is a number', payload({ state: 42 })],
      ['price_available is the string true', payload({ price_available: 'true' })],
      ['price_available is null', payload({ price_available: null })],
      ['price_display_enabled is not a boolean', payload({ price_display_enabled: 1 })],
      ['package_code is a number', payload({ package_code: 5 })],
      ['price_version is zero', payload({ price_version: 0 })],
      ['price_version is fractional', payload({ price_version: 1.5 })],
      ['price_version is a string', payload({ price_version: '3' })],
      ['order_status is the number zero', payload({ order_status: 0 })],
      ['captured_at is an epoch number', payload({ captured_at: 1729321920 })],
      ['publish_gate is an array', payload({ publish_gate: ['entitlement_required'] })],
      ['amount_minor is zero', payload({ amount_minor: 0 })],
      ['amount_minor is negative', payload({ amount_minor: -499900 })],
      ['amount_minor is fractional', payload({ amount_minor: 4999.5 })],
      ['amount_minor is NaN', payload({ amount_minor: Number.NaN })],
      ['amount_minor is the string of a figure', payload({ amount_minor: '499900' })],
      ['currency is lowercase', payload({ currency: 'inr' })],
      ['currency is a word', payload({ currency: 'RUPEES' })],
      ['currency is a number', payload({ currency: 400 })],
    ];
    expect(survivors(bad)).toEqual([]);
  });

  it('refuses anything that is not the single object the body returns', () => {
    const notAnObject: [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['the state on its own', 'entitlement_active'],
      ['a number', 7],
      // An array is what a read of many rows looks like. Handing a host the first element of a list they
      // were never promised would be a guess about which purchase they meant.
      ['a one-element array', [payload()]],
      ['an empty array', []],
    ];
    expect(survivors(notAnObject)).toEqual([]);
  });
});

describe('the price pair (§7: absent, not emptied)', () => {
  it('reads the two keys when display is approved', () => {
    const summary = parseCommerceSummary(payload());
    expect(summary?.priceDisplayEnabled).toBe(true);
    expect(summary?.amountMinor).toBe(499900);
    expect(summary?.currency).toBe('INR');
  });

  it('reads a clean absence when display is not approved', () => {
    const summary = parseCommerceSummary(
      edited({ price_display_enabled: false }, ['amount_minor', 'currency']));
    expect(summary).not.toBeNull();
    expect(summary?.priceDisplayEnabled).toBe(false);
    expect(summary?.amountMinor).toBeNull();
    expect(summary?.currency).toBeNull();
  });

  it('refuses a figure that arrives beside an unapproved flag — either half on its own', () => {
    // This is the leak the projection is designed to prevent, so the reader is the last place that can
    // still prevent it. Dropping the field silently would print the wrong thing forever; refusing makes
    // the host see "could not be read" and leaves the payload in the warning that explains it.
    const leaks: [string, unknown][] = [
      ['unapproved, amount key still there', edited({ price_display_enabled: false }, ['currency'])],
      ['unapproved, currency key still there', edited({ price_display_enabled: false }, ['amount_minor'])],
      ['unapproved, both keys emptied to null',
        payload({ price_display_enabled: false, amount_minor: null, currency: null })],
    ];
    expect(survivors(leaks)).toEqual([]);
  });

  it('refuses an approved flag whose own branch is missing half of it', () => {
    const halves: [string, unknown][] = [
      ['approved, amount key gone', edited({}, ['amount_minor'])],
      ['approved, currency key gone', edited({}, ['currency'])],
      ['approved, both keys nulled', payload({ amount_minor: null, currency: null })],
    ];
    expect(survivors(halves)).toEqual([]);
  });
});

describe('saying the state to the host', () => {
  it('knows the thirteen words the CASE can answer and gives each its own sentence', () => {
    expect(HOST_STATES).toHaveLength(13);
    const said = HOST_STATES.map((state) => stateWords(state));
    // Two states sharing a sentence would hide which one the door actually read.
    expect(new Set(said).size).toBe(HOST_STATES.length);
    const fallbacks = HOST_STATES.filter((state) =>
      stateWords(state) === `this build has no words for the state “${state}”`);
    expect(fallbacks).toEqual([]);
    expect(HOST_STATES.filter((state) => !isKnownState(state))).toEqual([]);
  });

  it('keeps an unfamiliar state word and says it is unfamiliar', () => {
    // A fourteenth arm in the CASE is a forward migration's ordinary move; the failure mode is this build
    // rendering it as one of the thirteen it does know.
    const summary = parseCommerceSummary(payload({ state: 'payment_reversed' }));
    expect(summary?.state).toBe('payment_reversed');
    expect(isKnownState(summary!.state)).toBe(false);
    expect(stateWords(summary!.state)).toContain('payment_reversed');
    expect(stateWords(summary!.state)).toMatch(/this build has no words for the state/);
  });

  it('says the failed attempt is a fact and an opening, not a closed door', () => {
    // Requirement 8's fourth word. §4 leaves the ORDER at payment_pending after a refused card, so the
    // only thing that distinguishes "just refused" from "waiting on the provider" on this screen is this
    // sentence — and a host who reads "failed" alone will believe the purchase is over.
    const words = stateWords('payment_attempt_failed');
    expect(words).toMatch(/did not go through/);
    expect(words).toMatch(/Trying again is still open/);
  });

  it('does not let a captured payment and an active entitlement share a sentence', () => {
    // The two states differ by whether the entitlement row exists yet, which is exactly the difference a
    // host asks support about ("I paid, why is my invitation not live?").
    expect(stateWords('captured_awaiting_entitlement')).not.toBe(stateWords('entitlement_active'));
    expect(stateWords('captured_awaiting_entitlement')).toMatch(/still being recorded/);
  });
});

describe('writing a figure out', () => {
  it('divides the minor unit and groups it the way the price list means it', () => {
    expect(formatAmountMinor(499900, 'INR')).toBe('₹4,999');
    expect(formatAmountMinor(199950, 'INR')).toBe('₹1,999.5');
    expect(formatAmountMinor(100, 'INR')).toBe('₹1');
  });

  it('refuses a currency it has no symbol for rather than borrowing one', () => {
    expect(formatAmountMinor(100, 'USD')).toBeNull();
    // A shape-valid code the orders CHECK does not allow today is still not a licence to print rupees: the
    // parser accepts the code so a future price list stays readable, and this is where it stops.
    expect(formatAmountMinor(100, 'AED')).toBeNull();
  });

  it('names the price-list version, because a frozen quote is not the current one', () => {
    expect(priceWords(parseCommerceSummary(payload())!))
      .toBe('₹4,999 once, for this invitation — price list version 3');
    expect(priceWords(parseCommerceSummary(payload({ price_version: null }))!))
      .toBe('₹4,999 once, for this invitation');
  });

  it('prints no figure when the projection carried none', () => {
    const unapproved = edited({ price_display_enabled: false }, ['amount_minor', 'currency']);
    expect(priceWords(parseCommerceSummary(unapproved)!)).toBeNull();
    // The approved flag is not by itself permission to print: a DTO whose figure went missing downstream
    // has to fall silent rather than render "₹".
    const summary = parseCommerceSummary(payload())!;
    expect(priceWords({ ...summary, amountMinor: null })).toBeNull();
    expect(priceWords({ ...summary, currency: 'USD' })).toBeNull();
  });
});
