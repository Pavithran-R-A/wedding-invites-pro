// What this wedding's purchase looks like, from the inside of the one door a browser session may knock on.
//
// Stage 10 shipped six private tables, seven internal service bodies and exactly one door an
// authenticated browser session can reach: `api.commerce_host_summary`, a one-line SECURITY INVOKER delegation
// (`supabase/migrations/20261017120000_stage10_commerce_foundations.sql:1646-1652`) to a DEFINER body that
// re-derives the caller from `auth.uid()` and refuses anybody who does not own the wedding
// (`20261019130000_stage10_host_failed_state.sql:58-64`). `internal_api` is not an exposed schema at all, so
// the wrapper is the only spelling a client has. So this file has one job and one shape: hand a
// wedding id to that door, and refuse to describe an answer that is not the projection the body writes.
//
// What it deliberately is not:
//   * **Not a second read path.** There is no `from('commerce_orders')` here, and `product:check` would
//     refuse one: every `.from()` name in this directory has to be a table the generated types describe
//     (`scripts/check-db-contract.mjs:533-536`), and Stage 10's money tables are all in `private`, which
//     the generator never reads. The stronger reason is that those tables are not exposed to PostgREST at
//     all, so a direct read is not a shortcut, it is a different question than the one the substrate
//     answers. The RPC is the only way to see a purchase that also applies the owner check.
//   * **Not a way to make a payment happen.** There is no initiation call, no checkout address and no
//     provider name in this file, because there is nothing in `api` to call for one: capture arrives in
//     the ledger through a signed delivery from the provider's servers, which no browser session can
//     forge and none needs to (`supabase/tests/stage10/80_commerce_ledger.sql` drives that path). §12's
//     read-only posture is a property of the grants, and this file keeps it by naming nothing else.
//   * **Not a place that softens a refusal.** The body raises `insufficient_privilege` for a wedding the
//     caller does not own, and PostgREST's message names the policy. `describe()` keeps that prose in
//     `console.warn` and the caller gets one fixed sentence, which is Stage 9's posture for the same
//     reason: a host cannot act on a policy name, and the surface that shows it to them is also the
//     surface that would show it to a screenshot.
//   * **Not a cache.** One call, one read, returned to the component. Nothing is written to a row, a
//     draft or storage — including the amount, which is absent from the payload entirely unless the
//     price's own `display_approved` is true (`20261019130000_stage10_host_failed_state.sql:146-153`).
//
// WHERE THIS FILE HAS BEEN MEASURED. `src/test/commerceStatusTransport.test.ts` runs this function against
// a recording stand-in for the client and asserts the door's name, its one argument, the refusal wording
// and the fact that a table read is impossible here. Against the real stack, the projection this parses is
// driven by `supabase/tests/stage10/90_commerce_functions.sql` group H and by
// `supabase/tests/api/stage10_commerce_http.test.mjs` — including D-17, which reads the failed-attempt
// state and the retry out of the deployed function. Whether a signed-in non-owner is refused at the door
// is `…stage10_commerce_http.test.mjs` S-06, not this file's claim.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import { parseCommerceSummary, type CommerceSummary } from '@/lib/commerceStatus';
import type { QueryResult } from './weddings';

const MODULE = 'commerceStatus';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

/**
 * The host's reading of their own wedding's purchase, or the reason there is not one.
 *
 * A wedding with nothing quoted is a real answer and comes back as a summary whose state is
 * `no_purchase` — not an empty result and not an error — because the body always writes an object
 * (`20261019130000_stage10_host_failed_state.sql:100`), and the panel has a sentence for that case that
 * it cannot say if this layer reports a failure instead.
 */
export async function getCommerceSummary(
  weddingId: string,
): Promise<QueryResult<CommerceSummary>> {
  const { data, error } = await supabase
    .schema('api')
    .rpc('commerce_host_summary', { p_wedding_id: weddingId });
  if (error) return fail('the state of your purchase could not be read', error);
  const summary = parseCommerceSummary(data);
  if (summary === null) return fail('the state of your purchase could not be read', null);
  return { data: summary, error: null };
}
