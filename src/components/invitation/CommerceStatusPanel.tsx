// What is true about this wedding's purchase, said to the person who owns it.
//
// Stage 10's host surface, and the whole of it is one sentence plus, sometimes, one figure. That shape
// is forced by four facts the substrate already decides.
//
//   * **The state is derived, so the panel cannot offer to change it.** `state` is a CASE over the order,
//     its newest payment attempt, the entitlement and the latest refund
//     (`20261019130000_stage10_host_failed_state.sql:99-116`); no column in it is writable by a session,
//     and Requirement 6 of the Stage 10 order is the reason. So there is no button here that starts,
//     stops, retries or cancels anything — the only control is a re-read, and §12 of the design note is
//     what makes that the right amount of power for a browser page to have about money. The footer
//     sentence is therefore a checked fact rather than a habit: `client-side-checkout-affordance` in
//     `scripts/check-product-contract.mjs` refuses a payment-starting call, a provider SDK and a
//     pay-button label anywhere under `src/` — and this file is scanned by it, which is how the rule was
//     measured before it was quoted here.
//   * **A price appears only when its own display is approved.** The live body leaves `amount_minor` and
//     `currency` out of the object entirely while the package's `display_approved` is false
//     (`20261019130000_stage10_host_failed_state.sql:146-153`, the same if-statement the original body
//     wrote at `…foundations.sql:1619-1626`), and the reader refuses a payload
//     that carries a figure it also says is unapproved. Requirement 8 asks for the pending, failed,
//     cancelled and verified states "without displaying unapproved prices", and the honest way to satisfy
//     that is a panel which prints a figure only when the server sent one — not one that hides it with CSS.
//   * **A failure is not a closed door.** `payment_attempt_failed` comes from the attempt, because §4
//     deliberately keeps the order pending after a refused card so the customer can try again; the
//     sentence below says both halves, because a host who reads only "failed" will believe they lost the
//     purchase. `supabase/tests/stage10/90_commerce_functions.sql` H23a..H33 drives exactly that pair,
//     including the retry that takes the failure off this screen.
//   * **Nothing here is evidence.** No provider name, no provider object reference, no attempt timestamp
//     and no refund amount reach this panel, because none of them is in the projection
//     (`20261019130000_stage10_host_failed_state.sql:163-171`). A host who needs the ledger has support
//     and the order reference printed below; an operator who needs the ledger has
//     `internal_api.commerce_reconcile`, which no session can call.
//
// An unfamiliar word is printed as what it is — "this build has no words for the state …", framed as a
// note about this page rather than as a fact about the wedding — which is the posture Stages 7, 8 and 9
// took at their own doors.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getCommerceSummary } from '@/integrations/supabase/commerceStatus';
import {
  isKnownState,
  priceWords,
  stateWords,
  type CommerceSummary,
} from '@/lib/commerceStatus';

export interface CommerceStatusPanelProps {
  /** The wedding whose purchase to read. The door takes this id and re-derives the caller from the
   *  session's own JWT, so an id belonging to somebody else's wedding is refused there rather than
   *  quietly rendering nothing here. */
  weddingId: string;
}

/** The publish consequence, and only when the shipped policy actually gates publishing.
 *  `publish_gate` is in the projection precisely so a host can be told why the publish step is waiting
 *  for them; printing it while the gate is permissive would invent a condition that is not in force, so
 *  the whole sentence is withheld. */
const publishGateWords = (summary: CommerceSummary): string | null => {
  if (summary.publishGate !== 'entitlement_required') return null;
  return summary.entitlementStatus === 'active'
    ? 'Publishing this invitation needs a purchase, and you have one.'
    : 'Publishing this invitation needs a purchase, and this wedding does not have one yet.';
};

const CommerceStatusPanel = ({ weddingId }: CommerceStatusPanelProps) => {
  const [summary, setSummary] = useState<CommerceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which read is still the current question: a re-press and a slow first read can answer in either
   *  order, and the older answer must not overwrite the newer one. */
  const ticket = useRef(0);

  const load = useCallback(async () => {
    ticket.current += 1;
    const mine = ticket.current;
    setBusy(true);
    const result = await getCommerceSummary(weddingId);
    if (mine !== ticket.current) return;
    setBusy(false);
    if (result.error !== null || result.data === null) {
      // A failed read keeps the last reading on screen. It says something about the read, not about
      // the purchase, and silently clearing would tell the host their wedding went back to unpaid.
      setLoadError(result.error ?? 'the state of your purchase could not be read');
      return;
    }
    setSummary(result.data);
    setLoadError(null);
  }, [weddingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const price = summary === null ? null : priceWords(summary);
  const gate = summary === null ? null : publishGateWords(summary);
  const unknown = summary !== null && !isKnownState(summary.state);

  return (
    <section className="space-y-4" aria-labelledby="commerce-heading">
      <div className="flex items-start justify-between gap-2">
        <h2 id="commerce-heading" className="font-display text-sm font-semibold">
          Your invitation&rsquo;s purchase
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-lg h-11"
          onClick={() => { void load(); }}
          disabled={busy}
        >
          Refresh
        </Button>
      </div>

      {summary === null && loadError === null ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : null}

      {loadError !== null ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg h-11"
            onClick={() => { void load(); }}
            disabled={busy}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {summary !== null ? (
        <>
          <p
            role="status"
            aria-live="polite"
            className={
              unknown
                ? 'rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-snug text-warning'
                : 'text-sm leading-snug'
            }
          >
            {stateWords(summary.state)}
            {unknown
              ? ' If this wedding should show something else, the reading above is out of date with this '
                + 'build; it is not a statement about your invitation.'
              : ''}
          </p>

          {!summary.priceAvailable && summary.orderStatus === null ? (
            <p className="text-xs leading-snug text-muted-foreground">
              Nothing is on sale for this invitation right now, so there is nothing to pay for it yet.
            </p>
          ) : null}

          {price !== null ? (
            <p className="text-sm font-medium">
              {price}
              {summary.priceDisplayEnabled && summary.orderStatus === 'open'
                ? ' — quoted, not yet taken.'
                : ''}
            </p>
          ) : summary.orderStatus !== null && !summary.priceDisplayEnabled ? (
            <p className="text-xs leading-snug text-muted-foreground">
              No figure is printed here. This page shows a price only once that price is approved for
              display; the amount on your order has not changed by that.
            </p>
          ) : summary.orderStatus !== null && summary.amountMinor !== null ? (
            // Reachable only from the component, not from the stack: both currency columns CHECK to
            // `INR` today (`…foundations.sql:54` and `:121`), so the deployed body cannot send this
            // pair. It is here for the day the reader accepts a code and `formatAmountMinor` declines
            // to guess its symbol — and a money page that simply omits the figure is the silence this
            // panel's own header says it will not keep.
            <p className="text-xs leading-snug text-muted-foreground">
              A figure is recorded for this order, but it is named in a currency this page has no
              symbol for, so no amount is printed here. Nothing about your order has changed by that.
            </p>
          ) : null}

          {summary.merchantReference !== null ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Order reference{' '}
              <span className="font-mono">{summary.merchantReference}</span> — quote this to whoever
              helps you with a payment; it names your order and nothing else about it.
            </p>
          ) : null}

          {gate !== null ? (
            <p className="text-xs leading-snug text-muted-foreground">{gate}</p>
          ) : null}

          <p className="text-xs leading-snug text-muted-foreground">
            This page tells you what is true about a purchase. Nothing here takes money, and pressing
            anything on it starts no payment.
          </p>
        </>
      ) : null}
    </section>
  );
};

export default CommerceStatusPanel;
