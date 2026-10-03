// The one control every notification shows but nobody drew a label for.
//
// §31 walked the live editor page with the Tab key and stopped, on its way through the "Saved"
// card, at a button whose accessible name was the empty string. It is not a component anyone
// writes by hand: it comes out of `Toaster`, which renders shadcn's `<ToastClose />` and hands it a
// lucide `<X />` as its only child. An SVG with no text has no name to inherit, so a keyboard user
// is told "button" and nothing else, on every notification the app produces.
//
// The test therefore renders the composition rather than the primitive, and calls `toast()` the way
// `ConfigureProject.tsx` does, because the defect only exists where those two meet. Reading the
// name back through `getByRole` is the point — it is the same computation a screen reader makes, so
// a regression here (a vendor re-pull of toast.tsx losing the label, a refactor that moves the
// close out of the card) fails this file rather than quietly returning an unnamed button to the app.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";

const openSavedCard = () => {
  render(<Toaster />);
  act(() => {
    toast({ title: "Saved", description: "Your draft has been updated." });
  });
  return within(screen.getByText("Saved").closest("[role='status']") ?? document.body);
};

describe("notification dismissal", () => {
  it("names the dismiss control that a keyboard user reaches at the end of the card", () => {
    const card = openSavedCard();
    expect(card.getByRole("button", { name: /dismiss this notification/i })).toBeInTheDocument();
  });

  it("pressing that control takes the card off the page", () => {
    const card = openSavedCard();
    fireEvent.click(card.getByRole("button", { name: /dismiss this notification/i }));
    // Radix unmounts the card once its exit animation ends, and jsdom reports no animation,
    // so removal is the observable outcome here; in a real browser the same press starts that
    // exit and the notification is gone a moment later.
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("leaves no pressable in the card without a name", () => {
    const card = openSavedCard();
    const unnamed = card
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") === null && button.textContent?.trim() === "");
    expect(unnamed).toHaveLength(0);
  });
});
