// Stage 10's host surface, tested against the two promises its own header makes: it says what is true
// about a purchase, and it does nothing else.
//
// Three things here are worth the cells they cost, for the reason Requirement 8 gives — a host deciding
// whether they have paid, or what a failed card cost them, is deciding from these sentences:
//
//   * **The four words Requirement 8 names are asserted as literal prose.** `payment_pending`,
//     `payment_attempt_failed`, `cancelled` and `entitlement_active` are quoted from this file, not from
//     `stateWords()`. A wording change that drops either half of the failed-attempt sentence — §4 keeps
//     the order pending so a refused card is not a lost purchase, so the sentence has to carry both —
//     fails here rather than in a screenshot.
//   * **There is nothing to press.** The only controls are a re-read and a retry of the re-read. That is
//     §12's posture, and the sweep is over all thirteen states because the affordance a later copy change
//     would add is exactly the one the substrate has no door for.
//   * **A figure appears only when the server sent one to print.** Both refusals are checked: the
//     unapproved display that §7 keeps out of the payload, and the currency `formatAmountMinor` declines
//     to guess a symbol for. A money screen that goes silent about a figure is worse than one that says
//     why it is silent.
//
// What is NOT claimed here.
//   * Not that the thirteen sentences match the CASE. `state` is derived at
//     `supabase/migrations/20261019130000_stage10_host_failed_state.sql:99-116` and nothing on any tier
//     compares those words with the thirteen arms; the gap is disclosed at
//     `src/lib/commerceStatus.ts:44-45`, and this file only proves the panel prints what the lib says.
//   * Not that an unapproved price is absent from the wire. That is the projection's own rule, measured by
//     `supabase/tests/stage10/90_commerce_functions.sql` H15/H18/H19 and by HTTP D-17; the reader's half of
//     it is `src/test/commerceStatusShape.test.ts`.
//   * Not that a non-owner is refused, or that a stranger's wedding id reads as nothing. Those are
//     `supabase/tests/api/stage10_commerce_http.test.mjs` S-02 and S-06, and they live below the adapter
//     this file mocks out.
//   * Not anything about layout. jsdom lays nothing out, so no tap target, contrast or reading-order claim
//     is made here — the browser tier's job.
//   * Not that the unknown-currency sentence is reachable from the stack. Both currency columns CHECK to
//     `INR` today (`20261017120000_stage10_commerce_foundations.sql:54` and `:121`), so the deployed body
//     cannot send that pair; that cell is the component's contract, not a live path.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CommerceStatusPanel from "@/components/invitation/CommerceStatusPanel";
import { HOST_STATES, type CommerceSummary } from "@/lib/commerceStatus";

const api = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("@/integrations/supabase/commerceStatus", () => ({
  getCommerceSummary: (...args: unknown[]) => api.read(...args),
}));

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const OTHER = '7d1f0a3e-0000-4000-8000-000000000009';

/** A reading whose fields agree with each other: the price pair is present exactly when the display is
 *  approved, which is what `parseCommerceSummary` guarantees and the panel relies on. */
const summary = (overrides: Partial<CommerceSummary> = {}): CommerceSummary => ({
  weddingId: WEDDING,
  state: 'entitlement_active',
  priceAvailable: true,
  packageCode: 'classic',
  priceVersion: 3,
  orderStatus: 'paid',
  attemptStatus: 'captured',
  merchantReference: 'VV-2026-000123',
  quoteExpiresAt: null,
  capturedAt: '2026-10-18T09:12:00.123456+00:00',
  closedAt: null,
  entitlementStatus: 'active',
  refundKind: null,
  refundStatus: null,
  publishGate: 'entitlement_required',
  priceDisplayEnabled: true,
  amountMinor: 499900,
  currency: 'INR',
  ...overrides,
});

const ok = (value: CommerceSummary) => ({ data: value, error: null });
const bad = (error: string) => ({ data: null, error });

const deferred = () => {
  let resolve!: (value: { data: CommerceSummary | null; error: string | null }) => void;
  const promise = new Promise<{ data: CommerceSummary | null; error: string | null }>((r) => { resolve = r; });
  return { promise, resolve };
};

const mount = (weddingId = WEDDING) => render(<CommerceStatusPanel weddingId={weddingId} />);

/** Wait for the reading to be on screen, then hand back the sentence the host is told. */
const settled = async () => {
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull());
  return screen.getByRole('status').textContent ?? '';
};

beforeEach(() => {
  api.read.mockReset();
});

describe('saying what is true', () => {
  it('reads this wedding through the adapter and shows nothing invented while it waits', async () => {
    const gate = deferred();
    api.read.mockReturnValue(gate.promise);
    mount();

    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
    expect(api.read).toHaveBeenCalledWith(WEDDING);

    gate.resolve(ok(summary({ state: 'no_purchase', orderStatus: null, attemptStatus: null,
      merchantReference: null, entitlementStatus: null, publishGate: null, priceAvailable: false,
      packageCode: null, priceVersion: null, priceDisplayEnabled: false, amountMinor: null, currency: null })));
    expect(await settled()).toBe('Nothing has been quoted for this invitation yet.');
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('says the four things Requirement 8 names, in these words', async () => {
    const cases: [string, string][] = [
      ['payment_pending', 'A payment has been started and is not confirmed yet.'],
      ['payment_attempt_failed', 'The last attempt to pay did not go through. Trying again is still open.'],
      ['cancelled', 'The order was cancelled.'],
      ['entitlement_active', 'The payment is confirmed and what you bought is active.'],
    ];
    for (const [state, words] of cases) {
      api.read.mockReset();
      api.read.mockResolvedValue(ok(summary({ state })));
      const { unmount } = mount();
      expect(await settled()).toBe(words);
      unmount();
    }
  });

  it('keeps both halves of the failed-attempt sentence, because §4 keeps the door open', async () => {
    api.read.mockResolvedValue(ok(summary({ state: 'payment_attempt_failed', orderStatus: 'payment_pending',
      attemptStatus: 'failed' })));
    mount();
    const words = await settled();
    expect(words).toContain('did not go through');
    expect(words).toContain('Trying again is still open');
  });

  it('has a sentence for every state the vocabulary claims, so none falls back by accident', async () => {
    expect(HOST_STATES).toHaveLength(13);
    for (const state of HOST_STATES) {
      api.read.mockReset();
      api.read.mockResolvedValue(ok(summary({ state })));
      const { unmount } = mount();
      const words = await settled();
      expect(words).not.toContain('this build has no words');
      expect(words.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('frames a word this build does not know as a note about this page', async () => {
    api.read.mockResolvedValue(ok(summary({ state: 'entitlement_lapsed' })));
    const { container } = mount();
    const words = await settled();
    expect(words).toContain('this build has no words for the state “entitlement_lapsed”');
    expect(words).toContain('it is not a statement about your invitation');
    expect(container.querySelector('[role="status"]')?.className).toContain('border-warning');
  });

  it('prints the order reference and nothing else about the order', async () => {
    api.read.mockResolvedValue(ok(summary()));
    mount();
    await settled();
    expect(screen.getByText('VV-2026-000123')).toBeDefined();
    expect(screen.getByText(/quote this to whoever\s+helps you with a payment/)).toBeDefined();
  });
});

describe('the figure and its two refusals', () => {
  it('writes an approved figure, its version, and that a quote is not yet taken', async () => {
    api.read.mockResolvedValue(ok(summary({ state: 'quote_open', orderStatus: 'open', attemptStatus: null })));
    mount();
    await settled();
    expect(screen.getByText('₹4,999 once, for this invitation — price list version 3'
      + ' — quoted, not yet taken.')).toBeDefined();
  });

  it('says a price is on sale but unapproved, and prints no figure', async () => {
    api.read.mockResolvedValue(ok(summary({ state: 'payment_pending', priceDisplayEnabled: false,
      amountMinor: null, currency: null })));
    mount();
    await settled();
    expect(screen.getByText(/No figure is printed here/)).toBeDefined();
    expect(screen.getByText(/approved for\s+display/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/₹/);
  });

  it('says it has no symbol for an approved currency it has not read, rather than guessing one', async () => {
    api.read.mockResolvedValue(ok(summary({ amountMinor: 499900, currency: 'USD' })));
    mount();
    await settled();
    expect(screen.getByText(/no\s+symbol for/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/₹|US\$|\$/);
  });

  it('says nothing is on sale when the price list has no row and no order exists', async () => {
    api.read.mockResolvedValue(ok(summary({ state: 'no_purchase', priceAvailable: false, packageCode: null,
      priceVersion: null, orderStatus: null, merchantReference: null, publishGate: null,
      priceDisplayEnabled: false, amountMinor: null, currency: null })));
    mount();
    await settled();
    expect(screen.getByText(/Nothing is on sale for this invitation right now/)).toBeDefined();
  });
});

describe('the publish consequence', () => {
  it('names the gate when it gates, in both directions', async () => {
    api.read.mockResolvedValue(ok(summary({ entitlementStatus: 'active' })));
    mount();
    await settled();
    expect(screen.getByText('Publishing this invitation needs a purchase, and you have one.')).toBeDefined();
  });

  it('warns that a purchase is still owed', async () => {
    api.read.mockResolvedValue(ok(summary({ state: 'payment_pending', entitlementStatus: null })));
    mount();
    await settled();
    expect(screen.getByText(/Publishing this invitation needs a purchase, and this wedding does not have one yet/)).toBeDefined();
  });

  it('withholds the gate sentence when the shipped policy does not gate', async () => {
    for (const gate of ['none', null]) {
      api.read.mockReset();
      api.read.mockResolvedValue(ok(summary({ publishGate: gate })));
      const { unmount } = mount();
      await settled();
      expect(screen.queryByText(/Publishing this invitation/)).toBeNull();
      unmount();
    }
  });
});

describe('nothing to press', () => {
  it('offers only a re-read, in every state the vocabulary can answer', async () => {
    for (const state of HOST_STATES) {
      api.read.mockReset();
      api.read.mockResolvedValue(ok(summary({ state })));
      const { container, unmount } = mount();
      await settled();
      const controls = Array.from(container.querySelectorAll('button, a'))
        .map((node) => node.textContent?.trim());
      expect(controls).toEqual(['Refresh']);
      unmount();
    }
  });

  it('keeps §12’s sentence in the page it describes', async () => {
    api.read.mockResolvedValue(ok(summary()));
    mount();
    await settled();
    expect(
      screen.getByText(/Nothing here takes money, and pressing\s+anything on it starts no payment/),
    ).toBeDefined();
  });
});

describe('re-reading', () => {
  it('reads once on its own and again when asked', async () => {
    api.read.mockResolvedValue(ok(summary()));
    mount();
    await settled();
    expect(api.read).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDefined();
  });

  it('keeps the last reading when a re-read fails, and says the failure is about the read', async () => {
    api.read.mockResolvedValueOnce(ok(summary({ state: 'entitlement_active' })));
    mount();
    await settled();

    api.read.mockResolvedValueOnce(bad('the state of your purchase could not be read'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());

    expect(screen.getByRole('status').textContent).toBe(
      'The payment is confirmed and what you bought is active.',
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'the state of your purchase could not be read',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('disables the re-read while one is in flight, which is what keeps two presses out of the same race', async () => {
    const gate = deferred();
    api.read.mockReturnValue(gate.promise);
    mount();
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);

    gate.resolve(ok(summary()));
    await settled();
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(false);
  });

  it('will not let a read for a wedding this page no longer shows overwrite the one it does', async () => {
    const first = deferred();
    const second = deferred();
    api.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = mount();

    // The one way two of this panel's reads can overlap: the question changes while an answer is still
    // coming. A second press cannot do it — the cell above measures why — so the ticket guard is driven
    // here rather than left as a comment.
    rerender(<CommerceStatusPanel weddingId={OTHER} />);
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    expect(api.read).toHaveBeenLastCalledWith(OTHER);

    second.resolve(ok(summary({ weddingId: OTHER, state: 'cancelled' })));
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toBe('The order was cancelled.'));

    first.resolve(ok(summary({ state: 'entitlement_active' })));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status').textContent).toBe('The order was cancelled.');
  });

  it('starts from the error sentence when the very first read fails', async () => {
    api.read.mockResolvedValue(bad('the state of your purchase could not be read'));
    const { container } = mount();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());

    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(within(container.querySelector('[role="alert"]') as HTMLElement).getByText(
      'the state of your purchase could not be read',
    )).toBeDefined();
  });
});
