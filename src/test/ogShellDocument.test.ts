// The two string operations that decide what a crawler reads, pinned on their own.
//
// Why this file exists when the live tier already compares bytes. `scripts/host-response-contract.mjs`
// can say that a served door equals the body this module builds, and it does — but if this module ever
// computed the wrong body, the tier would faithfully compare two wrong things to each other and pass.
// The properties below are the ones that only this file can carry: that the removal works element by
// element rather than line by line (`index.html` writes two of its tags across several lines, so a
// line-based rule leaves orphaned fragments behind), that an empty tag list is a *decision* rather than
// a no-op, and that a shell without an insertion point is refused loudly instead of being returned with
// its brand tags intact. That last one is the failure mode this whole seam exists to avoid: a document
// that describes somebody's wedding while wearing the product's card.
//
// What is not tested here, because it is not this module's business: whether a given address deserves a
// card (`src/host/pages-worker.ts` and `src/lib/ogMetadata.ts` decide that), and what a real crawler
// does with the answer (`docs` §10.1 keeps that claim at PARTIAL for a reason).

import { describe, expect, it } from 'vitest';

import { carriesOpenGraphTags, stripOpenGraphTags, withOpenGraphTags } from '@/lib/ogShellDocument';
import { buildOgMetadata } from '@/lib/ogMetadata';
import { parsePublicInvitation } from '@/lib/publicInvitation';
import { guestPayload } from './invitationFixture';

/** A shell shaped like the real one: a page title and an author tag that are *not* part of the card,
 *  one tag written across three lines the way `index.html` writes its long description, and a body. */
const SHELL = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <title>Brand — Patrika</title>',
  '    <meta name="viewport" content="width=device-width" />',
  '    <meta',
  '      property="og:description"',
  '      content="A brand description that goes on for a while."',
  '    />',
  '    <meta name="author" content="Brand" />',
  '    <meta property="og:title" content="Brand — Patrika" />',
  '    <meta name="twitter:card" content="summary" />',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n');

const invitation = parsePublicInvitation(guestPayload({ language: 'en' }));
// Narrowing written as a failure rather than an assertion + cast: `buildOgMetadata` answers a union, and
// if this fixture ever stops producing a card the file has to say so with the reason it was given, not
// carry on with a possibly-empty tag list and make some later expectation look odd. The `in` check is
// used instead of `outcome.ok` because `tsconfig.app.json:19` sets `"strict": false`, which leaves
// `strictNullChecks` off, and a boolean discriminant does not narrow a union without it.
const tagsOrRefusal = (outcome: ReturnType<typeof buildOgMetadata>) => {
  if ('reason' in outcome) throw new Error(`the fixture must build a card — ${outcome.reason}`);
  return outcome.tags;
};
const cardTags = tagsOrRefusal(buildOgMetadata({
  invitation,
  url: 'https://vivaahvarnam.example/i/0ycxsxgXDUqNBkrvZICYf7m7Y6olVCv4x6buLCFSux0',
  previewImageUrl: null,
}));

describe('stripOpenGraphTags', () => {
  it('removes the card block and leaves everything else standing', () => {
    const stripped = stripOpenGraphTags(SHELL);
    expect(carriesOpenGraphTags(stripped)).toBe(false);
    expect(stripped).toContain('<title>Brand — Patrika</title>');
    expect(stripped).toContain('<meta name="author" content="Brand" />');
    expect(stripped).toContain('name="viewport"');
    expect(stripped).toContain('<div id="root">');
    expect(stripped).toContain('</head>');
  });

  it('works element by element, so a tag split across lines dies whole', () => {
    // The multi-line `og:description` is the case a regex over lines would survive: dropping only the
    // first line would leave `content="…"` and `/>` behind as fragments inside the head.
    // A line-based rule would drop only the first line of that tag and leave the rest in the head, so
    // the assertion is about the residue: no line may begin with an attribute or a lone close, because
    // the only tags written that way here were card tags and they are supposed to be gone whole. (The
    // viewport tag is on one line and starts with `<meta`, so it cannot match and must not.)
    const stripped = stripOpenGraphTags(SHELL);
    expect(stripped).not.toContain('A brand description that goes on for a while.');
    expect(stripped).not.toContain('property="og:description"');
    expect(stripped).not.toMatch(/^[ \t]+(?:\/>|property=|content=|name=)/m);
  });

  it('treats an unquoted attribute value as no card at all, which is a limit worth naming', () => {
    // Measured, and the measurement is what makes this case worth keeping. The module's two functions
    // agree here: `OPEN_GRAPH_KEY` requires a quote after `=`, so an unquoted `name=twitter:card` is
    // neither removed by the strip nor reported by the probe. That consistency is the safe half — the
    // removal cannot disagree with the ownership test, because they are the same predicate. The unsafe
    // half is that a document can carry a brand card this module does not see, so a *green*
    // `carriesOpenGraphTags` is not by itself proof that no card is on the wire.
    //
    // Which is why the byte-level claim is made somewhere that does not reuse this predicate: HR-11 and
    // HR-12 of `scripts/host-response-contract.mjs` count card-shaped `property`/`name` values in the
    // served bytes with a tolerant expression of their own, quoted or not. Today's `dist/index.html`
    // quotes every attribute in the block, and that tier measures those bytes rather than trusting this
    // file's opinion about them.
    const unquoted = '<head><meta name=twitter:card content=summary /></head>';
    expect(stripOpenGraphTags(unquoted)).toBe(unquoted);
    expect(carriesOpenGraphTags(unquoted)).toBe(false);
  });

  it('is idempotent, because a host may build the same document twice for the same address', () => {
    const once = stripOpenGraphTags(SHELL);
    expect(stripOpenGraphTags(once)).toBe(once);
  });

  it('does not carry a match cursor between calls', () => {
    // `String.replace` with a `/g` pattern restarts at zero; a shared `/g` pattern used with `.test()`
    // would not, and `carriesOpenGraphTags` is built on one. Two identical shells must give the same
    // answer twice in a row rather than true-then-false.
    expect(carriesOpenGraphTags(SHELL)).toBe(true);
    expect(carriesOpenGraphTags(SHELL)).toBe(true);
    expect(carriesOpenGraphTags(stripOpenGraphTags(SHELL))).toBe(false);
    expect(carriesOpenGraphTags(stripOpenGraphTags(SHELL))).toBe(false);
  });
});

describe('withOpenGraphTags', () => {
  it('installs the card inside the head, before the body begins', () => {
    const served = withOpenGraphTags(SHELL, cardTags);
    expect(served).toContain('property="og:title"');
    expect(served.indexOf('property="og:title"')).toBeLessThan(served.indexOf('<body'));
    expect(carriesOpenGraphTags(served)).toBe(true);
  });

  it('replaces the brand card rather than adding a second one', () => {
    const served = withOpenGraphTags(SHELL, cardTags);
    const titles = served.match(/property="og:title"/g) ?? [];
    expect(titles).toHaveLength(1);
    expect(served).not.toContain('A brand description that goes on for a while.');
  });

  it('treats an empty list as a refusal, not as a no-op', () => {
    const refused = withOpenGraphTags(SHELL, []);
    expect(refused).not.toBe(SHELL);
    expect(carriesOpenGraphTags(refused)).toBe(false);
    // A refused document keeps its shell: the app still has to boot for the guest who typed the address.
    expect(refused).toContain('<div id="root">');
  });

  it('refuses a shell it cannot insert into instead of returning it unchanged', () => {
    const headless = '<!doctype html><html><body><div id="root"></div></body></html>';
    expect(() => withOpenGraphTags(headless, cardTags)).toThrow(/no <\/head>/);
    expect(() => withOpenGraphTags(headless, [])).toThrow();
  });

  it('escapes the invitation\'s own text the way the metadata module does', () => {
    // The card is built by `buildOgMetadata`, which owns escaping; this file's job is only to place the
    // bytes it produced. A hostile title must not be able to close the head and open a script.
    const hostile = buildOgMetadata({
      invitation: { ...invitation, title: '"><script>alert(1)</script>' },
      url: 'https://vivaahvarnam.example/i/0ycxsxgXDUqNBkrvZICYf7m7Y6olVCv4x6buLCFSux0',
      previewImageUrl: null,
    });
    const served = withOpenGraphTags(SHELL, tagsOrRefusal(hostile));
    expect(served).not.toContain('<script>alert(1)');
    expect(served.match(/<\/head>/g)).toHaveLength(1);
  });
});
