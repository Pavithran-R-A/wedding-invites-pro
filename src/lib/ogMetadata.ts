// The Open Graph block, derived from one frozen invitation document.
//
// §10.1 states the contract as six pairs. Two properties make it worth a module rather than a
// template in a serving script:
//
//   * **Every byte comes from the parsed DTO** the guest's page draws (`src/lib/publicInvitation.ts`)
//     and through the same wall-clock formatter (`src/lib/wallClock.ts`). A preview that disagrees
//     with the document it previews is the defect this rule prevents — a card saying one date while
//     the page says another is worse than a card with no date at all.
//   * **Nothing is invented where the document is silent.** A slot with nothing in it drops its tag;
//     the platform then shows the page's own title, which is a fact about the app rather than words
//     this stage wrote into someone's wedding.
//
// `og:url` goes through the QR door in `src/render/qrTarget.ts` — the one place that says what a
// public invitation address is — rather than through a second rule of its own. A block whose
// `og:url` were a household door would put `/g/<credential>` into a chat platform's link cache,
// which is the same leak §9.3 exists to prevent on paper; and a *refusal* here emits no tags at all,
// because a half block is exactly what a host would serve by accident.
//
// `og:image` is the pair §15 H-1 keeps dormant. The published-preview URL is a *parameter*, supplied
// only by a serving layer that has decided to make previews fetchable, so no field of a guest's
// document — least of all a venue's `map_url`, which the render sweep fills with `javascript:` — can
// become a crawler's image source by walking through this function.
//
// The two bounds are §10.3's own, and the import specifiers here carry `.ts` for one reason:
// `scripts/og-serving-adapter.mjs` is a plain Node program and Node 24 runs erasable TypeScript
// directly, so the bytes it serves come from this file rather than from a second copy of the rule.

import type { InvitationEvent, PublicInvitation } from './publicInvitation.ts';
import { formatDate, formatTime } from './wallClock.ts';
import { buildQrTarget, type QrTargetRefusal } from '../render/qrTarget.ts';

/** §10.3: this stage's own bound, sized for one line of title on a 360 px link card. Not a measured
 *  platform limit — §10.2 says plainly that no platform's truncation can be observed from here. */
export const OG_TITLE_LIMIT = 88;

/** §10.3 again, sized for roughly two lines of description at the same width. */
export const OG_DESCRIPTION_LIMIT = 300;

/** §10.1's constants. A wedding patrika is a page about one event on one address, not an article. */
export const OG_TYPE = 'website';
export const TWITTER_CARD = 'summary_large_image';

/** One `<meta>` element. `attribute` is spelled per §10.1's own table and `index.html:33-46`:
 *  `property=` for the Open Graph set, `name=` for the Twitter one. */
export interface OgMetaTag {
  readonly attribute: 'property' | 'name';
  readonly key: string;
  readonly content: string;
}

export interface OgMetadataInput {
  /** The document as the guest's own parser answered it. */
  readonly invitation: PublicInvitation;
  /** The published address, as the serving layer knows it. `unknown` because it goes to a door that
   *  is total over anything, not to an assertion about what the caller swears it passed. */
  readonly url: unknown;
  /** Present only when this deployment has opened the published-preview domain (§15 H-1). */
  readonly previewImageUrl?: string | null;
}

/** The only reason this function can refuse is the door's own reason — a new name here would be a
 *  second vocabulary for "is this an invitation address", and §9.3 already has one. */
export type OgMetadataOutcome = { ok: true; tags: OgMetaTag[] } | { ok: false; reason: QrTargetRefusal };

/** Text a host wrote, or nothing at all: the renderer's rule (`InvitationRenderer.tsx:89`), applied
 *  to the same slots so the card and the page agree about which fields say something. */
const hostText = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && value.trim() !== '' ? value : null;

const isWhitespace = (character: string): boolean => /\s/.test(character);

/**
 * Cut at a word boundary, in codepoints, adding nothing.
 *
 * The emitted value is always a prefix of the input, and it always stops where a word stops — never
 * halfway through one, with no ellipsis written in the host's voice. `Array.from` rather than
 * `.length`/`.slice` because a bound counted in UTF-16 units would cut an emoji in half and a
 * broken glyph on a wedding card is not a rounding error.
 *
 * When no boundary fits inside the bound, the rule that survives is the one about words: the largest
 * whole-word prefix is emitted even though it overshoots. §10.3's two clauses cannot both hold for
 * such a value, and the render sweep's own shape 8 (`8-unbroken-english`, 400 letters with no space)
 * is the proof that this is not hypothetical. For a value with no boundary anywhere, the largest
 * whole-word prefix is the value.
 */
const clampToWords = (value: string, limit: number): string => {
  const codepoints = Array.from(value);
  if (codepoints.length <= limit) return value;
  for (let length = limit; length >= 1; length -= 1) {
    if (!isWhitespace(codepoints[length])) continue;
    const head = codepoints.slice(0, length).join('').trimEnd();
    if (head !== '') return head;
    // A boundary whose whole prefix is blank cannot be the value: `content=""` would be an empty
    // attribute standing where the document promised words. Shorter cuts are more of the same.
    break;
  }
  const firstBoundary = codepoints.findIndex(isWhitespace);
  return firstBoundary <= 0 ? value : codepoints.slice(0, firstBoundary).join('').trimEnd();
};

/** The one line this event can contribute: the same day, the same range, the venue's own name —
 *  composed the way `InvitationRenderer`'s `EventBlock` composes its three lines, so the card is a
 *  flattened first line of the document rather than a new reading of it.
 *
 *  Deliberately absent: the event's `displayName` (§10.1 asks for a date and a place, and a ceremony
 *  name beside a venue name reads as a second venue) and its `timezone` (an IANA name on a one-line
 *  card is a place the guest cannot book a taxi to; the page prints it on its own line, where it is
 *  labelled by being under the time). */
const eventLine = (event: InvitationEvent): string | null => {
  const day = event.startsAtLocal === null ? null : formatDate(event.startsAtLocal);
  const from = event.startsAtLocal === null ? null : formatTime(event.startsAtLocal);
  const to = event.endsAtLocal === null ? null : formatTime(event.endsAtLocal);
  const hours = from === null ? null : `${from}${to === null ? '' : ` – ${to}`}`;
  const when = day === null ? hours : `${day}${hours === null ? '' : ` · ${hours}`}`;
  const parts = [when, hostText(event.venue?.name ?? null)].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(', ');
};

/** The first ceremony that has a moment or a place on it, then the host's own opening line, then
 *  nothing. An event with neither contributes no line — the page skips such a row too, so a card
 *  built from the first *row* rather than the first *line* could advertise a ceremony nobody reads. */
const descriptionOf = (invitation: PublicInvitation): string | null => {
  for (const event of invitation.events) {
    const line = eventLine(event);
    if (line !== null) return line;
  }
  return hostText(invitation.welcome);
};

export function buildOgMetadata(input: OgMetadataInput): OgMetadataOutcome {
  const target = buildQrTarget(input.url);
  if (target.ok === false) return { ok: false, reason: target.reason };

  const tags: OgMetaTag[] = [];
  const title = hostText(input.invitation.title);
  if (title !== null) {
    tags.push({ attribute: 'property', key: 'og:title', content: clampToWords(title, OG_TITLE_LIMIT) });
  }
  const description = descriptionOf(input.invitation);
  if (description !== null) {
    tags.push({
      attribute: 'property',
      key: 'og:description',
      content: clampToWords(description, OG_DESCRIPTION_LIMIT),
    });
  }
  tags.push({ attribute: 'property', key: 'og:type', content: OG_TYPE });
  const preview = hostText(input.previewImageUrl);
  if (preview !== null) tags.push({ attribute: 'property', key: 'og:image', content: preview });
  tags.push({ attribute: 'property', key: 'og:url', content: target.url });
  tags.push({ attribute: 'name', key: 'twitter:card', content: TWITTER_CARD });

  return { ok: true, tags };
}

/** `&` first, or it would escape the escapes. */
const escapeAttributeValue = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The `<meta>` block as bytes, in `buildOgMetadata`'s order.
 *
 * Host text is an attribute value, and the render sweep's `10-hostile-markup` title is literally
 * `'"><script>alert(1)</script>'`. Escaping here rather than in each serving script is what lets §10.2
 * say the contract was tested: the probe hashes these bytes, and one implementation of the escape is
 * the difference between a tested contract and a re-imagined one.
 */
export function serializeOgMetaTags(tags: readonly OgMetaTag[]): string {
  return tags
    .map((tag) => `<meta ${tag.attribute}="${tag.key}" content="${escapeAttributeValue(tag.content)}" />`)
    .join('\n');
}
