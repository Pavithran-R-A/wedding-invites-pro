// The renderer's promises: a host's words stay words, a guest's page says what the
// projection said, and nothing in the document needs an identifier to draw.
//
// These run against objects the real parser produced (not hand-built camelCase literals),
// so the pair is proven together — a projection field the parser drops cannot silently
// disappear from the page.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import InvitationRenderer from "@/components/invitation/InvitationRenderer";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import { guestPayload, payloadWith } from "@/test/invitationFixture";

const parsed = (): PublicInvitation => {
  const invitation = parsePublicInvitation(guestPayload());
  if (invitation === null) throw new Error('the fixture no longer parses');
  return invitation;
};

const shaped = (change: (invitation: PublicInvitation) => PublicInvitation) => change(parsed());

/** A prose slot holding an attempt at markup, as the host could type it. */
const MARKUP_ATTEMPTS = [
  '<img src=x onerror="alert(1)">',
  '<iframe src="//example"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
];

describe("the invitation renderer", () => {
  it("renders a host's markup as words, not as elements", () => {
    const invitation = shaped(i => ({
      ...i,
      welcome: MARKUP_ATTEMPTS[0],
      familyIntroduction: MARKUP_ATTEMPTS[1],
      closing: MARKUP_ATTEMPTS[2],
    }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    // The only anchor in the document is the venue map the projection approved.
    expect(container.querySelectorAll('a')).toHaveLength(1);
    // Escaped, and therefore readable as the words they are.
    for (const attempt of MARKUP_ATTEMPTS) expect(container.textContent).toContain(attempt);
  });

  it("keeps a typed line break as a line break", () => {
    const invitation = shaped(i => ({ ...i, welcome: 'Line one\nLine two' }));
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
    const invitation = shaped(i => ({ ...i, language: { primary: null, additional: [] } }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(container.querySelector('article')?.hasAttribute('lang')).toBe(false);
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

  it("refuses a style value that is not a colour, a font or a usable size", () => {
    const invitation = shaped(i => ({
      ...i,
      style: {
        font: 'Noto Sans Tamil}; background: url(http://example/e)',
        fontSize: '999',
        color: 'red;}',
        alignment: 'center',
      },
    }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const article = container.querySelector('article') as HTMLElement;
    expect(article.style.fontFamily).not.toContain('url');
    expect(article.style.color).not.toBe('red');
    // The clamp is the paper's, not the editor's: a stale 999 still has to fit.
    expect(article.style.fontSize).toBe('44px');
  });

  it("keeps a readable floor under a size an old editor saved", () => {
    const invitation = shaped(i => ({ ...i, style: { ...i.style, fontSize: '3' } }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect((container.querySelector('article') as HTMLElement).style.fontSize).toBe('22px');
  });

  it("draws a draft that was frozen before the editor set a size", () => {
    // `style_settings` starts as `{}` in the database, so a version frozen straight from the
    // planning page carries no font, colour, size or alignment. Measured at 360px before this
    // was fixed, that document rendered at the page's 16px body text with a 12.9px caption.
    const invitation = shaped(i => ({
      ...i,
      style: { font: null, color: null, fontSize: null, alignment: null },
    }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const article = container.querySelector('article') as HTMLElement;
    expect(article.style.fontSize).toBe('26px');
    expect(article.style.fontFamily).toBe('');
    expect(article.style.textAlign).toBe('center');
  });

  it("draws nothing for an absent prose slot, name or event", () => {
    const invitation = shaped(i => ({
      ...i,
      people: [],
      events: [],
      welcome: null,
      familyIntroduction: null,
      eventNotes: null,
      closing: null,
    }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(screen.queryByText('The ceremonies')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
    expect(container.textContent).toBe('Arun weds Deepa');
  });

  it("shows a note about the ceremonies even when there is no ceremony list", () => {
    const invitation = shaped(i => ({ ...i, events: [], eventNotes: 'Lunch follows the ceremony.' }));
    render(<InvitationRenderer invitation={invitation} />);
    expect(screen.getByText('Lunch follows the ceremony.')).toBeInTheDocument();
    expect(screen.queryByText('The ceremonies')).toBeNull();
  });

  it("groups people under the labels the host chose, and none it did not", () => {
    const invitation = shaped(i => ({
      ...i,
      people: [
        { displayName: 'Arun Kumar', roleKey: 'groom', roleLabel: 'Groom', groupKey: 'groom_family', groupLabel: 'Family of the groom' },
        { displayName: 'Deepa Rani', roleKey: 'bride', roleLabel: 'Bride', groupKey: 'bride_family', groupLabel: 'Family of the bride' },
        { displayName: 'An ungrouped name', roleKey: null, roleLabel: null, groupKey: null, groupLabel: null },
      ],
    }));
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(screen.getByText('Family of the groom')).toBeInTheDocument();
    expect(screen.getByText('Family of the bride')).toBeInTheDocument();
    expect(screen.getByText('An ungrouped name')).toBeInTheDocument();
    // A group with no label gets no heading — "Family" would be our claim about a family.
    expect(screen.queryByText('Family and blessings')).toBeNull();
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
    const unnamed = parsePublicInvitation(payloadWith(['invitation', 'events', 0, 'display_name'], null));
    expect(unnamed).not.toBeNull();
    const { container } = render(<InvitationRenderer invitation={unnamed as PublicInvitation} />);
    // The date is a fact the host wrote; the key that names the rite is not.
    expect(container.textContent).toContain('14 November 2026');
    expect(container.textContent).not.toContain('muhurtham');
    expect(container.querySelector('h3')).toBeNull();

    const silent = parsePublicInvitation(
      payloadWith(['invitation', 'events', 0], {
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
