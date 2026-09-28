// The tradition-pack picker, tested as the surface that decides a wording source.
//
// A choice here is not cosmetic: it changes which text a guest reads, and it is the only
// customer-visible write Stage 4 adds. Three things are worth pinning, and none of them is
// visible while clicking around.
//
//   * The panel writes through one adapter call and believes only what comes back. A refused
//     selection has to leave the *shown* choice alone — a picker that moved the highlight to
//     the row the database said no to would be telling a host their invitation uses wording it
//     does not use.
//   * The panel never speaks about the review. The adapter refuses to select those columns
//     (`traditionReleases.test.ts` proves the query); here the assertion is about words,
//     because a UI that hides provenance is a choice and a UI that has no name for it is a
//     contract. The vocabulary test is the one that fails if someone adds a "Reviewed by" line
//     to the design later.
//   * A retired release and a definition this build cannot read are both explained rather than
//     silently drawn, because in both cases the host's expectation and the document have
//     genuinely diverged.
//
// The adapter is mocked at the same seam `editInvitationPage.test.tsx` uses: what is sent over
// PostgREST is qualified in `traditionReleases.test.ts` and against the real local database in
// `supabase/tests/stage4/`, so re-stubbing the transport here would test the mock.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  SelectedTraditionRelease,
  TraditionReleaseOption,
} from "@/integrations/supabase/traditionReleases";

const api = vi.hoisted(() => ({
  listSelectableTraditionReleases: vi.fn(),
  getSelectedTraditionRelease: vi.fn(),
  selectTraditionRelease: vi.fn(),
  clearTraditionRelease: vi.fn(),
}));

vi.mock("@/integrations/supabase/traditionReleases", () => ({
  listSelectableTraditionReleases: (...a: unknown[]) => api.listSelectableTraditionReleases(...a),
  getSelectedTraditionRelease: (...a: unknown[]) => api.getSelectedTraditionRelease(...a),
  selectTraditionRelease: (...a: unknown[]) => api.selectTraditionRelease(...a),
  clearTraditionRelease: (...a: unknown[]) => api.clearTraditionRelease(...a),
}));

import TraditionPackPanel from "@/components/invitation/TraditionPackPanel";

const USER = "11111111-1111-4111-8111-111111111111";
const WEDDING = "33333333-3333-4333-8333-333333333333";
const RELEASE = "55555555-5555-4555-8555-555555555555";
const OTHER_RELEASE = "66666666-6666-4666-8666-666666666666";

const ok = <T,>(data: T) => ({ data, error: null });

const option = (overrides: Partial<TraditionReleaseOption> = {}): TraditionReleaseOption => ({
  id: RELEASE,
  packKey: "tamil-english-foundation",
  packDisplayName: "Tamil + English foundation",
  scopeStatement: "Structural wording sections only; no ritual instruction.",
  releaseNumber: 1,
  languages: ["ta", "en"],
  ...overrides,
});

const selection = (overrides: Partial<SelectedTraditionRelease> = {}): SelectedTraditionRelease => ({
  ...option(),
  definition: { sections: [] },
  definitionSchemaVersion: 1,
  retired: false,
  ...overrides,
});

/** The mount read answers "nothing chosen", every later read answers `value`. Needed because
 *  a radio a host has to click is a radio that starts unchecked: one answer for both reads
 *  would either pre-select the row under test or never select it. */
const chosenAfterWriting = (value: SelectedTraditionRelease) => {
  api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(null));
  api.getSelectedTraditionRelease.mockResolvedValue(ok(value));
};

/** Everything the panel says, as one lowercase string for the vocabulary test. */
const spokenText = (): string =>
  String(screen.getByRole("region", { name: "Tradition & wording" }).textContent ?? "").toLowerCase();

const chosen = vi.hoisted(() => vi.fn());

const mount = (suppliedSlotLabels: string[] = []) =>
  render(
    <TraditionPackPanel
      userId={USER}
      weddingId={WEDDING}
      suppliedSlotLabels={suppliedSlotLabels}
      onSelectionChanged={chosen}
    />,
  );

/** The radio of one option row, found by the words the host read rather than by position: a
 *  picker with two rows today is a picker someone adds to tomorrow. */
const radioOf = (name: RegExp): HTMLInputElement =>
  screen.getByRole("radio", { name }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.listSelectableTraditionReleases.mockResolvedValue(ok([]));
  api.getSelectedTraditionRelease.mockResolvedValue(ok(null));
  api.selectTraditionRelease.mockResolvedValue(ok(null));
  api.clearTraditionRelease.mockResolvedValue(ok(null));
});

describe("loading the choice", () => {
  it("reads the catalogue and this wedding's selection by the caller's own two ids", async () => {
    mount();
    await waitFor(() => expect(radioOf(/^No tradition pack/)).toBeTruthy());

    expect(api.listSelectableTraditionReleases).toHaveBeenCalledTimes(1);
    expect(api.getSelectedTraditionRelease).toHaveBeenCalledWith(USER, WEDDING);
  });

  it("shows each release as the pack, its number and its coverage — and nothing else", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    const { container } = mount();
    await waitFor(() =>
      expect(screen.getByText("Structural wording sections only; no ritual instruction.")).toBeTruthy(),
    );

    expect(container.textContent).toContain("Tamil + English foundation");
    expect(container.textContent).toContain("release 1");
    expect(container.textContent).toContain("Languages: Tamil, English");
  });

  it("prints a language this build has never heard of as its own code", async () => {
    // Dropping an unfamiliar code would hide a claim the release genuinely makes; naming it
    // something this build invented would be this panel's claim instead.
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option({ languages: ["ta", "fr"] })]));
    const { container } = mount();
    await waitFor(() =>
      expect(screen.getByText("Structural wording sections only; no ritual instruction.")).toBeTruthy(),
    );

    expect(container.textContent).toContain("Languages: Tamil, fr");
  });

  it("says so when there is nothing to choose, and still offers writing it yourself", async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByText(
        "No pack is available to choose right now, so this invitation is drawn from your own words.",
      )).toBeTruthy(),
    );

    expect(screen.queryByText("Tamil + English foundation")).toBeNull();
    expect(radioOf(/^No tradition pack/).checked).toBe(true);
  });

  it("says a pack is optional before the catalogue arrives and after it comes back empty", async () => {
    // §19 requires this sentence, and requires it as a statement rather than as an absence: a
    // host who is shown no packs must still be told that writing everything yourself is a
    // decision the platform supports. Both halves are measured here because the two states look
    // nothing alike on screen — one has no picker at all, the other has a picker with one row.
    const OPTIONAL = "Tradition packs are optional. You can create an invitation without one.";

    let resolveCatalogue: (value: { data: TraditionReleaseOption[] | null; error: string | null }) => void = () => {};
    api.listSelectableTraditionReleases.mockImplementation(
      () => new Promise((resolve) => { resolveCatalogue = resolve; }),
    );
    mount();

    expect(screen.getByText("Loading the tradition packs…")).toBeTruthy();
    expect(screen.getByText(OPTIONAL)).toBeTruthy();

    await act(async () => { resolveCatalogue({ data: [], error: null }); });
    await waitFor(() => expect(radioOf(/^No tradition pack/)).toBeTruthy());
    expect(screen.getByText(OPTIONAL)).toBeTruthy();
  });

  it("shows one phrase rather than two server sentences when both reads fail", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue({ data: null, error: "the tradition packs could not be loaded" });
    api.getSelectedTraditionRelease.mockResolvedValue({ data: null, error: "this invitation could not be opened" });
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("the tradition packs could not be loaded");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // A failed load is not a picker: a radio with no catalogue behind it would let a host
    // believe they had chosen something.
    expect(screen.queryByRole("radio")).toBeNull();
    // And the optional-pack statement is not one of the things a failed load takes with it: the
    // panel still tells the host that nothing here is required of them.
    expect(screen.getByText(
      "Tradition packs are optional. You can create an invitation without one.",
    )).toBeTruthy();
  });

  it("loads the catalogue on a retry instead of staying broken", async () => {
    api.listSelectableTraditionReleases
      .mockResolvedValueOnce({ data: null, error: "the tradition packs could not be loaded" })
      .mockResolvedValueOnce(ok([option()]));
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Tamil + English foundation")).toBeTruthy());

    expect(api.listSelectableTraditionReleases).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("choosing", () => {
  it("writes a chosen release, re-reads what the wedding now points at, and asks for a new preview", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    chosenAfterWriting(selection());
    mount();
    await waitFor(() => expect(screen.getByText("Tamil + English foundation")).toBeTruthy());

    fireEvent.click(radioOf(/Tamil \+ English foundation/));
    await waitFor(() => expect(chosen).toHaveBeenCalledTimes(1));

    expect(api.selectTraditionRelease).toHaveBeenCalledWith(USER, WEDDING, RELEASE);
    // The mount read, then the read-back after a write that succeeded.
    expect(api.getSelectedTraditionRelease).toHaveBeenNthCalledWith(2, USER, WEDDING);
    await waitFor(() => expect(radioOf(/Tamil \+ English foundation/).checked).toBe(true));
  });

  it("clears through the explicit no-pack call, not by writing an empty string", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection()));
    mount();
    await waitFor(() =>
      expect(screen.getByText("Chosen: Tamil + English foundation, release 1")).toBeTruthy(),
    );

    fireEvent.click(radioOf(/^No tradition pack/));
    await waitFor(() => expect(chosen).toHaveBeenCalledTimes(1));

    expect(api.clearTraditionRelease).toHaveBeenCalledWith(USER, WEDDING);
    expect(api.selectTraditionRelease).not.toHaveBeenCalled();
    expect(screen.queryByText(/Chosen:/)).toBeNull();
  });

  it("leaves the shown choice where it was when the database refuses, and prints only the adapter's phrase", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([
      option(),
      option({ id: OTHER_RELEASE, packDisplayName: "Another pack", releaseNumber: 2 }),
    ]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection()));
    api.selectTraditionRelease.mockResolvedValue({ data: null, error: "that pack could not be chosen" });
    mount();
    await waitFor(() =>
      expect(screen.getByText("Chosen: Tamil + English foundation, release 1")).toBeTruthy(),
    );

    fireEvent.click(radioOf(/Another pack/));
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("that pack could not be chosen");
    // The row the host clicked is not shown as the current one, because it is not the current one.
    expect(radioOf(/Another pack/).checked).toBe(false);
    expect(radioOf(/Tamil \+ English foundation/).checked).toBe(true);
    expect(chosen).not.toHaveBeenCalled();
    // And no read-back: a write that failed has nothing new to re-read, so the panel does not
    // redraw the canvas for a selection the database never made.
    expect(api.getSelectedTraditionRelease).toHaveBeenCalledTimes(1);
  });

  it("disables every row while a choice is being written, and returns them once it lands", async () => {
    const gate = (() => {
      let release!: (value: { data: null; error: null }) => void;
      const promise = new Promise<{ data: null; error: null }>(resolve => { release = resolve; });
      return { promise, release };
    })();
    api.selectTraditionRelease.mockImplementation(() => gate.promise);
    api.listSelectableTraditionReleases.mockResolvedValue(ok([
      option(),
      option({ id: OTHER_RELEASE, packDisplayName: "Another pack", releaseNumber: 2 }),
    ]));
    mount();
    await waitFor(() => expect(screen.getByText("Another pack")).toBeTruthy());

    fireEvent.click(radioOf(/Tamil \+ English foundation/));
    await waitFor(() => expect(screen.getByText("Saving your choice…")).toBeTruthy());

    expect(radioOf(/Another pack/).disabled).toBe(true);
    expect(api.selectTraditionRelease).toHaveBeenCalledTimes(1);

    // The release has to happen inside `act`: the resolution drives three more state updates,
    // and a test that ends with them still in flight would be asserting on a render a host
    // never saw.
    await act(async () => { gate.release({ data: null, error: null }); });
    await waitFor(() => expect(chosen).toHaveBeenCalledTimes(1));

    expect(screen.queryByText("Saving your choice…")).toBeNull();
    expect(radioOf(/Another pack/).disabled).toBe(false);
  });
});

describe("explaining what the choice now means", () => {
  it("names the lines the release supplies and how a host takes them back", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection()));
    mount(["The opening", "The last words"]);
    const note = await screen.findByText(/It supplies the wording for/);

    expect(note.textContent).toContain("The opening, The last words");
    expect(note.textContent).toContain("records those lines as yours, not as the pack's");
    expect(note.textContent).toContain("Clear the field and save, and the pack's line comes back");
  });

  it("says nothing about supplied wording when the host has replaced all of it", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection()));
    mount();
    await waitFor(() => expect(screen.getByText(/Chosen: Tamil/)).toBeTruthy());

    expect(screen.queryByText(/It supplies the wording for/)).toBeNull();
  });

  it("warns that a retired release refuses a new freeze, in words a host can act on", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection({ retired: true })));
    mount();

    const note = await screen.findByText(/has been retired since you chose it/);
    expect(note.textContent).toContain("a new freeze from it is refused until you choose again");
    // The stored lifecycle word is not a host's word.
    expect(spokenText()).not.toContain("deprecated");
  });

  it("says when the definition is written against a format this build does not read", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection({ definitionSchemaVersion: 2 })));
    mount();

    await waitFor(() => expect(
      screen.getByText(/written against a newer definition format than this build reads/),
    ).toBeTruthy());
  });

  it("stays quiet about the format when the release matches this build", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([option()]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection()));
    mount();
    await waitFor(() => expect(screen.getByText(/Chosen: Tamil/)).toBeTruthy());

    expect(screen.queryByText(/definition format/)).toBeNull();
  });
});

describe("what this panel never says", () => {
  it("names no reviewer, no approval and no machine assistance, with a full catalogue mounted", async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([
      option(),
      option({ id: OTHER_RELEASE, packDisplayName: "Second pack", releaseNumber: 3 }),
    ]));
    api.getSelectedTraditionRelease.mockResolvedValueOnce(ok(selection({ retired: true })));
    mount(["The opening"]);
    await waitFor(() => expect(screen.getByText(/Chosen: Tamil/)).toBeTruthy());

    for (const forbidden of [
      "reviewer",
      "reviewed",
      "review label",
      "review basis",
      "review scope",
      "approved",
      "authority",
      "machine",
      "author",
      "source_reference",
      "changelog",
      "definition_schema_version",
      // The machine key, not the display name: a host reads words a person chose, never a slug.
      "tamil-english-foundation",
    ]) {
      expect(spokenText(), forbidden).not.toContain(forbidden);
    }
  });

  it("prints the phrase the adapter chose, exactly, and adds no sentence of its own", async () => {
    // The panel is not a sanitizer — that is the adapter's contract, proved in
    // `traditionReleases.test.ts`. What this pins is that the panel neither wraps the phrase in
    // its own explanation nor shows a second line, so what a host reads is one known sentence.
    api.getSelectedTraditionRelease.mockResolvedValue({
      data: null,
      error: "the tradition pack could not be loaded",
    });
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("the tradition pack could not be loaded");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
