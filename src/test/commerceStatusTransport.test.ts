// The host's one knock on the one door a browser session may use for money.
//
// Three claims hold this file together.
//
//   * **Exactly one call, with the name and the argument the migration grants.** `api.commerce_host_summary`
//     is the only Stage 10 door an authenticated browser session can reach: it is granted at
//     `supabase/migrations/20261017120000_stage10_commerce_foundations.sql:1654-1656`, the `internal_api`
//     body behind it is not an exposed schema at all (`…stage10_commerce_http.test.mjs` S-04 answers 406),
//     and that body keeps its own `REVOKE ALL` from every client role at `:1632-1633` — so the assertions are
//     about the call itself: the schema, the function name, the single `p_wedding_id` argument, and the fact
//     that nothing else on the client is touched. The stand-in below has no working `from` or
//     `storage.from`: a table read is not merely disfavoured here, it fails loudly.
//   * **A refusal is a phrase, not a schema dump.** PostgREST's `message`, `details` and `hint` name
//     constraints and policies; `describe()` reduces the error to a category and a code
//     (`src/lib/safeError.ts:62-70`) and the caller receives one fixed sentence. A test that asserted this
//     adapter returned the database's prose would be testing a leak.
//   * **An answer this build cannot read is a refusal, not a partial screen.** The projection is written by
//     one `jsonb_build_object` call, so a payload missing a key or carrying a figure it says is unapproved
//     is the body changing shape, and the adapter's job is to stop rather than to render half a promise
//     about money.
//
// What is NOT claimed here. That the door refuses a non-owner, grants nothing to `anon`, or omits an
// unapproved amount from a real response — those are `supabase/tests/api/stage10_commerce_http.test.mjs`
// S-02/S-06/S-07/S-11 and `supabase/tests/stage10/90_commerce_functions.sql` H14/H18. Nor that a payment
// cannot be started anywhere in the app: the structural cell below proves only that this module offers no
// such call, and §12's "no checkout UI" refusal is `product:check`'s rule, not this file's. Nothing here
// touches a running stack. A throw out of the client library is also not handled here, which is the
// convention of this directory: no adapter in `src/integrations/supabase/` catches one, because the
// transport's contract is the resolved `{ data, error }` pair.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const schema = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn(() => {
  throw new Error('this adapter reads nothing from Storage: a purchase summary has no object behind it');
}));
const from = vi.hoisted(() => vi.fn(() => {
  throw new Error('a purchase is read through api.commerce_host_summary, never from a table');
}));

schema.mockReturnValue({ rpc });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { schema, storage: { from: storageFrom }, from },
}));

import * as commerceStatusModule from "@/integrations/supabase/commerceStatus";
import { getCommerceSummary } from "@/integrations/supabase/commerceStatus";

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';

/** The projection as the deployed body writes it: sixteen keys always, the price pair only when approved. */
const projection = (overrides: Record<string, unknown> = {}, dropped: string[] = []) => {
  const value: Record<string, unknown> = {
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
  };
  for (const key of dropped) delete value[key];
  return value;
};

/** The PostgREST shape of a 42501: the fields Postgres writes, and two of them name the schema. */
const REFUSAL = {
  code: '42501',
  message: 'the caller may not read this wedding',
  details: 'Policy on table commerce_orders blocks the read.',
  hint: 'Re-check auth.uid() against commerce_orders.wedding_id',
};

let warnSpy: MockInstance;

beforeEach(() => {
  rpc.mockReset();
  schema.mockClear();
  storageFrom.mockClear();
  from.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the one door', () => {
  it('knocks once, on the api schema, with the wedding id and nothing else', async () => {
    rpc.mockResolvedValue({ data: projection(), error: null });

    const result = await getCommerceSummary(WEDDING);

    expect(schema).toHaveBeenCalledWith('api');
    expect(schema).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('commerce_host_summary', { p_wedding_id: WEDDING });
    expect(result.error).toBeNull();
    expect(result.data?.state).toBe('entitlement_active');
  });

  it('hands the component exactly the projection’s fields, in the host’s names', async () => {
    rpc.mockResolvedValue({ data: projection(), error: null });
    const { data } = await getCommerceSummary(WEDDING);
    expect(Object.keys(data!).sort()).toEqual([
      'amountMinor', 'attemptStatus', 'capturedAt', 'closedAt', 'currency', 'entitlementStatus',
      'merchantReference', 'orderStatus', 'packageCode', 'priceAvailable', 'priceDisplayEnabled',
      'priceVersion', 'publishGate', 'quoteExpiresAt', 'refundKind', 'refundStatus', 'state', 'weddingId',
    ]);
  });

  it('treats a wedding with nothing quoted as an answer, not a failure', async () => {
    // The `no_purchase` arm is a state the panel has a sentence for. Turning "nothing has been bought" into
    // an error would be the adapter inventing a problem the database did not report.
    rpc.mockResolvedValue({
      data: projection({
        state: 'no_purchase', price_available: false, package_code: null, price_version: null,
        order_status: null, attempt_status: null, merchant_reference: null, captured_at: null,
        entitlement_status: null, publish_gate: null, price_display_enabled: false,
      }, ['amount_minor', 'currency']),
      error: null,
    });

    const result = await getCommerceSummary(WEDDING);
    expect(result.error).toBeNull();
    expect(result.data?.state).toBe('no_purchase');
    expect(result.data?.amountMinor).toBeNull();
    expect(result.data?.currency).toBeNull();
  });

  it('makes a fresh call every time — nothing about money is cached here', async () => {
    rpc.mockResolvedValue({ data: projection(), error: null });
    await getCommerceSummary(WEDDING);
    await getCommerceSummary(WEDDING);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('offers no way to start, retry or cancel a payment', () => {
    // §12 refuses a checkout UI, and the shape of this module is where that refusal is checkable: one
    // export, and it is a read. A future `startPayment` appearing here would be a product decision the
    // design note says has not been made, so it has to be a deliberate edit to this cell to arrive.
    expect(Object.keys(commerceStatusModule)).toEqual(['getCommerceSummary']);
  });

  it('never reaches for a table or an object, because that is a different question', async () => {
    rpc.mockResolvedValue({ data: projection(), error: null });
    await getCommerceSummary(WEDDING);
    expect(from).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
  });
});

describe('what a refusal is allowed to say', () => {
  it('answers the owner check with one fixed sentence', async () => {
    rpc.mockResolvedValue({ data: null, error: REFUSAL });

    const result = await getCommerceSummary(WEDDING);
    expect(result.data).toBeNull();
    expect(result.error).toBe('the state of your purchase could not be read');
  });

  it('keeps the database’s own prose out of the caller’s hands and out of the log line', async () => {
    rpc.mockResolvedValue({ data: null, error: REFUSAL });
    const result = await getCommerceSummary(WEDDING);

    // The error's `details` and `hint` name a table and a policy. Only the code and the category may be
    // logged, so neither the caller nor the console sees `commerce_orders`.
    expect(JSON.stringify(result)).not.toContain('commerce_orders');
    expect(JSON.stringify(result)).not.toContain('auth.uid()');
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('42501');
    expect(logged).toContain('forbidden');
    expect(logged).not.toContain('commerce_orders');
    expect(logged).not.toContain('Policy on table');
  });

  it('refuses a projection that changed shape instead of rendering half of it', async () => {
    // Both halves of the reader's rule, seen from the door: a key that stopped arriving, and a figure that
    // arrived while the flag said it may not be shown. Neither is a screen; both are one sentence.
    for (const broken of [
      projection({}, ['attempt_status']),
      projection({ price_display_enabled: false }),
      projection({ wedding_id: 'not-a-uuid' }),
      null,
      'entitlement_active',
    ]) {
      rpc.mockResolvedValue({ data: broken, error: null });
      const result = await getCommerceSummary(WEDDING);
      expect(result.data).toBeNull();
      expect(result.error).toBe('the state of your purchase could not be read');
    }
  });

  it('logs the code none for an unreadable payload, so the two failures stay tellable apart', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getCommerceSummary(WEDDING);
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('code none');
  });
});
