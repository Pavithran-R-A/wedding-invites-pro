// The household's route, tested the way a family arrives: a link in a message thread, opened on a
// phone, with no account on the device and no intention of making one.
//
// What is pinned here is the page's own promises, not the transport's (that is
// `guestDoorTransport.test.ts`) and not the payload's shape (that is `guestInvitationShape.test.ts`):
//
//   * The invitation under the form is drawn by the guest's renderer, from the guest's parser, with the
//     document's one level-1 heading — a family must not be shown a better or worse patrika than the
//     words the couple published (Ruling 5.1 of `docs/architecture/guest-rsvp-security.md`).
//   * The form is bounded by what the door accepts. Only answered events are sent; a declined card
//     sends 0 rather than an invented headcount; and the four ways a headcount can be wrong are
//     corrected here so that a guest is never the person who discovers a database CHECK
//     (`20261009120000_stage8_guest_invitations_rsvp.sql:822`, `:826-827`). Those four are also the
//     reason the `<form>` carries `noValidate`: while the browser was validating the field itself, a
//     guest's `0`, `1.5` or `1001` stopped the `submit` event from reaching `send()` at all, so the
//     page's own sentence — the one wired to `aria-describedby` and `role=alert` — never rendered and
//     the button looked dead. Measured in the failing run kept at
//     `../../../q8-logs/s8-guestdoor-scratch4.log`, and green in `…-scratch5-novlidate.log`.
//   * The cap is *not* checked here. `expected_party_size` is the host's expectation and the door is
//     the authority on it (`:873-882`), so the page states the number as guidance and lets the door's
//     own `party_size_too_large` sentence answer a guest who reached it. A local copy of that rule
//     would be a second owner of one number, and the two would disagree about who is allowed to bring
//     more people.
//   * A household is not exactly-once. Stage 7's reviewer spends an ask; a family answers a question
//     that stays open, so the form survives its own success and a correction can be sent again — the
//     opposite of the reviewer page, on purpose.
//   * Every failure at the door is one sentence, and nothing about the page offers a way in.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({ resolve: vi.fn(), submit: vi.fn() }));

vi.mock("@/integrations/supabase/guestDoor", () => ({
  GUEST_DOOR_UNAVAILABLE: 'This invitation link is not available.',
  GUEST_ANSWER_NOT_RECORDED: 'Your reply could not be recorded.',
  resolveGuestInvitation: (...args: unknown[]) => api.resolve(...args),
  submitGuestRsvp: (...args: unknown[]) => api.submit(...args),
}));

import GuestDoorPage from "@/pages/GuestDoor";
import { parseGuestDoorDocument } from "@/lib/guestInvitation";
import { guestInvitation } from "@/test/invitationFixture";

/** The minted credential's shape: 41 characters plus two from the alphabet, 43 in all. */
const TOKEN = 'a'.repeat(41) + '_-';
const HOUSEHOLD_ID = '9d2a6f3e-5b18-4c7a-a0e4-000000000011';
const EVENT_ID = '1c9b4d70-3e62-4a58-bf19-000000000014';
const OTHER_EVENT_ID = '6e1b8c40-9d27-4f5a-9c3e-000000000016';

const defaultTitle = document.title;

/** A card exactly as the door's `jsonb_agg` writes it (`…sql:650-659`): every key present, and the
 *  three answer keys null until the household speaks. */
const card = (overrides: Record<string, unknown> = {}) => ({
  event_id: EVENT_ID,
  display_name: 'Wedding ceremony',
  starts_at_local: '2026-11-14T07:30:00',
  ends_at_local: '2026-11-14T09:00:00',
  timezone: 'Asia/Kolkata',
  attending: null,
  party_size: null,
  responded_at: null,
  ...overrides,
});

/** The whole door envelope (`…sql:684-697`) read through the real parser, so a page that renders a
 *  field the projection stopped writing is caught here rather than in a browser. */
const doorDocument = (guestOverrides: Record<string, unknown> = {}) =>
  parseGuestDoorDocument({
    available: true,
    guest: {
      household_id: HOUSEHOLD_ID,
      display_name: 'Raman Family',
      greeting: 'Dear Raman Family',
      expected_party_size: 4,
      version_number: 3,
      can_respond: true,
      responds_until: '2026-11-01T09:00:00+00:00',
      events: [card()],
      ...guestOverrides,
    },
    invitation: guestInvitation(),
  });

const receipt = (eventsRecorded: number) => ({
  kind: 'recorded' as const,
  receipt: {
    householdId: HOUSEHOLD_ID,
    eventsRecorded,
    respondedAt: '2026-10-20T12:04:00+00:00',
  },
});

const visit = () =>
  render(
    <MemoryRouter initialEntries={[`/g/${TOKEN}`]}>
      <Routes>
        <Route path="/g/:token" element={<GuestDoorPage />} />
      </Routes>
    </MemoryRouter>,
  );

/** The headcount field, by the label a guest aims at. */
const sizeField = () => screen.getByRole('spinbutton', { name: /How many of you, including you\?/i });

beforeEach(() => {
  api.resolve.mockReset();
  api.submit.mockReset();
  document.title = defaultTitle;
});

describe("a family arriving on a working link", () => {
  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: doorDocument(), error: null });
  });

  it("reads its invitation through the one resolver, with the link's own credential", async () => {
    visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    expect(api.resolve).toHaveBeenCalledTimes(1);
    expect(api.resolve).toHaveBeenCalledWith(TOKEN);
  });

  it("draws the guest's document, not a second opinion of it", async () => {
    const { container } = visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    expect(container.textContent).toContain("With the blessings of our elders");
    expect(container.textContent).toContain("Sri Kanchi Mahal");
    expect(container.textContent).toContain("12 Temple Street");
    // One level-1 heading, and it belongs to the invitation: the greeting and the form's titles are
    // lower or unmarked, so a guest navigating by headings finds one document, not three.
    expect(screen.getAllByRole("heading", { level: 1 }).map(heading => heading.textContent))
      .toEqual(["Arun weds Deepa"]);
  });

  it("prints the event's day and time in the card exactly as the invitation prints them", async () => {
    const { container } = visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    // Both come from `src/lib/wallClock.ts`, and this is the assertion that keeps them from drifting:
    // a card that said a different day than the document above it would be a page arguing with the
    // wedding about when the wedding is. Two nodes carry the instant — the document's event block and
    // this household's card — and both must print the snapshot's own day.
    const stamps = Array.from(container.querySelectorAll('time'))
      .filter(node => node.getAttribute("datetime") === "2026-11-14T07:30:00");
    expect(stamps).toHaveLength(2);
    expect(stamps.every(node => node.textContent === "14 November 2026")).toBe(true);
    // Each name appears twice on this page — once drawn from the frozen document, once as the card's
    // own legend — so the card is checked by role and the document by text, and neither is unique.
    expect(screen.getAllByText("Wedding ceremony")).toHaveLength(2);
    expect(screen.getAllByText("Asia/Kolkata")).toHaveLength(2);
  });

  it("names the day the link stops working, in the reader's own calendar", async () => {
    visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    // `responds_until` is a `timestamptz`, so the day printed is the reader's — the opposite rule to
    // the ceremony's wall-clock text, and `src/lib/instantText.ts` holds that difference.
    expect(document.querySelector("main")?.textContent).toContain("You can reply until");
  });

  it("needs no account, offers none, and keeps its own address out of the page", async () => {
    const { container } = visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    const text = container.textContent ?? "";
    expect(screen.queryByRole("link", { name: /log ?in|sign ?in|dashboard|create account/i })).toBeNull();
    expect(text).toContain("No account or app is needed to read this invitation");
    expect(text).not.toContain(TOKEN);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("renders the host's greeting as text, whatever it contains", async () => {
    // `salutation` is host-authored free text (`20260925120300_stage2_guests_approvals_rsvp.sql:22-24`),
    // so a family name with markup in it is a name, not a script. The product contract's markup-sink
    // rule refuses the write; this refuses the render.
    api.resolve.mockResolvedValue({
      data: doorDocument({ greeting: "<b>Raman</b> & family" }),
      error: null,
    });
    const { container } = visit();
    await waitFor(() => expect(screen.getByText("<b>Raman</b> & family")).toBeInTheDocument());
    expect(container.querySelector("b")).toBeNull();
  });

  it("titles the tab with the family's names, and puts it back on leaving", async () => {
    const { unmount } = visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    await waitFor(() => expect(document.title).toBe("Arun weds Deepa — your invitation"));
    unmount();
    expect(document.title).toBe(defaultTitle);
  });
});

describe("the answer form, before anything is sent", () => {
  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: doorDocument(), error: null });
  });

  it("asks one choose-one question per event, inside its label, and never reuses a name", async () => {
    api.resolve.mockResolvedValue({
      data: doorDocument({ events: [card(), card({ event_id: OTHER_EVENT_ID, display_name: "Reception" })] }),
      error: null,
    });
    visit();
    const coming = await screen.findAllByRole("radio", { name: /We are coming/i });
    const declining = screen.getAllByRole("radio", { name: /Not coming/i });
    expect(coming).toHaveLength(2);
    expect(declining).toHaveLength(2);
    expect(coming[0].getAttribute("name")).toBe("guest-attending-0");
    expect(coming[1].getAttribute("name")).toBe("guest-attending-1");
    expect(coming[0].closest("label")).not.toBeNull();
    // Each event is one labelled group, so a screen reader announces which ceremony a radio belongs to.
    expect(screen.getByRole("group", { name: /Wedding ceremony/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Reception/i })).toBeInTheDocument();
  });

  it("will not send without an answer, and says so in a live region", async () => {
    visit();
    const send = await screen.findByRole("button", { name: /Send my reply/i });
    expect(send).toBeDisabled();
    expect(screen.getByText("Choose an answer on at least one event to send it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /We are coming/i }));
    expect(screen.queryByText("Choose an answer on at least one event to send it.")).toBeNull();
    expect(send).toBeEnabled();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("asks for a headcount only beside an answer that needs one", async () => {
    visit();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(await screen.findByRole("radio", { name: /Not coming/i }));
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /We are coming/i }));
    expect(sizeField()).toBeInTheDocument();
  });

  it("carries the household's own last answer into the form, in the field and beside it", async () => {
    api.resolve.mockResolvedValue({
      data: doorDocument({
        events: [card({ attending: "attending", party_size: 3, responded_at: "2026-10-15T09:12:00+00:00" })],
      }),
      error: null,
    });
    visit();
    const coming = await screen.findByRole("radio", { name: /We are coming/i });
    expect(coming).toBeChecked();
    expect(sizeField()).toHaveValue(3);
    expect(document.querySelector("main")?.textContent).toContain("You last said 3 of you are coming");
  });

  it("shows a recorded word this build has never read, and preselects nothing", async () => {
    // An unfamiliar `attending` value is the family's answer, not a defect: the shape layer keeps it as
    // text rather than inventing a default, so the page must say it cannot read it rather than render
    // it as "attending" and let a correction overwrite a fact quietly.
    api.resolve.mockResolvedValue({
      data: doorDocument({ events: [card({ attending: "maybe", party_size: 2, responded_at: null })] }),
      error: null,
    });
    visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /We are coming/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Not coming/i })).not.toBeChecked();
    expect(document.querySelector("main")?.textContent)
      .toContain('Your last reply was recorded as “maybe”, a word this page cannot read.');
  });

  it("clears the headcount when a family changes its mind to not coming", async () => {
    api.resolve.mockResolvedValue({
      data: doorDocument({ events: [card({ attending: "attending", party_size: 3, responded_at: null })] }),
      error: null,
    });
    visit();
    // The door answers asynchronously, so the carried-over field is waited for rather than assumed:
    // asking for it in the same tick as `visit()` measures a page that is still opening.
    expect(await screen.findByRole('spinbutton', { name: /How many of you, including you\?/i }))
      .toHaveValue(3);
    fireEvent.click(await screen.findByRole("radio", { name: /Not coming/i }));
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("names the family's expectation beside the field, without claiming to enforce it", async () => {
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    const hint = document.getElementById("guest-party-size-0-hint");
    expect(hint?.textContent).toContain("The family expects 4.");
  });

  it("sends an answer above the expectation to the door, which is the authority on the cap", async () => {
    // The page does not refuse 9 because the host wrote 4: the door decides, and its
    // `party_size_too_large` sentence is the one that can point the guest at the person who can change
    // the number. A local copy of that rule would be a second, weaker owner of the same sentence.
    api.submit.mockResolvedValue({ data: receipt(1), error: null });
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith(TOKEN, [
      { eventId: EVENT_ID, attending: "attending", partySize: 9 },
    ]));
  });
});

describe("what the page refuses before the door is asked", () => {
  const withHeadcount = async (value: string) => {
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).not.toHaveBeenCalled());
  };

  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: doorDocument(), error: null });
  });

  it("asks for a number when the field is empty, and does not spend a round trip on it", async () => {
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).not.toHaveBeenCalled());
    expect(screen.getByText("Tell the family how many of you are coming.")).toBeInTheDocument();
  });

  it("refuses a decimal locally, where the door would have answered with a cast error", async () => {
    // `…sql:822` tests the *text* for digits before casting, because 1.5 would reach `::int` as 22P02
    // with the offending string in its message. The page keeps that text out of the guest's way.
    await withHeadcount("1.5");
    expect(screen.getByText("Enter a whole number of guests, like 3.")).toBeInTheDocument();
  });

  it("refuses zero beside an attending answer, and points at the other answer", async () => {
    // `…sql:827`: an "attending" row with a headcount of 0 is the contradiction the migration names —
    // the host panel would read it as nobody coming.
    await withHeadcount("0");
    expect(screen.getByText(/Choose “Not coming” if nobody from your household is attending\./)).toBeInTheDocument();
  });

  it("refuses a headcount past the column's bound locally", async () => {
    await withHeadcount("1001");
    expect(screen.getByText(/more guests than one reply can hold/i)).toBeInTheDocument();
  });

  it("wires each refusal to the field it belongs to", async () => {
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).not.toHaveBeenCalled());
    const field = sizeField();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")?.split(" ")).toEqual([
      "guest-party-size-0-hint",
      "guest-party-size-0-problem",
    ]);
  });

  it("lifts the refusal as soon as the family fixes the number", async () => {
    api.submit.mockResolvedValue({ data: receipt(1), error: null });
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(screen.getByText(/nobody from your household is attending/)).toBeInTheDocument());
    fireEvent.change(sizeField(), { target: { value: "2" } });
    expect(screen.queryByText(/nobody from your household is attending/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  });

  it("sends only the events the family answered, and none they left alone", async () => {
    api.submit.mockResolvedValue({ data: receipt(1), error: null });
    api.resolve.mockResolvedValue({
      data: doorDocument({ events: [card(), card({ event_id: OTHER_EVENT_ID, display_name: "Reception" })] }),
      error: null,
    });
    visit();
    // A radio's accessible name is its own label ("We are coming"), never the event it belongs to, so
    // the second card is waited for through the group the legend names.
    await screen.findByRole("group", { name: /Reception/i });
    // The second event's radios are `guest-attending-1`: answering only the first must not touch it,
    // because the door upserts exactly the events a submission names (`…sql:910-922`).
    fireEvent.click(screen.getAllByRole("radio", { name: /We are coming/i })[1]);
    fireEvent.change(sizeField(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith(TOKEN, [
      { eventId: OTHER_EVENT_ID, attending: "attending", partySize: 2 },
    ]));
  });

  it("sends 0 for a decline, because a number the guest was not asked for is an invented one", async () => {
    api.submit.mockResolvedValue({ data: receipt(1), error: null });
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /Not coming/i }));
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith(TOKEN, [
      { eventId: EVENT_ID, attending: "declined", partySize: 0 },
    ]));
  });
});

describe("after an answer lands", () => {
  beforeEach(() => {
    api.resolve.mockResolvedValue({ data: doorDocument(), error: null });
  });

  it("shows the door's own count, moves focus to it, and keeps the form open", async () => {
    api.submit.mockResolvedValue({ data: receipt(2), error: null });
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(screen.getByText("Your reply is recorded")).toBeInTheDocument());
    // The count is the database's, not the page's: a family told "saved" for an answer that was not
    // written has been told something the host will disagree with.
    expect(screen.getByText("Your answer is saved for 2 events.")).toBeInTheDocument();
    // A household is not exactly-once: the form stays, because a mis-tap must be correctable from the
    // same link (design §7), which is the opposite of Stage 7's reviewer receipt.
    expect(screen.getByRole("button", { name: /Send my reply/i })).toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain("Your reply is recorded");
  });

  it("replaces the receipt when the family sends a correction", async () => {
    api.submit.mockResolvedValueOnce({ data: receipt(1), error: null });
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(screen.getByText("Your answer is saved for one event.")).toBeInTheDocument());
    api.submit.mockResolvedValueOnce({ data: receipt(1), error: null });
    fireEvent.change(sizeField(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Your reply is recorded")).toHaveLength(1);
  });

  it("prints the door's refusal as its own sentence and leaves the form filled", async () => {
    api.submit.mockResolvedValue({
      data: null,
      error: 'That is more guests than this invitation is for. Ask the host if more can be added.',
    });
    visit();
    fireEvent.click(await screen.findByRole("radio", { name: /We are coming/i }));
    fireEvent.change(sizeField(), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my reply/i }));
    await waitFor(() =>
      expect(screen.getByText("That is more guests than this invitation is for. Ask the host if more can be added."))
        .toBeInTheDocument(),
    );
    // Nobody should have to retype an answer they were refused over a number.
    expect(sizeField()).toHaveValue(9);
    expect(screen.getByRole("radio", { name: /We are coming/i })).toBeChecked();
  });
});

describe("a door with nothing to answer, and every door that will not open", () => {
  it("keeps the invitation readable when the household has no event to answer", async () => {
    api.resolve.mockResolvedValue({ data: doorDocument({ events: [], can_respond: false }), error: null });
    visit();
    await waitFor(() => expect(screen.getByText("Arun weds Deepa")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Send my reply/i })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    // The sentence is one product line that JSX wraps; matching it by prefix keeps the assertion about
    // what the page promises rather than about where its source happens to break a line.
    expect(screen.getByText(/^There is no event on this invitation for your household to answer yet\./))
      .toBeInTheDocument();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("says one sentence for a link that will not open, and asks for nothing", async () => {
    api.resolve.mockResolvedValue({ data: null, error: "This invitation link is not available." });
    const { container } = visit();
    await waitFor(() => expect(screen.getByText("This invitation link is not available.")).toBeInTheDocument());
    expect(container.textContent).toContain("Only the family can send a working invitation link.");
    // No ranking of failure causes, and nothing that offers a way in. The brand lockup's own link home
    // is on every page of this app, so the promise under test is the absence of a *sign-in* route, not
    // the absence of anchors.
    expect(screen.queryByRole("link", { name: /log ?in|sign ?in|dashboard|create account|register/i })).toBeNull();
    expect(container.textContent).not.toContain(TOKEN);
  });

  it("refuses the same way when the payload is one this build cannot vouch for", async () => {
    // `{ available: true }` with a household block missing a required field is a projection change, and
    // the parser's answer is null — which the page must render as the one sentence, not as a half-drawn
    // invitation whose form would refuse every answer.
    api.resolve.mockResolvedValue({ data: null, error: null });
    visit();
    await waitFor(() => expect(screen.getByText("This invitation link is not available.")).toBeInTheDocument());
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("refuses a credential-less address with the one sentence, without a round trip", async () => {
    // The page's own guard: `useParams` can hand it nothing, and an empty credential is not worth
    // asking the door about. Mounted on a route that carries no `:token`, which is how that arrives.
    render(
      <MemoryRouter initialEntries={["/g"]}>
        <Routes>
          <Route path="/g" element={<GuestDoorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("This invitation link is not available.")).toBeInTheDocument());
    expect(api.resolve).not.toHaveBeenCalled();
  });
});
