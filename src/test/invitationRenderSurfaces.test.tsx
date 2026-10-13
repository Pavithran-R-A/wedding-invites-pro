// The renderer's render-surface hook, and the promise that it is *only* a hook.
//
// `docs/superpowers/specs/2026-10-13-stage9-render-exports-design.md` §6.1 allows one change to
// the one renderer: an optional prop that stamps `data-render-surface` on the article. Everything
// else Stage 9 needs per artefact — which lines a teaser drops, where a page may break, what box
// the document sits in — belongs to `src/render/render.css`, a stylesheet the live product never
// loads.
//
// So these tests are not really about the attribute. They are about the two ways this hook could
// quietly break the guest page:
//
//   * **The hook changes layout.** If a section had to be wrapped in a new element to become
//     addressable by CSS, the spacing between a heading and its body would move on the live page
//     too, because `header.space-y-3` spaces *children*. Test 3 below is the one that refuses
//     that: strip the attributes and the two renders must be the same bytes.
//   * **CSS ends up addressing structure.** `article > section:nth-of-type(2)` says nothing about
//     what it selects once a release reorders the section list, so an artefact would silently
//     change which lines it drops. That is why every drawn section carries its own kind and region
//     — the closed vocabularies from `src/lib/invitationSections.ts`, not a positional guess.
//
// The map link is in here for the third way: a PNG has nothing to click, so the teaser and the
// share image must hide the "Open the venue map" box while the PDF keeps it. That is a CSS
// decision, so the renderer has to print the link for *every* surface — if it ever learned to
// decide, the live guest page would be the thing that loses the link first.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import InvitationRenderer from "@/components/invitation/InvitationRenderer";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import { RENDER_SECTION_KINDS } from "@/lib/invitationSections";
import { DOCUMENT_SURFACES } from "@/lib/renderSurfaces";
import {
  guestEvent,
  guestInvitation,
  guestPayload,
  packedGuestPayload,
  payloadWith,
} from "@/test/invitationFixture";

/** Read a fixture through the parser, refusing to let a test run on a document the guest page
 *  could not be shown. */
const through = (payload: unknown): PublicInvitation => {
  const invitation = parsePublicInvitation(payload);
  if (invitation === null) throw new Error('the fixture no longer parses');
  return invitation;
};

const parsed = (): PublicInvitation => through(guestPayload());

/** The same host's words as `parsed()`, with a second ceremony, so "first event only" has
 *  something to be about. */
const parsedTwoEvents = (): PublicInvitation =>
  through(payloadWith(['invitation', 'events', 1], {
    ...guestEvent(),
    event_key: 'reception',
    display_name: 'Reception',
  }));

const articleOf = (invitation: PublicInvitation, surface?: 'og' | 'share' | 'pdf') => {
  const { container } = render(
    <InvitationRenderer invitation={invitation} {...(surface ? { surface } : {})} />,
  );
  return container;
};

/** The `data-render-*` pairs, as they appear in the DOM, sorted so the comparison is about the
 *  set rather than about rendering order. */
const renderAttrs = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-render-kind]')]
    .map((el) => `${el.dataset.renderKind}:${el.dataset.renderRegion}`)
    .sort();

describe('the render-surface hook', () => {
  it('stamps nothing when no surface is asked for', () => {
    // The guest page and the host's preview never pass this prop, and this is the case that
    // notices if a later change starts passing it: an artefact rule binding to a live page is
    // the drift §6.1 exists to prevent.
    const container = articleOf(parsed());
    expect(container.querySelector('[data-render-surface]')).toBeNull();
    expect(container.innerHTML).not.toContain('data-render-');
  });

  it.each([...DOCUMENT_SURFACES])('names the %s surface on the article root alone', (surface) => {
    const container = articleOf(parsed(), surface);
    const stamped = container.querySelectorAll('[data-render-surface]');
    expect(stamped.length).toBe(1);
    expect(stamped[0].getAttribute('data-render-surface')).toBe(surface);
    expect(stamped[0].tagName).toBe('ARTICLE');
  });

  it('adds attributes and nothing else: the same document with and without a surface is the same DOM', () => {
    for (const invitation of [parsed(), through(packedGuestPayload())]) {
      const plain = articleOf(invitation).innerHTML;
      for (const surface of DOCUMENT_SURFACES) {
        const stamped = articleOf(invitation, surface).innerHTML.replace(/ data-render-[a-z-]+="[^"]*"/g, '');
        expect(stamped).toBe(plain);
      }
    }
  });

  it('addresses every drawn section by its own kind and region, not by where it landed', () => {
    // The no-pack document resolves to: welcome and family_introduction (both opening, both
    // text, both with a body and no heading), the family roster and the ceremonies list (both
    // body), with event_notes and closing empty and therefore dropped. A surface has to be
    // requested for any of this to be stamped at all — the unstamped case is test 1.
    expect(renderAttrs(articleOf(parsed(), 'og'))).toEqual([
      'event_list:body',
      'people_list:body',
      'text:opening',
      'text:opening',
    ]);
  });

  it('only ever names kinds and regions from the closed vocabularies', () => {
    const container = articleOf(parsedTwoEvents(), 'share');
    const stamped = [...container.querySelectorAll<HTMLElement>('[data-render-kind]')];
    // The loop below would pass on an empty list, which is exactly the case where CSS has nothing
    // to address and an artefact silently renders the live page's geometry.
    expect(stamped.length).toBeGreaterThan(0);
    for (const el of stamped) {
      expect(RENDER_SECTION_KINDS).toContain(el.dataset.renderKind);
      expect(['opening', 'body', 'closing']).toContain(el.dataset.renderRegion);
    }
  });

  it('numbers the drawn events so a teaser can name the first one', () => {
    // Position among *drawn* events, 1-based: `display_name` null on the second event would
    // otherwise leave the teaser pointing at a row that is not on the page.
    const container = articleOf(parsedTwoEvents(), 'og');
    const positions = [...container.querySelectorAll<HTMLElement>('[data-render-event-position]')]
      .map((el) => el.dataset.renderEventPosition);
    expect(positions).toEqual(['1', '2']);
  });

  it('prints the venue map link on every surface, because hiding it is CSS’s job', () => {
    for (const surface of DOCUMENT_SURFACES) {
      const link = articleOf(parsed(), surface).querySelector('a[href="https://maps.example/sri-kanchi-mahal"]');
      expect(link).not.toBeNull();
    }
  });
});
