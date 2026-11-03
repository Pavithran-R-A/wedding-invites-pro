// What this build asks of a crawler, in the two places a crawler actually looks.
//
// Issue #1's P0-5 is "OG and crawler verification". The share-card half of it was closed at Stage 9
// (`src/lib/ogMetadata.ts`); the crawlability half had a plan and no implementation
// (`docs/superpowers/specs/2026-10-13-stage9-render-exports-design.md` §8.5, and
// `docs/architecture/stage-2-domain-blueprint.md`'s "noindex on token-bearing URLs"). Both mechanisms
// are here, because they are not interchangeable and neither one alone covers the three doors:
//
//   * `public/robots.txt` keeps `/r/` and `/g/` out *without a fetch*, which is what a credential in
//     a path needs, and leaves `/i/` reachable because the card a chat app draws comes from that
//     fetch. This file reads the shipped text rather than the served one, so a future edit to it goes
//     red in `npm test` instead of waiting for a browser tier.
//   * `src/hooks/use-noindex-route.ts` writes `noindex, nofollow` for the three door routes. That is
//     a script-written tag, so it governs a crawler that runs the bundle and nobody else; the
//     unfurl-only crawlers that do not run it are the hosting layer's `X-Robots-Tag` job, now written
//     by `src/host/pages-worker.ts` and measured on a real runtime by `scripts/host-response-contract.mjs`
//     — on loopback only, so no claim here says a crawler has obeyed it. See the hook's own header.
//
// What this file does NOT prove: that the served document is the one on disk (that is the browser
// tier's `RB-*` cells), that any real crawler obeys either instruction (nothing here can show that),
// and that the `Allow`/`Disallow` split survives a host that rewrites `robots.txt` at the edge.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

import { useNoindexRoute } from '@/hooks/use-noindex-route';
import CookiePolicy from '@/pages/CookiePolicy';

const SELECTOR = 'meta[name="robots"][data-route-posture="noindex"]';

/** The tag this product owns, as a search engine would find it: by its identity, not by position. */
const postureTags = () => [...document.head.querySelectorAll<HTMLMetaElement>(SELECTOR)];

const ROBOTS = resolve(process.cwd(), 'public/robots.txt');
const SHELL = resolve(process.cwd(), 'index.html');

/** One `user-agent` record: the agents it names and the paths it allows and refuses. */
interface RobotRecord {
  readonly agents: readonly string[];
  readonly allow: readonly string[];
  readonly disallow: readonly string[];
}

/** Records, not lines — which is the shape the standard has. A blank line closes a record, so a
 *  `Disallow` written under one `user-agent` never reaches the next, and a parser that flattened the
 *  whole file into one set could read a missing disallow as a present one. The comments in the file
 *  are stripped the way a crawler strips them, and an unknown field is ignored the way the standard
 *  says to ignore it, so neither can hide a group boundary. */
const parseRecords = (text: string): RobotRecord[] => {
  const records: RobotRecord[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') {
      if (current !== null) records.push(current);
      current = null;
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field !== 'user-agent' && field !== 'allow' && field !== 'disallow') continue;
    current ??= { agents: [], allow: [], disallow: [] };
    if (field === 'user-agent') current.agents.push(value);
    if (field === 'allow') current.allow.push(value);
    if (field === 'disallow') current.disallow.push(value);
  }
  if (current !== null) records.push(current);
  return records;
};

/** The route a consumer of the hook stands in for. */
const Door = () => {
  useNoindexRoute();
  return <p>A credential-bearing door</p>;
};

beforeEach(() => {
  cleanup();
  // The head starts every cell with nothing in it that this hook wrote. A failure here is not a
  // broken expectation about the product — it is a previous cell that left a mount alive, which
  // would make every count below it meaningless.
  expect(postureTags()).toHaveLength(0);
});

describe("the posture a credential-bearing route mounts", () => {
  it("writes the directive on mount and leaves the head clean on release", () => {
    const { unmount } = render(<Door />);
    expect(postureTags()).toHaveLength(1);
    expect(postureTags()[0].getAttribute('content')).toBe('noindex, nofollow');
    expect(postureTags()[0].isConnected).toBe(true);
    unmount();
    expect(postureTags()).toHaveLength(0);
  });

  it("holds one tag for two routes, and keeps the rule when the first one leaves", () => {
    // The assertion that matters is the middle one. Without the count, the page a visitor came
    // from would delete the posture of the page they are now on — which reads as an indexable
    // door, silently.
    const first = render(<Door />);
    const second = render(<Door />);
    expect(postureTags()).toHaveLength(1);
    first.unmount();
    expect(postureTags()).toHaveLength(1);
    expect(postureTags()[0].getAttribute('content')).toBe('noindex, nofollow');
    second.unmount();
    expect(postureTags()).toHaveLength(0);
  });

  it("re-writes the tag when something pulls it out from under a route that is still mounted", () => {
    const held = render(<Door />);
    postureTags()[0].remove();
    expect(postureTags()).toHaveLength(0);
    // A second mount into the same document, while the first consumer still holds it. A hook that
    // only remembered its own element would count this consumer against the orphan and leave the
    // head answering nothing.
    const joining = render(<Door />);
    expect(postureTags()).toHaveLength(1);
    expect(postureTags()[0].isConnected).toBe(true);
    expect(postureTags()[0].getAttribute('content')).toBe('noindex, nofollow');
    joining.unmount();
    expect(postureTags()).toHaveLength(1);
    held.unmount();
    expect(postureTags()).toHaveLength(0);
  });

  it("never touches a robots meta that is not its own", () => {
    // If a shell or a host layer ever declares `robots` for its own reasons, the product's rule must
    // ride beside it rather than overwrite it — and must remove only itself on leaving.
    const foreign = document.createElement('meta');
    foreign.setAttribute('name', 'robots');
    foreign.setAttribute('content', 'index, follow');
    document.head.appendChild(foreign);
    const { unmount } = render(<Door />);
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(2);
    expect(foreign.getAttribute('content')).toBe('index, follow');
    expect(foreign.hasAttribute('data-route-posture')).toBe(false);
    unmount();
    expect(postureTags()).toHaveLength(0);
    expect(document.head.contains(foreign)).toBe(true);
    foreign.remove();
  });
});

describe("the shipped robots.txt", () => {
  const records = parseRecords(readFileSync(ROBOTS, 'utf8'));

  it("is a set of groups, not one flattened list", () => {
    // Guards every loop below against the vacuous-green shape: an empty or collapsed file would make
    // "every group disallows" true of nothing.
    expect(records.map((record) => record.agents)).toEqual([
      ['Googlebot'],
      ['Bingbot'],
      ['Twitterbot'],
      ['facebookexternalhit'],
      ['*'],
    ]);
  });

  it("refuses the reviewer's door and the household's door to every group that reads it", () => {
    for (const record of records) {
      for (const door of ['/r/', '/g/']) {
        expect(record.disallow, record.agents.join(',')).toContain(door);
      }
    }
  });

  it("does not refuse the published invitation to any group", () => {
    // The other half of the Open Graph contract: a `Disallow: /i/` anywhere in this file would stop
    // the unfurl fetch that draws the share card, and a group added later inherits the assertion.
    for (const record of records) {
      expect(record.disallow, record.agents.join(',')).not.toContain('/i/');
    }
  });

  it("says the two unfurling crawlers are welcome", () => {
    for (const agent of ['Twitterbot', 'facebookexternalhit']) {
      const record = records.find((each) => each.agents.includes(agent));
      if (record === undefined) throw new Error(`${agent} is not named by this file`);
      expect(record.allow).toContain('/');
      expect(record.disallow).toEqual(['/r/', '/g/']);
    }
  });

  it("reads a group that lacks the rule as a group that lacks the rule", () => {
    // The control the three cells above need: a parser that ignored blank lines, or collected
    // `Disallow` into a bucket it then never read, would score them green against a broken file.
    const weakened = parseRecords(
      '# a Googlebot group that forgot both doors, and refused the one path it must not\n' +
        'User-agent: Googlebot\nAllow: /\nDisallow: /i/\n',
    );
    expect(weakened).toHaveLength(1);
    expect(weakened[0].disallow).toEqual(['/i/']);
    expect(weakened[0].disallow).not.toContain('/r/');
    expect(weakened[0].disallow).not.toContain('/g/');
    // And the shape that would make the real file's groups ambiguous: two groups with no blank line
    // between them are one group under the standard, so the parser must agree.
    expect(parseRecords('User-agent: A\nDisallow: /r/\nUser-agent: B\nDisallow: /g/\n')).toHaveLength(1);
  });
});

describe("the pages that are not doors ask for nothing", () => {
  it("leaves a public, indexable page without a posture tag", () => {
    // The mount is route-scoped. A rule that leaked into the shell would take the marketing and
    // legal pages out of the index with the doors, and this cell is what notices.
    const { unmount } = render(
      <MemoryRouter initialEntries={['/cookie-policy']}>
        <CookiePolicy />
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain('Cookie');
    expect(postureTags()).toHaveLength(0);
    unmount();
  });

  it("ships a shell that declares no robots directive of its own", () => {
    expect(readFileSync(SHELL, 'utf8')).not.toMatch(/name=["']?robots/i);
  });
});
