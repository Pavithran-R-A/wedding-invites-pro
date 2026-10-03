// The renderer's promises: a host's words stay words, a guest's page says what the
// projection said, and nothing in the document needs an identifier to draw.
//
// These run against objects the real parser produced (not hand-built camelCase literals),
// so the pair is proven together — a projection field the parser drops cannot silently
// disappear from the page.
//
// A host's prose reaches the page through the section list, because that is where a v2
// document carries it: `guestPayload({ draft: … })` writes the words into the draft slot and
// the matching section body together, the way `build_invitation_snapshot` does. The title and
// the style are still poked afterwards, since the projection writes each of those exactly
// once and no second copy can disagree with the first.
//
// Two of the documents below are the same wedding in two languages. That is not decoration:
// `private.default_invitation_definition()` declares one heading, in English, with no English
// fallback permitted, so a Tamil page has no platform heading to draw and an English page
// does. A test that asserted "no heading appears" only on the Tamil document would pass for
// the wrong reason, so each absence claim is paired with the document where the heading is
// really there and must still be withheld.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import InvitationRenderer from "@/components/invitation/InvitationRenderer";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import {
  DELETE_FIELD,
  guestInvitation,
  guestInvitationPacked,
  guestPayload,
  legacyGuestPayload,
  packedGuestPayload,
  payloadOfWith,
  payloadWith,
} from "@/test/invitationFixture";

const parsed = (): PublicInvitation => {
  const invitation = parsePublicInvitation(guestPayload());
  if (invitation === null) throw new Error('the fixture no longer parses');
  return invitation;
};

/** The same host, in the language whose resolution really does carry the platform's heading. */
const parsedEnglish = (): PublicInvitation => {
  const invitation = parsePublicInvitation(guestPayload({ language: 'en' }));
  if (invitation === null) throw new Error('the English fixture no longer parses');
  return invitation;
};

/** A document frozen from the synthetic approved release. Its words are bracketed
 *  placeholders on purpose: nothing here may be read as ceremonial wording. */
const parsedPacked = (): PublicInvitation => {
  const invitation = parsePublicInvitation(packedGuestPayload());
  if (invitation === null) throw new Error('the packed fixture no longer parses');
  return invitation;
};

const DRAFT_EMPTY = {
  welcome: null,
  family_introduction: null,
  event_notes: null,
  closing: null,
} as const;

/** A prose slot holding an attempt at markup, as the host could type it. */
const MARKUP_ATTEMPTS = [
  '<img src=x onerror="alert(1)">',
  '<iframe src="//example"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
];

describe("the invitation renderer", () => {
  it("renders a host's markup as words, not as elements", () => {
    const invitation = parsePublicInvitation(
      guestPayload({
        draft: {
          welcome: MARKUP_ATTEMPTS[0],
          family_introduction: MARKUP_ATTEMPTS[1],
          closing: MARKUP_ATTEMPTS[2],
        },
      }),
    ) as PublicInvitation;
    const { container } = render(<InvitationRenderer invitation={invitation} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    // The only anchor in the document is the venue map the projection approved.
    expect(container.querySelectorAll('a')).toHaveLength(1);
    // Escaped, and therefore readable as the words they are.
    for (const attempt of MARKUP_ATTEMPTS) expect(container.textContent).toContain(attempt);
  });

  it("renders markup as words when it arrives through a release's section body", () => {
    // The same promise on the other half of the document: a reviewed pack's text and a host's
    // override both reach the page as `sections.items[].body.text`, and neither gets to be
    // markup because it came from content the platform published.
    const invitation = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 0, 'body', 'text'], MARKUP_ATTEMPTS[0]),
    ) as PublicInvitation;
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(MARKUP_ATTEMPTS[0]);
  });

  it("keeps a typed line break as a line break", () => {
    const invitation = parsePublicInvitation(guestPayload({ draft: { welcome: 'Line one\nLine two' } })) as PublicInvitation;
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const paragraph = container.querySelector('header p') as HTMLElement;
    expect(paragraph.className).toContain('whitespace-pre-line');
    expect(paragraph.textContent).toBe('Line one\nLine two');
    expect(container.querySelector('br')).toBeNull();
  });

  it("lets host text break inside a phone-width column", () => {
    // The layout itself is measured in the browser (see the Stage 3 §AC record); this
    // holds the one class that made the measurement pass. A title, a name or an address
    // line has no break point of its own, so the policy is set on the article root and
    // inherited — `overflow-wrap` is an inherited property.
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    const article = container.querySelector('article') as HTMLElement;
    expect(article.className).toContain('break-words');
    expect(article.className).toContain('max-w-[34rem]');
  });

  it("sets the document language from the host's choice", () => {
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    const article = container.querySelector('article');
    expect(article?.getAttribute('lang')).toBe('ta');
    expect(article?.textContent).toContain('Arun weds Deepa');
  });

  it("leaves the language to the page when none was chosen", () => {
    const invitation = parsePublicInvitation(guestPayload({ language: null })) as PublicInvitation;
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(container.querySelector('article')?.hasAttribute('lang')).toBe(false);
    // A wedding that never chose a language is resolved as English by the database, so this
    // page does carry the platform's heading — the absence above is about the `lang`
    // attribute, not about a document that lost its content.
    expect(container.textContent).toContain('The ceremonies');
  });

  it("prints a ceremony's date and time from the host's own digits", () => {
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    // 07:30 frozen in Kanchipuram must not read as 02:00 on a laptop in Berlin.
    expect(screen.getByText('14 November 2026')).toBeInTheDocument();
    expect(container.textContent).toContain('7:30 AM – 9:00 AM');
    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-11-14T07:30:00');
    expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
  });

  it("links only an https map address, in a tab that cannot reach back", () => {
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://maps.example/sri-kanchi-mahal');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it("draws no link at all for a map address the projection refused", () => {
    // The whitelist is `private.map_link_or_null`'s, and the client re-checks it; either way
    // the guest must be left with the venue's name, not with a hyperlink to nowhere.
    for (const link of ['javascript:alert(1)', 'data:text/html,<h1>hi>', 'http://maps.example/x']) {
      const invitation = parsePublicInvitation(
        payloadOfWith(guestInvitation(), ['invitation', 'events', 0, 'venue', 'map_url'], link),
      ) as PublicInvitation;
      const { container } = render(<InvitationRenderer invitation={invitation} />);
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toContain('Sri Kanchi Mahal');
    }
  });

  it("focuses the guest's one interactive control with the shared ring token", () => {
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    const classes = (container.querySelector('a') as HTMLElement).className;
    expect(classes).toContain('focus-visible:ring-ring');
    expect(classes).not.toMatch(/focus-visible:ring-(gold|ceremonial|green|ink|line|surface)\b/);
  });

  it("refuses a style value that is not a colour, a font or a usable size", () => {
    const invitation: PublicInvitation = {
      ...parsed(),
      style: {
        font: 'Noto Sans Tamil}; background: url(http://example/e)',
        fontSize: '999',
        color: 'red;}',
        alignment: 'center',
      },
    };
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const article = container.querySelector('article') as HTMLElement;
    expect(article.style.fontFamily).not.toContain('url');
    expect(article.style.color).not.toBe('red');
    // The clamp is the paper's, not the editor's: a stale 999 still has to fit.
    expect(article.style.fontSize).toBe('44px');
  });

  it("keeps a readable floor under a size an old editor saved", () => {
    const invitation = { ...parsed(), style: { ...parsed().style, fontSize: '3' } };
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect((container.querySelector('article') as HTMLElement).style.fontSize).toBe('22px');
  });

  it("draws a draft that was frozen before the editor set a size", () => {
    // `style_settings` starts as `{}` in the database, so a version frozen straight from the
    // planning page carries no font, colour, size or alignment. Measured at 360px before this
    // was fixed, that document rendered at the page's 16px body text with a 12.9px caption.
    const invitation = {
      ...parsed(),
      style: { font: null, color: null, fontSize: null, alignment: null },
    };
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const article = container.querySelector('article') as HTMLElement;
    expect(article.style.fontSize).toBe('26px');
    expect(article.style.fontFamily).toBe('');
    expect(article.style.textAlign).toBe('center');
  });

  it("draws nothing for an absent prose slot, name or event", () => {
    const invitation = parsePublicInvitation(
      guestPayload({ language: 'en', draft: { ...DRAFT_EMPTY } }),
    ) as PublicInvitation;
    const empty = { ...invitation, people: [], events: [] };
    const { container } = render(<InvitationRenderer invitation={empty} />);
    // The English document is the one whose section list really does carry "The ceremonies",
    // so this is the case where an empty list has to withhold a heading that exists.
    expect(invitation.sections?.items[3]?.heading?.text).toBe('The ceremonies');
    expect(screen.queryByText('The ceremonies')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
    expect(container.textContent).toBe('Arun weds Deepa');
  });

  it("withholds the platform's heading from a page that asked for another language", () => {
    // The pair of the test above, and the reason both are kept. The default definition's only
    // heading is declared in English with no fallback, so a Tamil request gets no heading from
    // the projection at all — the client is not deciding to suppress it.
    const tamil = parsePublicInvitation(guestPayload({ language: 'ta' })) as PublicInvitation;
    const english = parsePublicInvitation(guestPayload({ language: 'en' })) as PublicInvitation;
    expect(tamil.sections?.items[3]?.heading).toBeNull();
    expect(english.sections?.items[3]?.heading).toEqual({
      text: 'The ceremonies',
      language: 'en',
      fallbackUsed: false,
    });

    const tamilPage = render(<InvitationRenderer invitation={tamil} />);
    expect(tamilPage.container.textContent).not.toContain('The ceremonies');
    const englishPage = render(<InvitationRenderer invitation={english} />);
    expect(englishPage.container.textContent).toContain('The ceremonies');
  });

  it("shows a note about the ceremonies even when there is no ceremony list", () => {
    const invitation = parsePublicInvitation(
      guestPayload({ language: 'en', draft: { event_notes: 'Lunch follows the ceremony.' } }),
    ) as PublicInvitation;
    render(<InvitationRenderer invitation={{ ...invitation, events: [] }} />);
    expect(screen.getByText('Lunch follows the ceremony.')).toBeInTheDocument();
    expect(screen.queryByText('The ceremonies')).toBeNull();
  });

  it("groups people under the labels the host chose, and none it did not", () => {
    const invitation = {
      ...parsedEnglish(),
      people: [
        { displayName: 'Arun Kumar', roleKey: 'groom', roleLabel: 'Groom', groupKey: 'groom_family', groupLabel: 'Family of the groom' },
        { displayName: 'Deepa Rani', roleKey: 'bride', roleLabel: 'Bride', groupKey: 'bride_family', groupLabel: 'Family of the bride' },
        { displayName: 'An ungrouped name', roleKey: null, roleLabel: null, groupKey: null, groupLabel: null },
      ],
    };
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(screen.getByText('Family of the groom')).toBeInTheDocument();
    expect(screen.getByText('Family of the bride')).toBeInTheDocument();
    expect(screen.getByText('An ungrouped name')).toBeInTheDocument();
    // A group with no label gets no heading — "Family" would be our claim about a family.
    expect(screen.queryByText('Family and blessings')).toBeNull();
    // `aria-label` is the fallback this build supplies for an unlabeled region, and it is not
    // drawn as text; the visible heading here is the projection's, on a list that has one.
    expect(screen.getByText('The ceremonies')).toBeInTheDocument();
    // A person carries the host's own role word beside the name, in one line.
    expect(container.textContent).toContain('Groom · Arun Kumar');
  });

  // The machine keys are the platform's own columns: `role_key`, `group_key` and
  // `event_key`. Leaving the matching word empty is now a choice the editor offers, so a
  // blank must not be filled in with a key. These go through the parser with the null in
  // the document — the shape the projection really answers with — rather than the
  // camelCase object the test above builds by hand.
  it("prints no key where a host left the word out", () => {
    const unlabelledRole = parsePublicInvitation(payloadWith(['invitation', 'people', 0, 'role_label'], null));
    const unlabelledGroup = parsePublicInvitation(payloadWith(['invitation', 'people', 0, 'group_label'], null));
    expect(unlabelledRole).not.toBeNull();
    expect(unlabelledGroup).not.toBeNull();

    const role = render(<InvitationRenderer invitation={unlabelledRole as PublicInvitation} />);
    const line = role.container.querySelector('ul li');
    // The name alone: no key, and no separator standing in for the word that is not there.
    expect(line?.textContent).toBe('Arun Kumar');

    const group = render(<InvitationRenderer invitation={unlabelledGroup as PublicInvitation} />);
    expect(group.container.textContent).toContain('Arun Kumar');
    expect(group.container.textContent).not.toContain('groom_family');
  });

  it("keeps an unlabelled ceremony's time and drops one that said nothing", () => {
    // On the English document, so that "the heading is not printed" is a claim about an empty
    // ceremony rather than about a heading the projection never wrote.
    const unnamed = parsePublicInvitation(
      payloadOfWith(guestInvitation({ language: 'en' }), ['invitation', 'events', 0, 'display_name'], null),
    );
    expect(unnamed).not.toBeNull();
    const { container } = render(<InvitationRenderer invitation={unnamed as PublicInvitation} />);
    // The date is a fact the host wrote; the key that names the rite is not.
    expect(container.textContent).toContain('14 November 2026');
    expect(container.textContent).toContain('The ceremonies');
    expect(container.textContent).not.toContain('muhurtham');
    expect(container.querySelector('h3')).toBeNull();

    const silent = parsePublicInvitation(
      payloadOfWith(guestInvitation({ language: 'en' }), ['invitation', 'events', 0], {
        event_key: 'muhurtham',
        display_name: null,
        starts_at_local: null,
        ends_at_local: null,
        timezone: 'Asia/Kolkata',
        venue: null,
      }),
    );
    expect(silent).not.toBeNull();
    const bare = render(<InvitationRenderer invitation={silent as PublicInvitation} />);
    // Scoped to this render: the invitation above, which does have a ceremony, is still in
    // the document.
    expect(bare.container.textContent).not.toContain('muhurtham');
    expect(bare.container.textContent).not.toContain('The ceremonies');
  });

  it("draws a release's own order rather than the platform's", () => {
    // The release put its blessing second and its notes last, after the closing slot. A
    // renderer that knew the platform's order and drew from it would put the host's note back
    // where the platform keeps one — which is exactly the branch §13 forbids.
    const { container } = render(<InvitationRenderer invitation={parsedPacked()} />);
    const text = container.textContent ?? '';
    const sequence = [
      '[placeholder blessing line from the release]',
      'Family of the groom',
      '[placeholder heading from the release]',
      'Wedding ceremony',
      'Lunch follows the ceremony.',
    ];
    const positions = sequence.map((line) => text.indexOf(line));
    for (const [index, position] of positions.entries()) {
      expect(position, `the page does not contain ${sequence[index]}`).toBeGreaterThan(-1);
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1]);
    }
  });

  it("draws a release's heading, and never the record of who reviewed it", () => {
    const { container } = render(<InvitationRenderer invitation={parsedPacked()} />);
    const text = container.textContent ?? '';
    expect(text).toContain('[placeholder heading from the release]');
    // Provenance is carried for the host's own editor and printed nowhere here: a guest's
    // document is not where a review claim belongs, and §12's honesty is about the record.
    // Each string below is one the frozen document really does carry, in a field the renderer
    // reads and refuses to draw.
    expect(text).not.toContain('TEST ONLY');
    expect(text).not.toContain('TEST FIXTURE REVIEWER');
    expect(text).not.toContain('Synthetic Reviewed Fixture');
    expect(text).not.toContain('reviewed_pack');
    expect(text).not.toContain('release_number');
    expect(text).not.toContain('test-reviewed-fixture');
  });

  it("draws a host's line over a release's without marking the substitution", () => {
    const invitation = parsedPacked();
    // The document really does say the host wrote over pack wording — that fact is in it.
    expect(invitation.sections?.items[0]?.body).toMatchObject({ source: 'host', overrodePackText: true });
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(container.textContent).toContain('With the blessings of our elders');
    // And the guest sees prose, not an annotation about where it came from.
    for (const marker of ['edited', 'modified', 'overridden', 'host']) {
      expect((container.textContent ?? '').toLowerCase()).not.toContain(marker);
    }
  });

  it("keeps drawing the rest of the page when a section carries a kind it does not know", () => {
    // §13's forward-compatibility promise, measured on the page rather than on the list: a
    // visitor holding a link published by a newer build cannot be upgraded, so an unknown
    // section has to cost that visitor one section and not their invitation.
    const withUnknownKind = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'kind'], 'deity_list'),
    ) as PublicInvitation;
    const { container } = render(<InvitationRenderer invitation={withUnknownKind} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('[placeholder blessing line from the release]');
    expect(text).toContain('With the blessings of our elders');
    expect(text).toContain('Family of the groom');
    expect(text).toContain('14 November 2026');
    expect(text).toContain('Lunch follows the ceremony.');
  });

  it("keeps drawing when a section names a slot this build has no place for", () => {
    const withUnknownSlot = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'section_key'], 'sankalpam'),
    ) as PublicInvitation;
    const { container } = render(<InvitationRenderer invitation={withUnknownSlot} />);
    expect(container.textContent).not.toContain('[placeholder blessing line from the release]');
    expect(container.textContent).toContain('With the blessings of our elders');
  });

  it("draws a Stage 3 document, which carries no section list at all", () => {
    // The client's legacy path, kept honest: a document with four flat prose slots and no
    // order is drawn in the platform's own sequence, which is the same sequence the database
    // would have frozen today (`scripts/check-db-contract.mjs` keeps the two copies equal).
    const invitation = parsePublicInvitation(
      payloadOfWith(
        guestInvitation({ language: 'en', draft: { closing: 'With love,\nArun and Deepa' } }),
        ['invitation', 'sections'],
        DELETE_FIELD,
      ),
    ) as PublicInvitation;
    expect(invitation.sections).toBeNull();
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const text = container.textContent ?? '';
    const order = [
      'With the blessings of our elders',
      'Our families invite you',
      'Family of the groom',
      'The ceremonies',
      'With love,',
    ];
    const positions = order.map((line) => text.indexOf(line));
    for (const [index, position] of positions.entries()) {
      expect(position, `the legacy page is missing ${order[index]}`).toBeGreaterThan(-1);
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1]);
    }
  });

  it("does not display the platform's template or pack revision", () => {
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    expect(container.textContent).not.toContain('Rev');
    expect(container.textContent).not.toContain('maroon-gold');
    expect(container.textContent).not.toContain('tamil-generic');
  });

  it("carries no identifier of the wedding, version or link", () => {
    const { container } = render(<InvitationRenderer invitation={parsed()} />);
    const html = container.innerHTML.toLowerCase();
    for (const leaked of ['wedding_id', 'version_id', 'publication_id', 'token', 'uuid', 'digest']) {
      expect(html).not.toContain(leaked);
    }
  });
});

describe("what a guest's page is not required to notice", () => {
  /** A release's English line reaching a Tamil wedding, in exactly the shape
   *  `private.pack_text_for` writes when the release permits the substitution — group R5 of
   *  `supabase/tests/stage5/70_document_resolution.sql` measures that row in SQL. */
  const FALLBACK_BODY = {
    source: 'reviewed_pack',
    text: '[placeholder English blessing line from the release]',
    language: 'en',
    fallback_used: true,
    overrode_pack_text: false,
  };

  const packedWith = (path: Array<string | number>, value: unknown): PublicInvitation => {
    const invitation = parsePublicInvitation(payloadOfWith(guestInvitationPacked(), path, value));
    if (invitation === null) throw new Error('the document under test no longer parses');
    return invitation;
  };

  it("draws a release's English fallback with the page still in the wedding's own language", () => {
    // The `lang` attribute is the half only a renderer owns. It is what a screen reader
    // pronounces with and what a browser offers to translate, and one substituted line out of
    // six is not a reason to announce somebody's Tamil invitation as English. The request is
    // kept intact by the projection (`sections.requested`) and by the parser
    // (`language.primary`); nothing in between is allowed to reconcile them.
    const invitation = packedWith(['invitation', 'sections', 'items', 1, 'body'], FALLBACK_BODY);
    expect(invitation.language.primary).toBe('ta');
    expect(invitation.sections?.requested).toBe('ta');
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect((container.querySelector('article') as HTMLElement).getAttribute('lang')).toBe('ta');
    // The substituted line is still drawn — the release permitted it, and a guest who cannot
    // read it was never going to be told about the permission anyway.
    expect(container.textContent).toContain('[placeholder English blessing line from the release]');
    // And the substitution stays a fact about the document rather than becoming a caption on
    // it: no language word, no flag, no provenance key reaches the page.
    const text = container.textContent ?? '';
    expect(text).not.toContain('fallback');
    expect(text).not.toContain('reviewed_pack');
    expect(container.innerHTML).not.toContain('lang="en"');
  });

  it("draws one identical page whatever the document names the release and template behind it", () => {
    // "Keep the renderer pack-agnostic" is a comment until it is measured. So: one document,
    // four identities for it. `traditionPack` and `designTemplate` are read by this component
    // for nothing at all, so a renamed pack, a different release number, a different template —
    // and the pack block's absence, which is what a no-pack wedding really publishes — must all
    // produce the same article, character for character. A renderer with a per-pack branch in it
    // would fail here as a diff rather than in a browser as a wrong layout.
    const baseline = render(<InvitationRenderer invitation={parsedPacked()} />);
    const variants: Array<[string, Array<string | number>, unknown]> = [
      ['another release of another pack', ['invitation', 'tradition_pack'], {
        display_name: 'A wholly different named thing',
        pack_key: 'z-other-pack-key',
        release_number: 99,
      }],
      ['no pack block at all', ['invitation', 'tradition_pack'], null],
      ['another template at another revision', ['invitation', 'design_template'], {
        display_name: 'Plain paper',
        template_key: 'plain-paper',
        revision: 7,
      }],
    ];
    for (const [label, path, value] of variants) {
      const page = render(<InvitationRenderer invitation={packedWith(path, value)} />);
      expect(page.container.innerHTML, `the page changed shape over ${label}`).toBe(baseline.container.innerHTML);
    }
  });

  it("keeps the rest of the page, and its language, when an optional section carries an unknown kind", () => {
    // The optional half of the forward-compatibility case: the required half is measured above,
    // where a section the release *did* require is skipped and the page goes on. An optional one
    // is the same event for a guest — one paragraph they were not promised is missing — and this
    // build's whole answer is that the invitation still arrives. What the section is called
    // never reaches the paper, and `render.unknown_kind_skipped` is recorded upstream in
    // `normalizeInvitationSections` for the host's preview to name.
    const invitation = packedWith(['invitation', 'sections', 'items', 5, 'kind'], 'venue_list');
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Lunch follows the ceremony.');
    expect(text).not.toContain('venue_list');
    expect(text).toContain('[placeholder blessing line from the release]');
    expect(text).toContain('Family of the groom');
    expect(text).toContain('14 November 2026');
    expect((container.querySelector('article') as HTMLElement).getAttribute('lang')).toBe('ta');
  });

  it("renders a Stage 3 document and a Stage 4 document from one code path", () => {
    // The two historical shapes, from their real fixtures rather than from a hand-removal: the
    // Stage 3 document has four flat prose slots, no section list, and a pack block pinned to a
    // `revision` because a release number had not been invented; the Stage 4 document carries a
    // resolved section list and a `release_number`. Neither is up-converted, and no migration
    // rewrites a stored snapshot to make them agree — the only writes to `invitation_versions`
    // in `supabase/migrations/` are INSERTs. What carries a legacy page is this path: the parser
    // reads whichever keys are present, `normalizeInvitationSections` hands the renderer one
    // ordered list either way, and the renderer draws that list without asking what produced it.
    //
    // What this does *not* say: `private.public_invitation_dto` refuses a stored snapshot whose
    // section list is missing — C11c of `supabase/tests/stage4/50_pack_release.sql` measures exactly
    // these bytes returning NULL — so on a database that has applied Stage 4, a link pinned to a
    // pre-Stage-4 version reaches the guest page's "unavailable" state rather than this code path.
    // The promise this test keeps is the narrower one that still matters: a v1 *payload* in hand
    // renders, which is what an already-loaded page and an older bundle both depend on. Audit §20.4
    // holds the whole of that boundary.
    const legacy = parsePublicInvitation(legacyGuestPayload());
    expect(legacy).not.toBeNull();
    expect(legacy?.sections).toBeNull();
    const stage3 = render(<InvitationRenderer invitation={legacy as PublicInvitation} />);
    const stage4 = render(<InvitationRenderer invitation={parsedPacked()} />);

    const legacyText = stage3.container.textContent ?? '';
    for (const line of [
      'Arun weds Deepa',
      'With the blessings of our elders',
      'Our families invite you',
      'Arun Kumar',
      '14 November 2026',
    ]) {
      expect(legacyText, `the Stage 3 page is missing ${line}`).toContain(line);
    }

    for (const [label, page] of [['Stage 3', stage3], ['Stage 4', stage4]] as const) {
      const article = page.container.querySelector('article') as HTMLElement;
      expect(article.getAttribute('lang'), `${label} lost the wedding's language`).toBe('ta');
      expect(page.container.querySelector('h1')?.textContent).toBe('Arun weds Deepa');
      expect(page.container.querySelectorAll('ul li').length).toBeGreaterThan(0);
      expect(page.container.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-14T07:30:00');
      // Which era a document came from is not printed, in either direction.
      expect(page.container.textContent).not.toContain('Tamil wedding patrika');
      expect(page.container.textContent).not.toContain('tamil-generic');
      expect(page.container.textContent).not.toContain('TEST ONLY');
      expect(page.container.textContent).not.toContain('test-reviewed-fixture');
    }
  });
});

describe("a line long enough to test the column", () => {
  // §14's long-text cases. These are rendering verification only: they prove a long line
  // arrives whole and wraps, not that anyone who reads the language approves of it.
  const LONG_ENGLISH = 'With '.repeat(80) + 'the blessings of our elders';
  const LONG_TAMIL = 'எங்கள் '.repeat(80) + 'பெரியோர்களின் ஆசீர்வாதத்துடன்';
  const MIXED = 'அருண் weds Deepa — அன்புடன், ஆசீர்வாதம்';
  const UNBROKEN = 'a'.repeat(400);

  for (const [label, line] of [
    ['long English', LONG_ENGLISH],
    ['long Tamil', LONG_TAMIL],
    ['mixed script', MIXED],
    ['a 400-character unbroken run', UNBROKEN],
  ]) {
    it(`${label} reaches the page whole and inside a wrapping column`, () => {
      const invitation = parsePublicInvitation(guestPayload({ draft: { welcome: line } })) as PublicInvitation;
      const { container } = render(<InvitationRenderer invitation={invitation} />);
      const paragraph = container.querySelector('header p') as HTMLElement;
      // Whole, character for character — a truncation or an escaping detour would show here.
      expect(paragraph.textContent).toBe(line);
      expect(paragraph.className).toContain('break-words');
      expect((container.querySelector('article') as HTMLElement).className).toContain('max-w-[34rem]');
    });
  }
});
