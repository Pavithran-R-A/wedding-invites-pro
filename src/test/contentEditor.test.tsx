// The row editor, tested the way a host uses it: type a name, press Save, read the list back.
//
// The adapter is stubbed here with a store that *remembers* what was written, because the
// behaviour under test is exactly that loop — a saved row has to come back into the list, and
// a refused write has to leave the previous list standing. A stub that answered every write
// with success would prove nothing about the one lie this component must not tell: showing a
// row that the database never kept.
//
// What each stub therefore does not do is re-implement the adapter's rules. Blank names, map
// links and end-before-start times are refused by `weddingContent.ts` and asserted there;
// here a refusal is answered with the phrase that file chooses, and the test is about what the
// screen does with it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  CeremonyDraft,
  CeremonyEntry,
  PersonDraft,
  PersonEntry,
  VenueDraft,
  VenueEntry,
} from "@/integrations/supabase/weddingContent";

const WEDDING = "33333333-3333-4333-8333-333333333333";

const api = vi.hoisted(() => ({
  listPeople: vi.fn(),
  listVenues: vi.fn(),
  listCeremonies: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  removePerson: vi.fn(),
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  removeVenue: vi.fn(),
  createCeremony: vi.fn(),
  updateCeremony: vi.fn(),
  removeCeremony: vi.fn(),
}));

vi.mock("@/integrations/supabase/weddingContent", () => ({
  listPeople: (...a: unknown[]) => api.listPeople(...a),
  listVenues: (...a: unknown[]) => api.listVenues(...a),
  listCeremonies: (...a: unknown[]) => api.listCeremonies(...a),
  createPerson: (...a: unknown[]) => api.createPerson(...a),
  updatePerson: (...a: unknown[]) => api.updatePerson(...a),
  removePerson: (...a: unknown[]) => api.removePerson(...a),
  createVenue: (...a: unknown[]) => api.createVenue(...a),
  updateVenue: (...a: unknown[]) => api.updateVenue(...a),
  removeVenue: (...a: unknown[]) => api.removeVenue(...a),
  createCeremony: (...a: unknown[]) => api.createCeremony(...a),
  updateCeremony: (...a: unknown[]) => api.updateCeremony(...a),
  removeCeremony: (...a: unknown[]) => api.removeCeremony(...a),
}));

import {
  CeremonyGroup,
  ContentNotice,
  PeopleGroup,
  VenueGroup,
  useWeddingContentRows,
} from "@/components/invitation/ContentEditor";

const okList = <T,>(rows: T[]) => ({ data: rows, error: null });
const okWrite = (id?: string) => ({ data: id === undefined ? null : { id }, error: null });
const refused = (error: string) => ({ data: null, error });

const byOrder = (left: { displayOrder: number }, right: { displayOrder: number }) =>
  left.displayOrder - right.displayOrder;

let people: PersonEntry[] = [];
let venues: VenueEntry[] = [];
let ceremonies: CeremonyEntry[] = [];
let nextId = 0;

const seed = () => {
  people = [
    { id: "p1", displayName: "Arun Kumar", roleLabel: "Groom", groupLabel: null, displayOrder: 0 },
    { id: "p2", displayName: "Deepa", roleLabel: null, groupLabel: "Bride's side", displayOrder: 1 },
  ];
  venues = [
    { id: "v1", name: "Sri Kanchi Mahal", addressText: "12 Temple Street", mapUrl: "https://maps.example/kanchi" },
    { id: "v2", name: "Kalyana Mantapa", addressText: null, mapUrl: null },
  ];
  ceremonies = [
    {
      id: "c1",
      displayName: "Muhurtham",
      startsAtLocal: "2026-11-14T07:30:00",
      endsAtLocal: "2026-11-14T09:00:00",
      timezone: "Asia/Kolkata",
      venueId: "v1",
      displayOrder: 0,
      enabled: true,
    },
    {
      id: "c2",
      displayName: "Reception",
      startsAtLocal: "2026-11-14T18:00:00",
      endsAtLocal: null,
      timezone: "Asia/Kolkata",
      venueId: null,
      displayOrder: 1,
      enabled: false,
    },
  ];
  nextId = 0;
};

beforeEach(() => {
  seed();
  Object.values(api).forEach(fn => fn.mockReset());
  api.listPeople.mockImplementation(() => Promise.resolve(okList([...people].sort(byOrder))));
  api.listVenues.mockImplementation(() => Promise.resolve(okList([...venues])));
  api.listCeremonies.mockImplementation(() => Promise.resolve(okList([...ceremonies].sort(byOrder))));
  api.createPerson.mockImplementation((_weddingId: string, draft: PersonDraft) => {
    people.push({
      id: `new-p${nextId++}`,
      displayName: draft.displayName,
      roleLabel: draft.roleLabel === "" ? null : draft.roleLabel,
      groupLabel: draft.groupLabel === "" ? null : draft.groupLabel,
      displayOrder: draft.displayOrder,
    });
    return Promise.resolve(okWrite("new-row"));
  });
  api.updatePerson.mockImplementation((_w: string, id: string, draft: PersonDraft) => {
    const row = people.find(p => p.id === id);
    if (row) {
      row.displayName = draft.displayName;
      row.roleLabel = draft.roleLabel === "" ? null : draft.roleLabel;
      row.groupLabel = draft.groupLabel === "" ? null : draft.groupLabel;
      row.displayOrder = draft.displayOrder;
    }
    return Promise.resolve(okWrite());
  });
  api.removePerson.mockImplementation((_w: string, id: string) => {
    people = people.filter(p => p.id !== id);
    return Promise.resolve(okWrite());
  });
  api.createVenue.mockImplementation((_weddingId: string, draft: VenueDraft) => {
    venues.push({
      id: `new-v${nextId++}`,
      name: draft.name,
      addressText: draft.addressText === "" ? null : draft.addressText,
      mapUrl: draft.mapUrl === "" ? null : draft.mapUrl,
    });
    return Promise.resolve(okWrite("new-row"));
  });
  api.updateVenue.mockImplementation(() => Promise.resolve(okWrite()));
  api.removeVenue.mockImplementation((_w: string, id: string) => {
    venues = venues.filter(v => v.id !== id);
    return Promise.resolve(okWrite());
  });
  api.createCeremony.mockImplementation(() => Promise.resolve(okWrite("new-row")));
  api.updateCeremony.mockImplementation((_w: string, id: string, draft: CeremonyDraft) => {
    const row = ceremonies.find(c => c.id === id);
    if (row) {
      row.displayName = draft.displayName;
      row.startsAtLocal = draft.startsAtLocal;
      row.endsAtLocal = draft.endsAtLocal === "" ? null : draft.endsAtLocal;
      row.venueId = draft.venueId === "none" ? null : draft.venueId;
      row.displayOrder = draft.displayOrder;
      row.enabled = draft.enabled;
    }
    return Promise.resolve(okWrite());
  });
  api.removeCeremony.mockImplementation((_w: string, id: string) => {
    ceremonies = ceremonies.filter(c => c.id !== id);
    return Promise.resolve(okWrite());
  });
});

/** The three groups in the platform's own order, over one copy of the row state.
 *
 *  Stage 5 split this file's former subject: `ContentEditor` was one component that owned all
 *  three lists, and a release whose declaration interleaves prose with lists needs the lists
 *  apart (§19). The behaviour under test did not change — one hook, three views over it, one
 *  notice for the wedding — so this file keeps every assertion it had and mounts the pieces the
 *  way a page does. `authoringOutline.test.tsx` is where the ordered mount is proven. */
const RowEditor = ({
  weddingId,
  onContentChanged,
}: {
  weddingId: string;
  onContentChanged: () => void;
}) => {
  const rows = useWeddingContentRows({ weddingId, onContentChanged });
  return (
    <>
      <ContentNotice notice={rows.notice} />
      <PeopleGroup rows={rows} />
      <VenueGroup rows={rows} />
      <CeremonyGroup rows={rows} />
    </>
  );
};

const openEditor = async () => {
  const onContentChanged = vi.fn();
  const result = render(<RowEditor weddingId={WEDDING} onContentChanged={onContentChanged} />);
  await waitFor(() => expect(screen.getByText("Arun Kumar")).toBeInTheDocument());
  return { ...result, onContentChanged };
};

/** One field of one stored row: every row repeats its label, so the row's id in the field's
 *  own id is what makes the query unambiguous. */
const fieldOf = (rowId: string, label: RegExp): HTMLElement => {
  const found = screen.getAllByLabelText(label).filter(el => el.id.includes(`-${rowId}-`));
  if (found.length !== 1) throw new Error(`expected one "${label}" field for row ${rowId}, got ${found.length}`);
  return found[0];
};

const addField = (kind: "person" | "venue" | "ceremony", label: RegExp): HTMLElement => {
  const found = screen.getAllByLabelText(label).filter(el => el.id.includes(`-new-${kind}-`));
  if (found.length !== 1) throw new Error(`expected one "${label}" field in the ${kind} form, got ${found.length}`);
  return found[0];
};

const rowActions = (rowId: string) => within(fieldOf(rowId, /name$/i).closest("fieldset") as HTMLElement);

describe("what the row lists show", () => {
  it("lists this wedding's people, venues and ceremonies, and no machine key", async () => {
    const { container } = await openEditor();
    expect(container.textContent).toContain("Arun Kumar");
    expect(container.textContent).toContain("Sri Kanchi Mahal");
    expect(container.textContent).toContain("Muhurtham");
    // The columns `HOST_DEFINED_KEY` fills in exist; a guest and this screen never read them.
    expect(container.textContent).not.toContain("host_defined");
    expect(container.textContent).not.toContain("role_key");
    expect(api.listPeople).toHaveBeenCalledWith(WEDDING);
    expect(api.listVenues).toHaveBeenCalledWith(WEDDING);
    expect(api.listCeremonies).toHaveBeenCalledWith(WEDDING);
  });

  it("orders people by the position the host chose, not by the order they were added", async () => {
    const { container } = await openEditor();
    const names = container.querySelectorAll("fieldset legend");
    expect(Array.from(names).slice(0, 2).map(el => el.textContent)).toEqual(["Arun Kumar", "Deepa"]);
  });

  it("lists a person whose role the host left out by name alone", async () => {
    await openEditor();
    // `p2` has `role_label: null`, and `role_key` is not a word the screen is allowed to
    // borrow for her.
    expect(within(fieldOf("p2", /^Name$/i).closest("fieldset") as HTMLElement).getByLabelText(/^Role/)).toHaveValue("");
  });
});

describe("adding a row", () => {
  it("sends the words the host typed and lists the row without another visit", async () => {
    const { onContentChanged } = await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    fireEvent.change(addField("person", /^Name$/i), { target: { value: "Kuyil Rani" } });
    fireEvent.change(addField("person", /^Role/), { target: { value: "Mother" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to invitation" }));
    await waitFor(() => expect(api.createPerson).toHaveBeenCalled());
    expect(api.createPerson).toHaveBeenCalledWith(WEDDING, {
      displayName: "Kuyil Rani",
      roleLabel: "Mother",
      groupLabel: "",
      displayOrder: 2,
    });
    await waitFor(() => expect(screen.getByText("Kuyil Rani")).toBeInTheDocument());
    expect(onContentChanged).toHaveBeenCalled();
    // The form closes, so the next "Add" starts from nothing rather than from her name.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("keeps the list and says the adapter's own sentence when the write is refused", async () => {
    api.createVenue.mockImplementationOnce(() =>
      Promise.resolve(refused("the map link must be a full https:// address, with no spaces")),
    );
    const { onContentChanged } = await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a venue" }));
    fireEvent.change(addField("venue", /^Venue name$/i), { target: { value: "Temple Hall" } });
    fireEvent.change(addField("venue", /^Map link/), { target: { value: "https://maps.example half pasted" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to invitation" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("the map link must be a full https:// address, with no spaces");
    // Refused means refused: no row appears, and the guest's document is not re-read.
    expect(screen.queryByText("Temple Hall")).toBeNull();
    expect(onContentChanged).not.toHaveBeenCalled();
    // The form stays open with the typing in it, because the host has a link to fix.
    expect(addField("venue", /^Venue name$/i)).toHaveValue("Temple Hall");
  });

  it("never claims a row was added when the store did not take it", async () => {
    api.createPerson.mockImplementationOnce(() => Promise.resolve(refused("the name could not be added")));
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    fireEvent.change(addField("person", /^Name$/i), { target: { value: "Thambi" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to invitation" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Thambi")).toBeNull();
    expect(people).toHaveLength(2);
  });
});

describe("editing a stored row", () => {
  it("holds Save back until the host changes something, then writes only that row", async () => {
    await openEditor();
    expect(rowActions("p1").getByRole("button", { name: "Save row" })).toBeDisabled();
    fireEvent.change(fieldOf("p1", /^Name$/i), { target: { value: "Arun Kumar Srinivasan" } });
    fireEvent.click(rowActions("p1").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalled());
    expect(api.updatePerson).toHaveBeenCalledWith(WEDDING, "p1", {
      displayName: "Arun Kumar Srinivasan",
      roleLabel: "Groom",
      groupLabel: "",
      displayOrder: 0,
    });
    await waitFor(() => expect(screen.getByText("Arun Kumar Srinivasan")).toBeInTheDocument());
    expect(rowActions("p1").getByRole("button", { name: "Save row" })).toBeDisabled();
  });

  it("keeps the last list the database agreed to when a save changes no row", async () => {
    api.updatePerson.mockImplementationOnce(() => Promise.resolve(refused("the name could not be saved")));
    const { container } = await openEditor();
    fireEvent.change(fieldOf("p1", /^Name$/i), { target: { value: "Someone else" } });
    fireEvent.click(rowActions("p1").getByRole("button", { name: "Save row" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("the name could not be saved");
    expect(container.textContent).toContain("Arun Kumar");
    expect(fieldOf("p1", /^Name$/i)).toHaveValue("Someone else");
    expect(people.find(p => p.id === "p1")?.displayName).toBe("Arun Kumar");
  });

  it("keeps one row's typing through another row's save", async () => {
    await openEditor();
    fireEvent.change(fieldOf("p1", /^Role/i), { target: { value: "Elder son" } });
    fireEvent.change(fieldOf("p2", /^Name$/i), { target: { value: "Deepa Lakshmi" } });
    fireEvent.click(rowActions("p2").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(screen.getByText("Deepa Lakshmi")).toBeInTheDocument());
    expect(fieldOf("p1", /^Role/i)).toHaveValue("Elder son");
    expect(rowActions("p1").getByRole("button", { name: "Save row" })).toBeEnabled();
  });

  it("sends the position the host set, so the guest's reading order is the one on screen", async () => {
    const { container } = await openEditor();
    fireEvent.change(fieldOf("p2", /^Order/), { target: { value: "0" } });
    fireEvent.change(fieldOf("p1", /^Order/), { target: { value: "1" } });
    fireEvent.click(rowActions("p2").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalled());
    expect(api.updatePerson.mock.calls[0][2].displayOrder).toBe(0);
    fireEvent.click(rowActions("p1").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalledTimes(2));
    expect(api.updatePerson.mock.calls[1][2].displayOrder).toBe(1);
    await waitFor(() => expect(container.querySelector("fieldset legend")?.textContent).toBe("Deepa"));
  });

  it("removes a row and leaves it out of the list", async () => {
    const { container } = await openEditor();
    fireEvent.click(rowActions("p2").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removePerson).toHaveBeenCalledWith(WEDDING, "p2"));
    await waitFor(() => expect(screen.queryByText("Deepa")).toBeNull());
    expect(container.textContent).toContain("Arun Kumar");
  });

  it("treats an emptied position as the start of the list, not as nothing", async () => {
    await openEditor();
    fireEvent.change(fieldOf("p2", /^Order/), { target: { value: "" } });
    expect(fieldOf("p2", /^Order/)).toHaveValue(0);
  });
});

describe("venues and the ceremonies that use them", () => {
  it("offers a ceremony only this wedding's venues", async () => {
    await openEditor();
    const select = fieldOf("c1", /^Venue$/i) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual([
      "No venue",
      "Sri Kanchi Mahal",
      "Kalyana Mantapa",
    ]);
    expect(select.value).toBe("v1");
  });

  it("moves a ceremony to another venue and clears it to none", async () => {
    await openEditor();
    fireEvent.change(fieldOf("c1", /^Venue$/i), { target: { value: "v2" } });
    fireEvent.click(rowActions("c1").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updateCeremony).toHaveBeenCalled());
    expect(api.updateCeremony.mock.calls[0][2].venueId).toBe("v2");
    fireEvent.change(fieldOf("c1", /^Venue$/i), { target: { value: "none" } });
    fireEvent.click(rowActions("c1").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updateCeremony).toHaveBeenCalledTimes(2));
    expect(api.updateCeremony.mock.calls[1][2].venueId).toBe("");
  });

  it("keeps the stored seconds out of the field and puts them back on the way in", async () => {
    await openEditor();
    // `datetime-local` reads `2026-11-14T07:30`, the column stores `...T07:30:00`.
    expect(fieldOf("c1", /^Starts/)).toHaveValue("2026-11-14T07:30");
    fireEvent.change(fieldOf("c1", /^Starts/), { target: { value: "2026-11-14T08:15" } });
    fireEvent.click(rowActions("c1").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updateCeremony).toHaveBeenCalled());
    expect(api.updateCeremony.mock.calls[0][2].startsAtLocal).toBe("2026-11-14T08:15:00");
  });

  it("shows a venue a ceremony still uses as an instruction, not as a constraint", async () => {
    api.removeVenue.mockImplementationOnce(() =>
      Promise.resolve(refused("a ceremony still uses this venue, so it cannot be removed")),
    );
    const { container } = await openEditor();
    fireEvent.click(rowActions("v1").getByRole("button", { name: "Remove venue" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("a ceremony still uses this venue, so it cannot be removed");
    expect(container.textContent).not.toMatch(/23503|foreign key|wedding_events|constraint/i);
    expect(container.textContent).toContain("Sri Kanchi Mahal");
  });

  it("removes a venue nothing uses, and takes it out of the ceremony choices", async () => {
    await openEditor();
    fireEvent.click(rowActions("v2").getByRole("button", { name: "Remove venue" }));
    await waitFor(() => expect(api.removeVenue).toHaveBeenCalledWith(WEDDING, "v2"));
    await waitFor(() => expect(screen.queryByText("Kalyana Mantapa")).toBeNull());
    const select = fieldOf("c1", /^Venue$/i) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(["No venue", "Sri Kanchi Mahal"]);
  });
});

describe("the ceremony switch a guest's document obeys", () => {
  it("unchecking it writes enabled: false and leaves the row on screen", async () => {
    const { container } = await openEditor();
    const checkbox = fieldOf("c1", /^Show this ceremony/);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(rowActions("c1").getByRole("button", { name: "Save row" })).toBeEnabled();
    fireEvent.click(rowActions("c1").getByRole("button", { name: "Save row" }));
    await waitFor(() => expect(api.updateCeremony).toHaveBeenCalled());
    expect(api.updateCeremony.mock.calls[0][2].enabled).toBe(false);
    expect(container.textContent).toContain("Muhurtham");
  });

  it("lists a ceremony the host switched off, because it is theirs to turn back on", async () => {
    const { container } = await openEditor();
    expect(container.textContent).toContain("Reception");
    expect(fieldOf("c2", /^Show this ceremony/)).not.toBeChecked();
  });
});
