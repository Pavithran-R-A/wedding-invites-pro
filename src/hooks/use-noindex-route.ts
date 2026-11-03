// One browser-posture rule, owned in one place: a URL that carries a credential in its path must
// never enter a search index, and must hand no link onward.
//
// Why a hook and not the shell. `index.html` is the document *every* route is served from, so a
// `noindex` written there would take the marketing and legal pages down with the guest pages — and
// those are the pages a family may reasonably be found on. The three token-bearing routes
// (`/i/<credential>`, `/r/<credential>`, `/g/<credential>`) therefore mount this themselves, each
// one at the top of its component, before any data arrives. That ordering is the point: an address
// that resolves to "this invitation is not available" is still an address that a crawler can reach,
// and the posture a search engine is asked for does not depend on what the database answered.
//
// What this reaches, stated because the difference decides the launch posture
// (`docs/superpowers/specs/2026-10-13-stage9-render-exports-design.md` §8.5): a tag written by
// script is read by a crawler that runs this bundle — Googlebot does — and by no one else.
// `facebookexternalhit` and `Twitterbot` have to be *allowed* on `/i/`, because a link a host shares
// draws its card from that fetch and blocking it in `robots.txt` would destroy the Open Graph
// contract; they do not execute the SPA, so for them `noindex` is a hosting-layer `X-Robots-Tag`
// requirement. That requirement is written by `src/host/pages-worker.ts` for all three doors and is
// verified against a real Cloudflare runtime by `scripts/host-response-contract.mjs` — on
// `127.0.0.1`, which is why this comment still cannot say a crawler has read it: the Worker is in this
// repository and not yet on a public origin. Where an unfurl is not wanted at all — the reviewer's door
// and the household's door — `robots.txt` carries `Disallow`, which needs no fetch to be honoured.
//
// The element is claimed by identity rather than by position, and it is reference-counted: the first
// consumer writes it, a later one re-uses the tag this hook already wrote, and it leaves the head only
// when the last consumer releases it. So a route change from one credential-bearing page to another
// never stacks two tags, and a page in the middle of that change never loses its posture because the
// page it came from unmounted. Today the three routes are mutually exclusive, so more than one
// consumer is unreachable in the shipped app — the count exists so that it stays correct if a layout
// ever renders two, rather than quietly dropping the rule at exactly the moment the product gets
// more complicated. The count also re-writes the tag if something else pulled it out of the document
// while a consumer still held it, because a silently missing `noindex` is the worst failure this hook
// can have: it looks identical to a page that was never asked to be indexed.

import { useEffect } from 'react';

import { NOINDEX_CONTENT } from '@/lib/robotsPosture';

/** The directive this product asks of every crawler for a credential-bearing address. Re-exported
 *  from `src/lib/robotsPosture.ts`, which is where the edge Worker reads the same string from. */
export { NOINDEX_CONTENT };

/** Marks the tag as this hook's own, so it can be re-used and removed without touching a
 *  `robots` meta that something else — the shell, a future host header — may have written. */
const POSTURE_ATTRIBUTE = 'data-route-posture';
const POSTURE_VALUE = 'noindex';

/** The tag this hook wrote, wherever it finds it. Queried rather than only remembered, so a module
 *  reload under hot-module replacement (which resets the variable below but not the document) adopts
 *  the tag it already owns instead of stacking a second one beside it. */
const ownedTag = (): HTMLMetaElement | null =>
  document.head.querySelector<HTMLMetaElement>(`meta[name="robots"][${POSTURE_ATTRIBUTE}="${POSTURE_VALUE}"]`);

/** The one tag this hook has written and has not yet released, and how many routes are holding it. */
let postureTag: HTMLMetaElement | null = null;
let consumers = 0;

export const useNoindexRoute = (): void => {
  useEffect(() => {
    if (postureTag === null || !postureTag.isConnected) {
      // `isConnected` is the half that catches a real shape: a tag that this hook wrote, that a
      // consumer is still holding, and that is no longer in the document. Without the re-write, the
      // remaining consumers would be counted against an orphan and the head would answer nothing.
      postureTag?.remove();
      const alreadyOurs = ownedTag();
      if (alreadyOurs !== null) {
        postureTag = alreadyOurs;
      } else {
        const created = document.createElement('meta');
        created.setAttribute('name', 'robots');
        created.setAttribute(POSTURE_ATTRIBUTE, POSTURE_VALUE);
        created.setAttribute('content', NOINDEX_CONTENT);
        document.head.appendChild(created);
        postureTag = created;
      }
    }
    consumers += 1;
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        const ours = ownedTag();
        if (ours !== null) ours.remove();
        postureTag = null;
      }
    };
  }, []);
};
