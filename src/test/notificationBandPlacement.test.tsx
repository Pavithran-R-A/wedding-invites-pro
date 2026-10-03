// §31 found the notification band painted over the app's own header, and this file is what stops it
// coming back between browser runs.
//
// The measured defect, at 375x740 over the planning form: the Radix viewport carried `fixed top-0`,
// so the band started at y=0 and its card at y=16, 343x94. Everything in that rectangle was under a
// transient notification — the brand link (127x64 at 16,0), the "Open menu" button (44x44 at 315,10)
// and the "Estimated guests" field (293x40 at 41,27). `elementFromPoint` at the brand link's centre
// answered `li.group`, i.e. the card, and the card lived 5144ms (Radix's default 5000ms duration,
// because `use-toast.ts` passes none). A host who saved a draft on a phone could not press the
// header again until the notification retired on its own.
//
// jsdom lays nothing out, so this test cannot reproduce that geometry; `scripts/stage5-a11y-mobile.mjs`
// does, and its band part now checks the band against the top chrome it has to clear. What belongs
// here is the source-level contract, so that a vendor re-pull of `toast.tsx` or a refactor that
// moves the band back to the top edge is caught without a browser. The two numbers it defends are
// both measured, not guessed: 65px is the bottom edge of the tallest header the band can sit over at
// phone width (the planning page's `header.sticky.top-0`, 64px of `h-16` plus its 1px bottom border),
// and the 16px inset is the `p-4` that puts the card below the band's own top edge.

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";

/** Bottom edge of the tallest app header at phone width, CSS px — measured in the browser as
 *  `top chrome bottom y=65` on the planning page: `h-16` is 64px and the header carries a 1px bottom
 *  border, so a band starting at 64 was still 1px deep into the bar. */
const HEADER_BOTTOM_PX = 65;

const viewport = () => {
  render(<Toaster />);
  act(() => {
    toast({ title: "Saved", description: "Your draft has been updated." });
  });
  // Radix wraps the styled list in its own positioning: the `role="region"` element is a plain div
  // and the classes the app writes land on the `ol` inside it — which is also the element §31 read
  // in the browser (`ol.fixed.top-0 375x126 at 0,0`), so the assertion is about the same node the
  // finding measured.
  const region = screen.getByRole("region", { name: /notifications/i });
  const list = region.querySelector("ol");
  expect(list, "the notification region renders no list to place").not.toBeNull();
  return list as HTMLElement;
};

/** Unprefixed utilities only: `sm:` and `md:` describe the wider layout, not the phone layout. */
const mobileTokens = (el: HTMLElement) => el.className.split(/\s+/).filter((t) => !t.includes(":"));

/** Tailwind's default spacing step is 0.25rem, and `index.css` ships the 16px root size, so a bare
 *  numeric token resolves to a length without the config having to be read here. */
const topOffsetPx = (tokens: string[]) => {
  const token = tokens.find((t) => /^top-(\d+(\.\d+)?|\[[^\]]+\])$/.test(t));
  if (!token) return null;
  const value = token.slice("top-".length);
  if (value.startsWith("[")) {
    const arbitrary = /^\[(\d*\.?\d+)(rem|px)?\]$/.exec(value);
    if (!arbitrary) return null;
    const n = Number(arbitrary[1]);
    return arbitrary[2] === "px" ? n : n * 16;
  }
  return Number(value) * 0.25 * 16;
};

describe("notification band placement on phones", () => {
  it("does not start the band at the top edge of the viewport", () => {
    const tokens = mobileTokens(viewport());
    expect(tokens).not.toContain("top-0");
    expect(tokens.some((t) => /^top-/.test(t))).toBe(true);
  });

  it("starts the band at or below the bottom edge of the header it used to cover", () => {
    const px = topOffsetPx(mobileTokens(viewport()));
    expect(px).not.toBeNull();
    expect(px).toBeGreaterThanOrEqual(HEADER_BOTTOM_PX);
  });

  it("keeps the inset that puts the card below the band's own top edge", () => {
    expect(mobileTokens(viewport())).toContain("p-4");
  });

  it("leaves the tablet and desktop anchor where it was, at the bottom-right", () => {
    // The finding was a phone-layout finding. A fix that moved every breakpoint to the top would
    // trade a header obstruction for a desktop one, so the wider anchor is pinned in the same place.
    const variants = viewport().className.split(/\s+/).filter((t) => t.startsWith("sm:"));
    expect(variants).toEqual(expect.arrayContaining(["sm:top-auto", "sm:bottom-0", "sm:right-0"]));
  });
});
