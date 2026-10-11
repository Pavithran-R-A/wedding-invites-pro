// Stage 3 closure repair §2: the contract for the rows a guest reads as facts.
//
// `weddingQueries.test.tsx` covers the wedding itself; this file covers `wedding_people`,
// `venues` and `wedding_events` — the three lists a frozen version is built from, and the
// ones a host can now add to, reorder and remove through the product.
//
// What is at stake here is one specific lie: a write that changed nothing must not be
// reported as saved. An RLS policy that does not match the caller answers an UPDATE or a
// DELETE with *no rows and no error*, so an adapter that only checks `error` would tell a
// host their grandmother's name was saved when the database touched no row at all. Every
// write below is asserted to re-read the affected row, and every zero-row answer is
// asserted to come back as a failure.
//
// Whether Postgres would have answered at all is qualified by supabase/tests/stage2/ and
// supabase/tests/api/; nothing here claims to prove RLS, only what the client asks for and
// what it does with the answer.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  databaseError,
  emptyResult,
  payloadOf,
  planQueries,
  queriedTables,
  recordedSteps,
  rowReturned,
  stepsFor,
} from "@/test/fakeSupabase";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { supabase: fakeSupabase };
});

import {
  createCeremony,
  createPerson,
  createVenue,
  listCeremonies,
  listPeople,
  listVenues,
  removeCeremony,
  removePerson,
  removeVenue,
  updateCeremony,
  updatePerson,
  updateVenue,
  type CeremonyDraft,
  type PersonDraft,
  type VenueDraft,
} from "@/integrations/supabase/weddingContent";

const WEDDING = "33333333-3333-4333-8333-333333333333";
const PERSON = "55555555-5555-4555-8555-555555555555";
const VENUE = "66666666-6666-4666-8666-666666666666";
const CEREMONY = "77777777-7777-4777-8777-777777777777";

const personDraft = (overrides: Partial<PersonDraft> = {}): PersonDraft => ({
  displayName: "Kuyil Rani",
  roleLabel: "Mother",
  groupLabel: "Mother's side",
  displayOrder: 2,
  ...overrides,
});

const venueDraft = (overrides: Partial<VenueDraft> = {}): VenueDraft => ({
  name: "Sri Kanchi Mahal",
  addressText: "12 Temple Street\nKanchipuram",
  mapUrl: "https://maps.example/sri-kanchi-mahal",
  ...overrides,
});

const ceremonyDraft = (overrides: Partial<CeremonyDraft> = {}): CeremonyDraft => ({
  displayName: "Muhurtham",
  startsAtLocal: "2026-11-14T07:30:00",
  endsAtLocal: "2026-11-14T09:00:00",
  timezone: "Asia/Kolkata",
  venueId: VENUE,
  displayOrder: 0,
  enabled: true,
  ...overrides,
});

const methodsOn = (table: string): string[] =>
  stepsFor(table).map(step => step.method);

const argsOn = (table: string, method: string): readonly unknown[] =>
  stepsFor(table).find(step => step.method === method)?.args ?? [];

const equals = (left: readonly unknown[], right: readonly unknown[]) =>
  JSON.stringify(left) === JSON.stringify(right);

/** The filters a write was scoped by, in the order they were applied. */
const scopesOf = (table: string): unknown[][] =>
  stepsFor(table).filter(step => step.method === "eq").map(step => step.args as unknown[]);

beforeEach(() => {
  planQueries({});
});

describe("the reads", () => {
  it("names only the three canonical tables, in the order the snapshot uses", async () => {
    planQueries({
      wedding_people: [rowReturned([])],
      venues: [rowReturned([])],
      wedding_events: [rowReturned([])],
    });
    await Promise.all([listPeople(WEDDING), listVenues(WEDDING), listCeremonies(WEDDING)]);
    expect(queriedTables()).toEqual(["wedding_people", "venues", "wedding_events"]);
    // The editor's list order is the guest's reading order, which is the snapshot's
    // `display_order, created_at, id` and `display_order, starts_at_local, id`.
    expect(methodsOn("wedding_people")).toEqual([
      "from", "select", "eq", "order", "order", "order",
    ]);
    expect(stepsFor("wedding_people").filter(s => s.method === "order").map(s => s.args[0]))
      .toEqual(["display_order", "created_at", "id"]);
    expect(stepsFor("wedding_events").filter(s => s.method === "order").map(s => s.args[0]))
      .toEqual(["display_order", "starts_at_local", "id"]);
  });

  it("projects the columns the editor shows and nothing else", async () => {
    planQueries({
      wedding_people: [rowReturned([])],
      venues: [rowReturned([])],
      wedding_events: [rowReturned([])],
    });
    await Promise.all([listPeople(WEDDING), listVenues(WEDDING), listCeremonies(WEDDING)]);
    expect(argsOn("wedding_people", "select")).toEqual([
      "id, display_name, role_label, group_label, display_order",
    ]);
    expect(argsOn("venues", "select")).toEqual(["id, name, address_text, map_url"]);
    expect(argsOn("wedding_events", "select")).toEqual([
      "id, display_name, starts_at_local, ends_at_local, timezone, venue_id, display_order, enabled",
    ]);
    // `notes` on a venue or an event is host-internal by its own column history, and no
    // read here asks for it, so it cannot reach a form and then a guest by accident.
    for (const columns of ["notes", "created_at"]) expect(String(argsOn("venues", "select"))).not.toContain(columns);
  });

  it("maps a row to the shape the editor binds to", async () => {
    planQueries({
      wedding_people: [
        rowReturned([
          { id: PERSON, display_name: "Arun Kumar", role_label: null, group_label: null, display_order: 0 },
        ]),
      ],
    });
    const result = await listPeople(WEDDING);
    expect(result.data).toEqual([
      { id: PERSON, displayName: "Arun Kumar", roleLabel: null, groupLabel: null, displayOrder: 0 },
    ]);
    // A nullable column stays nullable: "" would be a word the host did not write.
    expect(result.data?.[0].roleLabel).toBeNull();
  });

  it("reads somebody else's wedding as an empty list, not as a failure", async () => {
    // The exact shape RLS produces: no error, no rows.
    planQueries({ wedding_people: [rowReturned([])], venues: [rowReturned([])], wedding_events: [rowReturned([])] });
    await expect(listPeople(WEDDING)).resolves.toEqual({ data: [], error: null });
    await expect(listVenues(WEDDING)).resolves.toEqual({ data: [], error: null });
    await expect(listCeremonies(WEDDING)).resolves.toEqual({ data: [], error: null });
  });

  it("reports a read that cannot be made, in its own words", async () => {
    planQueries({ wedding_people: [databaseError("permission denied for table wedding_people")] });
    const result = await listPeople(WEDDING);
    expect(result.error).toBe("the names could not be loaded");
    expect(result.error ?? "").not.toMatch(/permission denied|wedding_people|policy/);
  });
});

describe("people", () => {
  it("adds a person under the placeholder key, never a role it guessed", async () => {
    planQueries({ wedding_people: [rowReturned([{ id: PERSON }])] });
    const result = await createPerson(WEDDING, personDraft());
    expect(result.data).toEqual({ id: PERSON });
    const payload = payloadOf("wedding_people", "insert");
    expect(payload).toEqual({
      wedding_id: WEDDING,
      role_key: "host_defined",
      display_name: "Kuyil Rani",
      role_label: "Mother",
      group_label: "Mother's side",
      display_order: 2,
    });
    // A group the host named in words needs no machine key: the column stays NULL, so no
    // invented vocabulary can reach the projection.
    expect(payload).not.toHaveProperty("group_key");
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("created_at");
  });

  it("turns an empty optional field into NULL rather than an empty word", async () => {
    planQueries({ wedding_people: [rowReturned([{ id: PERSON }])] });
    await createPerson(WEDDING, personDraft({ roleLabel: "   ", groupLabel: "" }));
    expect(payloadOf("wedding_people", "insert")).toMatchObject({ role_label: null, group_label: null });
  });

  it("refuses a person with no name before spending a request", async () => {
    const before = recordedSteps().length;
    const result = await createPerson(WEDDING, personDraft({ displayName: "  " }));
    expect(result.error).toBe("a name is needed before this can be saved");
    expect(recordedSteps().length).toBe(before);
    planQueries({ wedding_people: [rowReturned([{ id: PERSON }])] });
    const update = await updatePerson(WEDDING, PERSON, personDraft({ displayName: "" }));
    expect(update.error).toBe("a name is needed before this can be saved");
  });

  it("scopes an edit to the row and to the wedding, and asks which row it changed", async () => {
    planQueries({ wedding_people: [rowReturned([{ id: PERSON }])] });
    await updatePerson(WEDDING, PERSON, personDraft({ displayOrder: 7 }));
    expect(payloadOf("wedding_people", "update")).toEqual({
      display_name: "Kuyil Rani",
      role_label: "Mother",
      group_label: "Mother's side",
      display_order: 7,
    });
    expect(scopesOf("wedding_people")).toEqual([["id", PERSON], ["wedding_id", WEDDING]]);
    expect(methodsOn("wedding_people")).toEqual(["from", "update", "eq", "eq", "select"]);
    expect(argsOn("wedding_people", "select")).toEqual(["id"]);
  });

  it("calls a zero-row update a failure, because that is what a policy answers with", async () => {
    planQueries({ wedding_people: [rowReturned([])] });
    const result = await updatePerson(WEDDING, PERSON, personDraft());
    expect(result).toEqual({ data: null, error: "the name could not be saved" });

    planQueries({ wedding_people: [rowReturned([])] });
    await expect(removePerson(WEDDING, PERSON)).resolves.toEqual({
      data: null,
      error: "the name could not be removed",
    });

    planQueries({ wedding_people: [rowReturned([])] });
    await expect(createPerson(WEDDING, personDraft())).resolves.toEqual({
      data: null,
      error: "the name could not be added",
    });
  });

  it("never sends an identity column a server owns", async () => {
    planQueries({ wedding_people: [rowReturned([{ id: PERSON }])] });
    await createPerson(WEDDING, personDraft());
    expect(methodsOn("wedding_people")).toEqual(["from", "insert", "select"]);
    const payload = payloadOf("wedding_people", "insert");
    for (const owned of ["id", "created_at", "updated_at"]) expect(payload).not.toHaveProperty(owned);
  });
});

describe("venues", () => {
  it("stores an https map link and refuses anything else before writing", async () => {
    planQueries({ venues: [rowReturned([{ id: VENUE }])] });
    const result = await createVenue(WEDDING, venueDraft());
    expect(result.data).toEqual({ id: VENUE });
    expect(payloadOf("venues", "insert")).toEqual({
      wedding_id: WEDDING,
      name: "Sri Kanchi Mahal",
      address_text: "12 Temple Street\nKanchipuram",
      map_url: "https://maps.example/sri-kanchi-mahal",
    });

    const before = recordedSteps().length;
    for (const link of ["http://maps.example/x", "maps.example/x", "https://two words.example"]) {
      const refused = await createVenue(WEDDING, venueDraft({ mapUrl: link }));
      expect(refused.error).toBe("the map link must be a full https:// address, with no spaces");
    }
    expect(recordedSteps().length).toBe(before);
  });

  it("keeps a line break in an address and sends no coordinates", async () => {
    planQueries({ venues: [rowReturned([{ id: VENUE }])] });
    await createVenue(WEDDING, venueDraft());
    const payload = payloadOf("venues", "insert");
    expect(String(payload.address_text)).toContain("\n");
    // This build runs no geocoder, so a lat/long pair would be a value we invented.
    expect(payload).not.toHaveProperty("latitude");
    expect(payload).not.toHaveProperty("longitude");
  });

  it("reports a venue another wedding's ceremony still uses as an instruction", async () => {
    planQueries({
      venues: [databaseError('violates foreign key constraint "wedding_events_wedding_id_venue_id_fkey"', "23503")],
    });
    const result = await removeVenue(WEDDING, VENUE);
    expect(result).toEqual({ data: null, error: "a ceremony still uses this venue, so it cannot be removed" });
    expect(result.error ?? "").not.toMatch(/foreign key|wedding_events|constraint|23503/);
  });

  it("keeps every other removal failure generic", async () => {
    planQueries({ venues: [databaseError("permission denied for table venues")] });
    await expect(removeVenue(WEDDING, VENUE)).resolves.toEqual({
      data: null,
      error: "the venue could not be removed",
    });
    planQueries({ venues: [rowReturned([])] });
    await expect(removeVenue(WEDDING, VENUE)).resolves.toEqual({
      data: null,
      error: "the venue could not be removed",
    });
  });

  it("edits a venue inside its own wedding only", async () => {
    planQueries({ venues: [rowReturned([{ id: VENUE }])] });
    await updateVenue(WEDDING, VENUE, venueDraft({ mapUrl: " " }));
    expect(payloadOf("venues", "update")).toMatchObject({ map_url: null });
    expect(scopesOf("venues")).toEqual([["id", VENUE], ["wedding_id", WEDDING]]);
  });
});

describe("ceremonies", () => {
  it("adds a ceremony the database can order, with a placeholder key", async () => {
    planQueries({ wedding_events: [rowReturned([{ id: CEREMONY }])] });
    const result = await createCeremony(WEDDING, ceremonyDraft());
    expect(result.data).toEqual({ id: CEREMONY });
    expect(payloadOf("wedding_events", "insert")).toEqual({
      wedding_id: WEDDING,
      event_key: "host_defined",
      display_name: "Muhurtham",
      starts_at_local: "2026-11-14T07:30:00",
      ends_at_local: "2026-11-14T09:00:00",
      venue_id: VENUE,
      display_order: 0,
      enabled: true,
      timezone: "Asia/Kolkata",
    });
  });

  it("leaves the time zone to the column's own default when the host wrote nothing", async () => {
    planQueries({ wedding_events: [rowReturned([{ id: CEREMONY }])] });
    await createCeremony(WEDDING, ceremonyDraft({ timezone: "  " }));
    expect(payloadOf("wedding_events", "insert")).not.toHaveProperty("timezone");

    // On an update the same empty field means "keep what is stored" — sending NULL would hit
    // the NOT NULL column, and sending a guess would overwrite the host's own words.
    planQueries({ wedding_events: [rowReturned([{ id: CEREMONY }])] });
    await updateCeremony(WEDDING, CEREMONY, ceremonyDraft({ timezone: "" }));
    expect(payloadOf("wedding_events", "update")).not.toHaveProperty("timezone");
    expect(payloadOf("wedding_events", "update")).toMatchObject({ display_name: "Muhurtham" });
  });

  it("sends no venue for the no-venue choice", async () => {
    planQueries({ wedding_events: [rowReturned([{ id: CEREMONY }])] });
    await createCeremony(WEDDING, ceremonyDraft({ venueId: "" }));
    expect(payloadOf("wedding_events", "insert")).toMatchObject({ venue_id: null });
  });

  it("refuses an unfinished or impossible time before writing", async () => {
    const before = recordedSteps().length;
    await expect(createCeremony(WEDDING, ceremonyDraft({ displayName: " " }))).resolves.toEqual({
      data: null,
      error: "a name is needed before this can be saved",
    });
    await expect(createCeremony(WEDDING, ceremonyDraft({ startsAtLocal: "" }))).resolves.toEqual({
      data: null,
      error: "a start date and time is needed before this can be saved",
    });
    await expect(createCeremony(WEDDING, ceremonyDraft({ endsAtLocal: "2026-11-14T06:00:00" }))).resolves.toEqual({
      data: null,
      error: "the end time has to be after the start time",
    });
    // An end before a start is the CHECK `ends_at_local > starts_at_local` refusing; saying
    // it here is what keeps that constraint's sentence out of the host's browser.
    expect(recordedSteps().length).toBe(before);
  });

  it("keeps a ceremony a host switched off in the list, out of the guest's document", async () => {
    planQueries({ wedding_events: [rowReturned([{ id: CEREMONY }])] });
    await updateCeremony(WEDDING, CEREMONY, ceremonyDraft({ enabled: false }));
    expect(payloadOf("wedding_events", "update")).toMatchObject({ enabled: false });
    // The projection's own `WHERE ... AND e.enabled` is what hides it from a guest, and
    // supabase/tests/stage3/30_publication.sql is where that is qualified over Postgres.
  });

  it("reports a ceremony a household is still invited to as an instruction, not a constraint", async () => {
    planQueries({
      wedding_events: [
        databaseError(
          'update or delete on table "wedding_events" violates foreign key constraint "household_event_scopes_wedding_id_event_id_fkey" on table "household_event_scopes"',
          "23503",
        ),
      ],
    });
    const result = await removeCeremony(WEDDING, CEREMONY);
    // The one referrer of `wedding_events(wedding_id, id)` is the household's scope key
    // (`20260925120300_stage2_guests_approvals_rsvp.sql:57`), and Stage 8 makes it reachable from the
    // host's own screen: a family with a link and an answer is holding the ceremony. The sentence has
    // to say whose removal the host owes, because "delete the ceremony" is the control that just failed.
    expect(result).toEqual({
      data: null,
      error: "families are still invited to this ceremony, and any answer they gave is kept with it, so it cannot be removed",
    });
    expect(result.error ?? "").not.toMatch(/foreign key|household_event_scopes|rsvp_responses|constraint|23503/);
  });

  it("keeps every other ceremony removal failure generic", async () => {
    planQueries({ wedding_events: [databaseError("permission denied for table wedding_events", "42501")] });
    await expect(removeCeremony(WEDDING, CEREMONY)).resolves.toEqual({
      data: null,
      error: "the ceremony could not be removed",
    });
  });

  it("reports a ceremony that changed no row as unsaved", async () => {
    planQueries({ wedding_events: [emptyResult(), rowReturned([]), rowReturned([])] });
    await expect(updateCeremony(WEDDING, CEREMONY, ceremonyDraft())).resolves.toEqual({
      data: null,
      error: "the ceremony could not be saved",
    });
    await expect(removeCeremony(WEDDING, CEREMONY)).resolves.toEqual({
      data: null,
      error: "the ceremony could not be removed",
    });
    await expect(createCeremony(WEDDING, ceremonyDraft())).resolves.toEqual({
      data: null,
      error: "the ceremony could not be added",
    });
  });

  it("reads a stored ceremony's whole shape, including a null end and a null venue", async () => {
    planQueries({
      wedding_events: [
        rowReturned([
          {
            id: CEREMONY,
            display_name: "Reception",
            starts_at_local: "2026-11-15T18:00:00",
            ends_at_local: null,
            timezone: "Asia/Colombo",
            venue_id: null,
            display_order: 3,
            enabled: false,
          },
        ]),
      ],
    });
    const result = await listCeremonies(WEDDING);
    expect(result.data).toEqual([
      {
        id: CEREMONY,
        displayName: "Reception",
        startsAtLocal: "2026-11-15T18:00:00",
        endsAtLocal: null,
        timezone: "Asia/Colombo",
        venueId: null,
        displayOrder: 3,
        enabled: false,
      },
    ]);
    expect(equals([], [])).toBe(true);
  });
});
