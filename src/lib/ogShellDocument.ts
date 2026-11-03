// The document a host sends for a token-bearing address, as one pair of functions.
//
// Why this file exists. `src/lib/ogMetadata.ts` turns a frozen invitation into a list of `<meta>`
// tags, and Stage 9's loopback harness (`scripts/og-serving-adapter.mjs`) turns those tags plus the
// built shell into the bytes a crawler reads. The next runtime is a real host — an edge Worker in
// front of a static build — and it needs exactly the same two string operations. Re-stating them
// there would create a second source of truth for the one thing §10.1 is about: that the shell's
// brand tags are *gone* rather than shadowed, and that the words inserted in their place came from
// the document rather than from the template.
//
// The removal is a replacement of whole elements, not of lines, and it matches `og:`/`twitter:` on
// the tag's own `property`/`name` value. Matching the element rather than the line is what keeps
// `index.html:33-46` — which writes two of its tags across several lines — from surviving the cut as
// an orphaned fragment. `String.prototype.replace` with a global regex restarts at zero every call,
// so the shared pattern below carries no hidden cursor between requests; the ownership test is
// deliberately non-global for the same reason.
//
// Nothing here decides *whether* a page gets tags. That belongs to the caller, because it is a
// question about the request: an address whose document cannot be resolved gets an empty head rather
// than the brand's card, and this module's job is only to say what "replace the Open Graph block"
// means in bytes.

import { serializeOgMetaTags, type OgMetaTag } from './ogMetadata.ts';

/** Every `<meta>` element in the document, considered one at a time. */
const META_ELEMENT = /<meta\b[^>]*>/g;

/** A `<meta>` this repository owns because it is part of the Open Graph or Twitter card block. */
const OPEN_GRAPH_KEY = /\b(?:property|name)\s*=\s*["'](?:og:|twitter:)/i;

/** The insertion point. A shell without it is a build this function refuses rather than a document it
 *  silently returns unchanged — an unchanged shell would serve the brand's tags as if they described
 *  the guest's wedding. */
const HEAD_CLOSE = /<\/head>/i;

/** The shell with every Open Graph and Twitter `<meta>` removed and everything else — the page title,
 *  its `description`, its `referrer`, its `viewport`, every script and stylesheet — left alone. */
export const stripOpenGraphTags = (shell: string): string =>
  shell.replace(META_ELEMENT, (tag) => (OPEN_GRAPH_KEY.test(tag) ? '' : tag));

/** True when any Open Graph or Twitter tag survives in these bytes. The probe asserts this on both
 *  sides of the seam: false after a replacement set is installed, and false for a page that was
 *  refused, where it is the difference between "nothing invented" and "the brand said it". */
export const carriesOpenGraphTags = (html: string): boolean => OPEN_GRAPH_KEY.test(html);

/**
 * The shell with its Open Graph block replaced by `tags`.
 *
 * Empty `tags` is a meaningful answer, not a no-op: it produces the shell with no card at all, which
 * is what a refused or unresolvable address must serve. `serializeOgMetaTags` is called unconditionally
 * so the empty case goes through the same escape path as the populated one rather than around it.
 */
export const withOpenGraphTags = (shell: string, tags: readonly OgMetaTag[]): string => {
  const stripped = stripOpenGraphTags(shell);
  if (!HEAD_CLOSE.test(stripped)) {
    throw new Error('the shell has no </head> to insert into');
  }
  return stripped.replace(HEAD_CLOSE, `${serializeOgMetaTags(tags)}\n  </head>`);
};
