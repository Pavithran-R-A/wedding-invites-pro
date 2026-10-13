// The link card, derived from the frozen document — and nothing else.
//
// §10.1 gives the whole contract as six pairs. What makes it a *contract* rather than a
// template is that every byte comes out of the same parsed DTO the guest's page draws
// (`src/lib/publicInvitation.ts`), so a preview cannot disagree with the document it
// previews: no brand copy where the host has written none, no second date formatter, no
// address the page does not show.
//
// Three rules drive the cases below, and each is a refusal rather than a preference:
//
//   * **`og:url` goes through the QR door.** `src/render/qrTarget.ts` is the one place that
//     says what a public invitation address is. A crawler block whose `og:url` is a household
//     door would put `/g/<credential>` into a platform's cache, which is the same leak §9.3
//     exists to prevent on paper — and reusing the door means the refusal reasons are already
//     on record rather than invented a second time.
//   * **`og:image` is absent until a preview is published.** §15 H-1 keeps the published-preview
//     domain dormant, so the *caller* supplies the URL and nothing in a guest's document can
//     become one.
//   * **§10.3's clamp cuts at word boundaries,** in codepoints — because a UTF-16 cut can split
//     an emoji in half, and a broken glyph on someone's wedding card is not a rounding error.
//
// Every document here is built with the shared fixture and read with the guest's own parser, for
// the reason `src/test/invitationSections.test.ts` gives: a hand-built camelCase object would
// prove this module's arithmetic and nothing about the contract.

import { describe, expect, it } from "vitest";
import { parseInvitationObject, type PublicInvitation } from "@/lib/publicInvitation";
import {
  OG_DESCRIPTION_LIMIT,
  OG_TITLE_LIMIT,
  buildOgMetadata,
  serializeOgMetaTags,
} from "@/lib/ogMetadata";
import {
  guestInvitation,
  guestInvitationPacked,
  guestInvitationV1,
} from "@/test/invitationFixture";

/** A token in the shape `internal_api.publish_wedding` mints: 43 characters of base64url. */
const TOKEN = 'kA9zQ2x7Lm4Yb0Td8vRn5Jh1Ws3Fp6CgNe9uXi2Oq7Z';
const INVITATION_URL = `https://vivaahvarnam.example/i/${TOKEN}`;

const readDocument = (body: unknown): PublicInvitation => {
  const invitation = parseInvitationObject(body);
  if (invitation === null) throw new Error('the document under test no longer parses');
  return invitation;
};

/** One of the fixture's three documents with these invitation-level fields replaced. Nested
 *  shapes (a venue, an event) are passed whole, which is how the projection writes them anyway. */
const shaped = (
  fields: Record<string, unknown>,
  body: Record<string, unknown> = guestInvitation(),
): PublicInvitation => readDocument({ ...structuredClone(body), ...fields });

const tagsOf = (invitation: PublicInvitation, extra: Record<string, unknown> = {}) => {
  const outcome = buildOgMetadata({ invitation, url: INVITATION_URL, ...extra });
  if (outcome.ok === false) throw new Error(`the contract refused: ${outcome.reason}`);
  return outcome.tags;
};

/** `[name, value]` per tag, so an assertion reads as §10.1's table rather than as three fields
 *  per tag repeated six times. The `property`/`name` half is pinned on its own, below. */
const pairs = (invitation: PublicInvitation, extra: Record<string, unknown> = {}) =>
  tagsOf(invitation, extra).map((tag) => [tag.key, tag.content]);

const pair = (invitation: PublicInvitation, key: string, extra: Record<string, unknown> = {}) =>
  pairs(invitation, extra).find(([name]) => name === key)?.[1];

const titleOf = (title: string) => pair(shaped({ title }), 'og:title');
const welcomeOf = (welcome: string | null) =>
  pair(shaped({ events: [], welcome }), 'og:description');
const withEvent = (event: Record<string, unknown>) => shaped({ events: [event] });

const CEREMONY_LINE = '14 November 2026 · 7:30 AM – 9:00 AM, Sri Kanchi Mahal';

describe("the six pairs §10.1 promises", () => {
  const full = readDocument(guestInvitation());

  it("answers every pair the contract lists, in the contract's own order", () => {
    expect(pairs(full)).toEqual([
      ['og:title', 'Arun weds Deepa'],
      ['og:description', CEREMONY_LINE],
      ['og:type', 'website'],
      ['og:url', INVITATION_URL],
      ['twitter:card', 'summary_large_image'],
    ]);
  });

  it("spells each tag the way the landing page already does", () => {
    // `index.html:33-46` uses `property=` for the Open Graph set and `name=` for the Twitter
    // one. A host that mixed the forms would serve a block the two harvesters read differently,
    // so the convention is part of what this module owes.
    expect(tagsOf(full).map((tag) => [tag.key, tag.attribute])).toEqual([
      ['og:title', 'property'],
      ['og:description', 'property'],
      ['og:type', 'property'],
      ['og:url', 'property'],
      ['twitter:card', 'name'],
    ]);
  });

  it("adds og:image only when a published preview is handed to it", () => {
    const previewUrl = `https://preview.vivaahvarnam.example/i/${TOKEN}.png`;
    expect(pairs(full, { previewImageUrl: previewUrl })).toEqual([
      ['og:title', 'Arun weds Deepa'],
      ['og:description', CEREMONY_LINE],
      ['og:type', 'website'],
      ['og:image', previewUrl],
      ['og:url', INVITATION_URL],
      ['twitter:card', 'summary_large_image'],
    ]);
    // The dormant state (§15 H-1) is the default: no caller, no image, no image key at all.
    expect(pairs(full).some(([key]) => key === 'og:image')).toBe(false);
  });

  it("treats a blank published-preview URL as no preview", () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(pairs(full, { previewImageUrl: value }).some(([key]) => key === 'og:image'), String(value)).toBe(false);
    }
  });

  it("normalises the address through the door rather than echoing the caller's string", () => {
    const outcome = buildOgMetadata({ invitation: full, url: `https://VivaahVarnam.Example:443/i/${TOKEN}` });
    if (outcome.ok === false) throw new Error('a well-formed address refused');
    expect(outcome.tags.map((tag) => tag.content)).toContain(INVITATION_URL);
  });

  it("reads all three document generations the projection can answer with", () => {
    for (const [name, body] of [
      ['no-pack v2', guestInvitation()],
      ['approved-pack v2', guestInvitationPacked()],
      ['pre-Stage-4 v1', guestInvitationV1()],
    ] as const) {
      const invitation = readDocument(body);
      expect(pair(invitation, 'og:description'), name).toBe(CEREMONY_LINE);
      expect(pair(invitation, 'og:title'), name).toBe('Arun weds Deepa');
    }
    // The one structural difference between them, asserted so the loop above cannot be read as
    // three copies of the same document.
    expect(readDocument(guestInvitationV1()).sections).toBeNull();
    expect(readDocument(guestInvitation()).sections).not.toBeNull();
  });
});

describe("og:url is the QR door's, with the door's reasons", () => {
  const invitation = readDocument(guestInvitation());

  const outcomeFor = (url: unknown) => {
    const outcome = buildOgMetadata({ invitation, url });
    if (outcome.ok === true) throw new Error(`${String(url)} was accepted as an invitation address`);
    return outcome;
  };

  it("refuses a household or a review door by the door's own name", () => {
    expect(outcomeFor(`https://vivaahvarnam.example/g/${TOKEN}`)).toEqual({ ok: false, reason: 'target-private-door' });
    expect(outcomeFor(`https://vivaahvarnam.example/r/${TOKEN}`)).toEqual({ ok: false, reason: 'target-private-door' });
  });

  it("refuses every other address the door refuses, and emits no tags with it", () => {
    const cases: Array<[string, unknown, string]> = [
      ['not a string', 42, 'target-not-a-string'],
      ['unparsable', 'not a url', 'target-unparsable'],
      ['plain http', `http://vivaahvarnam.example/i/${TOKEN}`, 'target-not-https'],
      ['credentials', `https://guest:${TOKEN}@vivaahvarnam.example/i/${TOKEN}`, 'target-carries-credentials'],
      ['a query', `https://vivaahvarnam.example/i/${TOKEN}?utm_source=whatsapp`, 'target-carries-query'],
      ['loopback', `https://127.0.0.1:54321/i/${TOKEN}`, 'target-origin-not-public'],
      ['a truncated token', 'https://vivaahvarnam.example/i/short', 'target-path-shape'],
    ];
    expect(cases.length).toBe(7);
    for (const [name, url, reason] of cases) {
      expect(outcomeFor(url), name).toEqual({ ok: false, reason });
      // "no tags with it" is the half that matters: a block that keeps the title and drops the
      // url is a crawler-facing artefact a host could serve by accident.
      expect('tags' in outcomeFor(url), name).toBe(false);
    }
  });

  it("refuses rather than laundering a private door into a public card", () => {
    expect(JSON.stringify(outcomeFor(`https://vivaahvarnam.example/g/${TOKEN}`))).not.toContain('Arun weds Deepa');
  });
});

describe("the description is the first line the guest reads", () => {
  it("keeps the date when the ceremony has no end time", () => {
    const invitation = withEvent({
      event_key: 'muhurtham',
      display_name: null,
      starts_at_local: '2026-11-14T07:30:00',
      ends_at_local: null,
      timezone: null,
      venue: null,
    });
    expect(pair(invitation, 'og:description')).toBe('14 November 2026 · 7:30 AM');
  });

  it("says no time the page itself would not print", () => {
    // An end without a start has no line on a guest's page — `EventBlock` builds the range from
    // `startsAtLocal` — so the card cannot be the one place it appears.
    const invitation = withEvent({
      event_key: 'muhurtham',
      display_name: null,
      starts_at_local: null,
      ends_at_local: '2026-11-14T09:00:00',
      timezone: null,
      venue: null,
    });
    expect(pair(invitation, 'og:description')).toBe('With the blessings of our elders');
  });

  it("names the venue when the ceremony's moment was never written", () => {
    const invitation = withEvent({
      event_key: 'muhurtham',
      display_name: null,
      starts_at_local: null,
      ends_at_local: null,
      timezone: null,
      venue: { name: 'Sri Kanchi Mahal', address_text: '12 Temple Street', map_url: null },
    });
    expect(pair(invitation, 'og:description')).toBe('Sri Kanchi Mahal');
  });

  it("does not promote an address into a place name", () => {
    const invitation = withEvent({
      event_key: 'muhurtham',
      display_name: null,
      starts_at_local: '2026-11-14T07:30:00',
      ends_at_local: null,
      timezone: null,
      venue: { name: null, address_text: '12 Temple Street\nKanchipuram', map_url: null },
    });
    expect(pair(invitation, 'og:description')).toBe('14 November 2026 · 7:30 AM');
  });

  it("drops a time the document cannot express instead of guessing at one", () => {
    // `wallClock` answers null for a stamp it cannot read, which is the page's behaviour too.
    const invitation = withEvent({
      event_key: 'muhurtham',
      display_name: null,
      starts_at_local: 'whenever',
      ends_at_local: null,
      timezone: null,
      venue: { name: 'Sri Kanchi Mahal', address_text: null, map_url: null },
    });
    expect(pair(invitation, 'og:description')).toBe('Sri Kanchi Mahal');
  });

  it("says nothing about a timezone it cannot put in a guest's own words", () => {
    const description = pair(readDocument(guestInvitation()), 'og:description');
    expect(description).not.toContain('Asia/Kolkata');
    expect(description).not.toContain('IST');
  });

  it("describes the first ceremony the page actually draws, not the first row", () => {
    // `InvitationRenderer` skips an event with nothing on it, so a card built from row 0 of such
    // a list would advertise a ceremony the guest never sees.
    const blankEvent = {
      event_key: 'blank',
      display_name: null,
      starts_at_local: null,
      ends_at_local: null,
      timezone: null,
      venue: null,
    };
    const invitation = withEvent(blankEvent);
    const both = shaped({
      events: [
        blankEvent,
        {
          event_key: 'reception',
          display_name: 'Reception',
          starts_at_local: '2026-11-16T19:00:00',
          ends_at_local: null,
          timezone: 'Asia/Kolkata',
          venue: { name: 'Community Hall', address_text: null, map_url: null },
        },
      ],
    });
    expect(pair(invitation, 'og:description')).toBe('With the blessings of our elders');
    expect(pair(both, 'og:description')).toBe('16 November 2026 · 7:00 PM, Community Hall');
  });

  it("falls back to the host's own opening line when the document has no ceremony", () => {
    expect(welcomeOf('With the blessings of our elders')).toBe('With the blessings of our elders');
    expect(pair(shaped({ events: [] }), 'og:description')).toBe('With the blessings of our elders');
  });

  it("omits the pair rather than writing brand copy the host never wrote", () => {
    const keys = pairs(shaped({ events: [], welcome: '   ' })).map(([key]) => key);
    expect(keys).not.toContain('og:description');
    // The rest of the block survives: a document without a date is still an invitation.
    expect(keys).toEqual(['og:title', 'og:type', 'og:url', 'twitter:card']);
  });

  it("keeps family names and release wording out of the card", () => {
    // The packed document carries a release's blessing line, a host's lunch note and a groom's
    // father. None of it is a date, a venue or the host's opening, so none of it reaches a crawler.
    const invitation = shaped({ events: [], welcome: null }, guestInvitationPacked());
    const serialized = serializeOgMetaTags(tagsOf(invitation));
    expect(serialized).not.toContain('Arun Kumar');
    expect(serialized).not.toContain('placeholder blessing');
    expect(serialized).not.toContain('Lunch follows');
    expect(pairs(invitation).map(([key]) => key)).not.toContain('og:description');
  });
});

describe("§10.3's clamp", () => {
  it("leaves a value that fits alone, at the bound and one codepoint over it", () => {
    const fits = 'a'.repeat(42) + ' ' + 'b'.repeat(44);
    expect(Array.from(fits).length).toBe(87);
    expect(titleOf(fits)).toBe(fits);
    const atBound = 'a'.repeat(43) + ' ' + 'b'.repeat(44);
    expect(Array.from(atBound).length).toBe(OG_TITLE_LIMIT);
    expect(titleOf(atBound)).toBe(atBound);
    // One over, with the only boundary at 44: the tail word is lost whole rather than halved.
    const over = 'a'.repeat(44) + ' ' + 'b'.repeat(44);
    expect(Array.from(over).length).toBe(OG_TITLE_LIMIT + 1);
    expect(titleOf(over)).toBe('a'.repeat(44));
  });

  it("cuts prose at a word boundary, never inside a word, and invents no ellipsis", () => {
    const original = 'With the blessings of our elders and the good wishes of every friend we have made along the way';
    const clamped = titleOf(original);
    if (clamped === undefined) throw new Error('no title came back');
    expect(Array.from(clamped).length).toBeLessThanOrEqual(OG_TITLE_LIMIT);
    expect(original.startsWith(clamped)).toBe(true);
    expect(clamped).toBe(clamped.trimEnd());
    // The character the cut replaced was a space — that is what "at a word boundary" means.
    expect(original[clamped.length]).toBe(' ');
    expect(clamped).not.toContain('…');
    expect(clamped).not.toContain('...');
    expect(clamped.split(' ').length).toBeGreaterThan(1);
  });

  it("lets one long word stand whole rather than break it in half", () => {
    // The rule's two clauses cannot both hold for a value with no boundary inside the bound.
    // This is the render sweep's own shape 8 (`8-unbroken-english`), which is why it is not
    // hypothetical — and the stage's answer is to keep the word, not to cut it.
    const unbroken = 'A'.repeat(200) + 'B'.repeat(200);
    expect(titleOf(unbroken)).toBe(unbroken);
    const firstWordThenSpace = `${'A'.repeat(120)} and then some more words follow here`;
    const clamped = titleOf(firstWordThenSpace);
    if (clamped === undefined) throw new Error('no title came back');
    expect(clamped).toBe('A'.repeat(120));
    expect(clamped.length).toBeGreaterThan(OG_TITLE_LIMIT);
  });

  it("counts codepoints, so a cut cannot split a half-written glyph", () => {
    // U+1FA94 (a oil lamp) is a surrogate pair in UTF-16; `Array.from` is what keeps it together.
    const lamp = '\u{1FA94}';
    expect(lamp.length).toBe(2);
    const title = `${lamp} weds `.repeat(40).trimEnd();
    const clamped = titleOf(title);
    if (clamped === undefined) throw new Error('no title came back');
    expect(Array.from(clamped).length).toBeLessThanOrEqual(OG_TITLE_LIMIT);
    expect(clamped).toBe(clamped.trim());
    expect(clamped).not.toContain('\uFFFD');
    const halves = [lamp.charCodeAt(0), lamp.charCodeAt(1)];
    const emitted = Array.from(clamped).map((character) => character.codePointAt(0));
    for (const half of halves) expect(emitted).not.toContain(half);
  });

  it("holds the bound on the description too", () => {
    const prose =
      'The families of the bride and groom invite you to share in the blessings of the day, with lunch following the ceremony outdoors. '.repeat(5);
    const clamped = welcomeOf(prose);
    if (clamped === undefined) throw new Error('no description came back');
    expect(Array.from(clamped).length).toBeLessThanOrEqual(OG_DESCRIPTION_LIMIT);
    expect(prose.startsWith(clamped)).toBe(true);
    expect(clamped).toBe(clamped.trimEnd());
    expect(prose[clamped.length]).toBe(' ');
    expect(clamped).not.toContain('…');
  });

  it("bounds the composed line, not only the slot it came from", () => {
    // A date line plus a long venue name is one string by the time it is clamped, so the tail can
    // lose words — but never the middle of one, and the ceremony keeps its own place at the front.
    const venue = `Sri ${'Mahal '.repeat(45)}Kanchipuram`.trim();
    const invitation = withEvent({
      event_key: 'muhurtham',
      display_name: null,
      starts_at_local: '2026-11-14T07:30:00',
      ends_at_local: '2026-11-14T09:00:00',
      timezone: null,
      venue: { name: venue, address_text: null, map_url: null },
    });
    const clamped = pair(invitation, 'og:description');
    if (clamped === undefined) throw new Error('no description came back');
    const prefix = '14 November 2026 · 7:30 AM – 9:00 AM, ';
    expect(clamped.startsWith(prefix)).toBe(true);
    expect(Array.from(clamped).length).toBeLessThanOrEqual(OG_DESCRIPTION_LIMIT);
    const tail = clamped.slice(prefix.length);
    expect(tail).toBe(tail.trimEnd());
    expect(venue.startsWith(tail)).toBe(true);
    if (tail !== venue) expect(venue[tail.length]).toBe(' ');
  });

  it("keeps both bounds where §10.3 put them", () => {
    expect(OG_TITLE_LIMIT).toBe(88);
    expect(OG_DESCRIPTION_LIMIT).toBe(300);
  });
});

describe("serialization: the bytes a host must serve", () => {
  const serializedFor = (title: string) => serializeOgMetaTags(tagsOf(shaped({ title })));

  it("writes one meta element per pair, in order", () => {
    const html = serializeOgMetaTags(tagsOf(readDocument(guestInvitation())));
    expect([...html.matchAll(/<meta\b/g)]).toHaveLength(5);
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('og:description'));
    expect(html.indexOf('og:url')).toBeLessThan(html.indexOf('twitter:card'));
  });

  it("holds hostile host text inside its attribute", () => {
    // The render sweep's `10-hostile-markup` title, verbatim.
    const html = serializedFor('"><script>alert(1)</script>');
    expect(html).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    // Exactly one `content=` per tag is the whole claim: a value that could end its own attribute
    // would produce more, and a second tag would ride along with it.
    expect([...html.matchAll(/content="/g)]).toHaveLength(5);
    expect(html.match(/<script/g)).toBeNull();
  });

  it("round-trips an escaped value back to the bytes the document holds", () => {
    const original = `Arun & Deepa's — "muhurtham" <hall>`;
    const content = /property="og:title" content="([^"]*)"/.exec(serializedFor(original));
    if (content === null) throw new Error('the attribute did not parse');
    const unescaped = content[1]
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
    expect(unescaped).toBe(original);
  });

  it("is deterministic, which is where §13's reproducibility starts", () => {
    const invitation = readDocument(guestInvitationPacked());
    expect(serializeOgMetaTags(tagsOf(invitation))).toBe(serializeOgMetaTags(tagsOf(invitation)));
  });
});
