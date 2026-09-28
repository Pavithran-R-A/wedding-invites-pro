// Stage 4 §9: the client half of the tradition-pack contract, tested without a network.
//
// The database decides what a caller may read and write; what this file pins is what the
// browser *asks for*, because an unanswered question leaks nothing. Three properties matter
// here and none of them is visible in the UI: the columns that cross the wire, the single
// field a customer may write, and the fact that a refusal arrives as this project's own
// phrase rather than Postgres's description of its policies.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  planQueries,
  payloadOf,
  queriedTables,
  recordedSteps,
  rowReturned,
  emptyResult,
  databaseError,
} from "@/test/fakeSupabase";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { supabase: fakeSupabase };
});

import {
  clearTraditionRelease,
  getSelectedTraditionRelease,
  listSelectableTraditionReleases,
  selectTraditionRelease,
} from "@/integrations/supabase/traditionReleases";

type ReleaseRow = Database["public"]["Tables"]["tradition_pack_releases"]["Row"];
type PackRow = Database["public"]["Tables"]["tradition_packs"]["Row"];
type WeddingRow = Database["public"]["Tables"]["weddings"]["Row"];

const USER = "11111111-1111-4111-8111-111111111111";
const WEDDING = "33333333-3333-4333-8333-333333333333";
const PACK = "44444444-4444-4444-8444-444444444444";
const RELEASE = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";

const packRow = (overrides: Partial<PackRow> = {}): PackRow => ({
  id: PACK,
  pack_key: "tamil-english-foundation",
  display_name: "Tamil + English foundation",
  scope_statement: "Structural wording sections only; no ritual instruction.",
  created_at: "2026-09-27T09:00:00+00:00",
  updated_at: "2026-09-27T09:00:00+00:00",
  ...overrides,
});

const releaseRow = (overrides: Partial<ReleaseRow> = {}): ReleaseRow => ({
  id: RELEASE,
  pack_id: PACK,
  release_number: 1,
  languages: ["ta", "en"],
  status: "approved",
  definition: { sections: [] },
  definition_schema_version: 1,
  reviewed_by: null,
  reviewed_at: null,
  reviewed_languages: null,
  review_label: null,
  review_basis: null,
  review_scope: null,
  approved_at: "2026-09-27T09:00:00+00:00",
  deprecated_at: null,
  author_label: "Automated draft candidate assembly",
  machine_assisted: true,
  machine_assistance_notes: "Assembled from the machine-readable draft candidate.",
  source_reference: "content/tradition-packs/tamil-english-foundation.v1.json",
  changelog: null,
  created_at: "2026-09-27T09:00:00+00:00",
  updated_at: "2026-09-27T09:00:00+00:00",
  ...overrides,
});

/** Only the columns the adapter is allowed to ask for; a full row here would let an
 *  over-wide `select()` pass by supplying the extra column silently. */
const weddingSelection = (
  releaseId: string | null,
): Pick<WeddingRow, "id" | "tradition_pack_release_id"> => ({
  id: WEDDING,
  tradition_pack_release_id: releaseId,
});

/** Every column list this run sent to the server, as individual names. */
const selectedColumns = (): string[] =>
  recordedSteps()
    .filter((step) => step.method === "select")
    .flatMap((step) => (step.args[0] as string).split(",").map((name) => name.trim()));

/** Columns this layer must never ask the server for: review provenance (`review_*`),
 *  machine-disclosure fields (`author_label`, `machine_assisted`,
 *  `machine_assistance_notes`, `source_reference`, `changelog`), the lifecycle timestamps
 *  (`approved_at`, `deprecated_at`) and the row bookkeeping (`created_at`, `updated_at`)
 *  that no screen in this stage reads. §9 forbids exposing maintenance fields, and a query
 *  that does not name them is stronger evidence than a UI that hides them. */
const NEVER_SELECTED = [
  "review_label",
  "review_basis",
  "review_scope",
  "reviewed_by",
  "reviewed_at",
  "reviewed_languages",
  "approved_at",
  "deprecated_at",
  "author_label",
  "machine_assisted",
  "machine_assistance_notes",
  "source_reference",
  "changelog",
  "created_at",
  "updated_at",
];

/** The maintenance names present in a column list — the assertion, and the thing the control
 *  below proves can be non-empty. */
const maintenanceIn = (columns: string[]): string[] =>
  columns.filter((name) => NEVER_SELECTED.includes(name));

const warningLines = vi.hoisted(() => [] as string[]);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warningLines.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  warningLines.length = 0;
});

describe("listSelectableTraditionReleases", () => {
  it("asks for approved releases and shapes them for the picker", async () => {
    planQueries({
      tradition_packs: [rowReturned([packRow()])],
      tradition_pack_releases: [rowReturned([releaseRow()])],
    });

    const result = await listSelectableTraditionReleases();

    expect(queriedTables()).toEqual(["tradition_packs", "tradition_pack_releases"]);
    const onReleases = recordedSteps()
      .filter((step) => step.table === "tradition_pack_releases")
      .map((step) => step.method);
    expect(onReleases).toEqual(["from", "select", "eq", "order"]);
    const statusFilter = recordedSteps().find(
      (step) => step.table === "tradition_pack_releases" && step.method === "eq",
    );
    expect(statusFilter?.args).toEqual(["status", "approved"]);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: RELEASE,
        packKey: "tamil-english-foundation",
        packDisplayName: "Tamil + English foundation",
        scopeStatement: "Structural wording sections only; no ritual instruction.",
        releaseNumber: 1,
        languages: ["ta", "en"],
      },
    ]);
  });

  it("drops a release whose pack did not come back rather than showing it unnamed", async () => {
    planQueries({
      tradition_packs: [rowReturned([packRow({ id: "88888888-8888-4888-8888-888888888888" })])],
      tradition_pack_releases: [rowReturned([releaseRow()])],
    });

    const result = await listSelectableTraditionReleases();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("names no maintenance or provenance column in any query it sends", async () => {
    planQueries({
      tradition_packs: [rowReturned([packRow()])],
      tradition_pack_releases: [rowReturned([releaseRow()])],
    });
    await listSelectableTraditionReleases();

    expect(maintenanceIn(selectedColumns())).toEqual([]);
    // Control: the same check refuses a list that asks for review provenance. Without this
    // line the assertion above could be passing because the list never matched anything.
    expect(maintenanceIn("id, review_label, reviewed_by, machine_assisted".split(", "))).toEqual([
      "review_label",
      "reviewed_by",
      "machine_assisted",
    ]);
    // `status` is asked for only as a filter value, never as a returned column: the picker
    // has nothing to show about a lifecycle it has already applied.
    expect(selectedColumns()).not.toContain("status");
  });

  it("reports a pack read failure as this project's phrase and keeps the server's words in the log", async () => {
    const raw = 'relation "tradition_pack_releases" does not exist (policy "x")';
    planQueries({
      tradition_packs: [rowReturned([packRow()])],
      tradition_pack_releases: [databaseError(raw, "42501")],
    });

    const result = await listSelectableTraditionReleases();

    expect(result.data).toBeNull();
    expect(result.error).toBe("the tradition packs could not be loaded");
    expect(result.error).not.toContain("tradition_pack_releases");
    expect(warningLines.join("\n")).toContain("code 42501");
    expect(warningLines.join("\n")).not.toContain("does not exist");
  });
});

describe("getSelectedTraditionRelease", () => {
  it("treats an explicit “No tradition pack” as an empty answer, not a failure", async () => {
    planQueries({ weddings: [rowReturned(weddingSelection(null))] });

    const result = await getSelectedTraditionRelease(USER, WEDDING);

    expect(result).toEqual({ data: null, error: null });
    // One read and no write: there is nothing to fetch for a host who chose nothing.
    expect(queriedTables()).toEqual(["weddings"]);
  });

  it("reads only the selection columns, filtered to the caller's own wedding", async () => {
    planQueries({
      weddings: [rowReturned(weddingSelection(RELEASE))],
      tradition_pack_releases: [rowReturned(releaseRow())],
      tradition_packs: [rowReturned(packRow())],
    });
    await getSelectedTraditionRelease(USER, WEDDING);

    expect(queriedTables()).toEqual([
      "weddings",
      "tradition_pack_releases",
      "tradition_packs",
    ]);
    // `status` is the one lifecycle column read, and only to derive `retired`; the detail
    // read still asks for nothing about who reviewed the release or when.
    expect(selectedColumns()).toEqual([
      "id",
      "tradition_pack_release_id",
      "id",
      "pack_id",
      "release_number",
      "languages",
      "definition",
      "definition_schema_version",
      "status",
      "id",
      "pack_key",
      "display_name",
      "scope_statement",
    ]);
    for (const column of selectedColumns()) {
      expect(NEVER_SELECTED, column).not.toContain(column);
    }
    expect(
      recordedSteps()
        .filter((step) => step.method === "eq")
        .map((step) => [step.table, ...step.args]),
    ).toEqual([
      ["weddings", "id", WEDDING],
      ["weddings", "owner_user_id", USER],
      ["tradition_pack_releases", "id", RELEASE],
      ["tradition_packs", "id", PACK],
    ]);
  });

  it("carries the frozen definition through and marks a retired release", async () => {
    planQueries({
      weddings: [rowReturned(weddingSelection(RELEASE))],
      tradition_pack_releases: [rowReturned(
        releaseRow({
          status: "deprecated",
          definition: { sections: [{ section_key: "welcome", kind: "prose" }] },
          definition_schema_version: 2,
        }),
      )],
      tradition_packs: [rowReturned(packRow())],
    });

    const result = await getSelectedTraditionRelease(USER, WEDDING);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: RELEASE,
      packKey: "tamil-english-foundation",
      releaseNumber: 1,
      retired: true,
      definitionSchemaVersion: 2,
      definition: { sections: [{ section_key: "welcome", kind: "prose" }] },
    });
  });

  it("says nothing about the wording when the release row cannot be read", async () => {
    planQueries({
      weddings: [rowReturned(weddingSelection(RELEASE))],
      tradition_pack_releases: [emptyResult()],
    });

    const result = await getSelectedTraditionRelease(USER, WEDDING);

    expect(result.data).toBeNull();
    expect(result.error).toBe("the tradition pack could not be loaded");
  });

  it("calls a wedding the caller cannot see an opening failure, not an empty pack", async () => {
    planQueries({ weddings: [emptyResult()] });

    const result = await getSelectedTraditionRelease(USER, WEDDING);

    expect(result).toEqual({ data: null, error: "this invitation could not be opened" });
  });
});

describe("selectTraditionRelease / clearTraditionRelease", () => {
  it("writes exactly one field, on the caller's own wedding", async () => {
    planQueries({ weddings: [rowReturned([{ id: WEDDING }])] });

    const result = await selectTraditionRelease(USER, WEDDING, RELEASE);

    expect(result).toEqual({ data: null, error: null });
    expect(queriedTables()).toEqual(["weddings"]);
    expect(payloadOf("weddings", "update")).toEqual({ tradition_pack_release_id: RELEASE });
    expect(
      recordedSteps()
        .filter((step) => step.table === "weddings" && step.method === "eq")
        .map((step) => step.args),
    ).toEqual([
      ["id", WEDDING],
      ["owner_user_id", USER],
    ]);
    // The read-back is what separates "saved" from "RLS matched nothing".
    expect(
      recordedSteps().filter((step) => step.table === "weddings" && step.method === "select"),
    ).toHaveLength(1);
  });

  it("clears by writing an explicit null, so the choice stays visible to the database", async () => {
    planQueries({ weddings: [rowReturned([{ id: WEDDING }])] });

    const result = await clearTraditionRelease(USER, WEDDING);

    expect(result).toEqual({ data: null, error: null });
    const payload = payloadOf("weddings", "update");
    expect(payload).toHaveProperty("tradition_pack_release_id", null);
  });

  it("never writes a release row, whichever direction the selection moves", async () => {
    // Both answers come from one plan: `planQueries` starts the recording over, so a second
    // call would erase the first write instead of adding to it.
    planQueries({ weddings: [rowReturned([{ id: WEDDING }]), rowReturned([{ id: WEDDING }])] });
    await selectTraditionRelease(USER, WEDDING, RELEASE);
    await clearTraditionRelease(USER, WEDDING);

    const writes = recordedSteps().filter(
      (step) => step.method === "update" || step.method === "insert" || step.method === "delete",
    );
    expect(writes.map((step) => step.table)).toEqual(["weddings", "weddings"]);
  });

  it("involves no language, name or community column anywhere, so nothing can be inferred from one", async () => {
    // §19's "no automatic selection" rule, measured at the only layer that could implement it
    // behind a caller's back. The panel receives two ids and no language, so an auto-selection
    // would have to be a read or a write *here* that names a wedding's language, a person's name
    // or a community field. This runs all four calls against one plan and then looks at every
    // argument and every payload key they sent.
    planQueries({
      tradition_packs: [rowReturned([packRow()]), rowReturned(packRow())],
      tradition_pack_releases: [rowReturned([releaseRow()]), rowReturned(releaseRow())],
      weddings: [
        rowReturned(weddingSelection(RELEASE)),
        rowReturned([{ id: WEDDING }]),
        rowReturned([{ id: WEDDING }]),
      ],
    });

    await listSelectableTraditionReleases();
    const selected = await getSelectedTraditionRelease(USER, WEDDING);
    await selectTraditionRelease(USER, WEDDING, OTHER);
    await clearTraditionRelease(USER, WEDDING);
    // The wedding's own answer is unchanged by all of it, which is the half a browser can check:
    // a language change that switched the release would have to be a write, and the only write
    // this layer can issue is the one the host made on purpose.
    expect(selected.data).toMatchObject({ id: RELEASE, retired: false });

    const CANDIDATES = [
      "primary_language", "additional_languages", "language", "languages_of_the_wedding",
      "title", "community", "religion", "caste", "surname", "gotra",
    ];
    // Every column name this layer put on the wire: in a select list, as the column a filter or
    // an order was placed on, or as a key of a write payload.
    const FILTERS = ["eq", "in", "like", "ilike", "gt", "gte", "lt", "lte", "is", "order", "not"];
    const names = [
      ...selectedColumns(),
      ...recordedSteps()
        .filter((step) => FILTERS.includes(step.method))
        .map((step) => String(step.args[0] ?? "").trim()),
      ...recordedSteps()
        .filter((step) => step.method === "update" || step.method === "insert")
        .flatMap((step) => Object.keys((step.args[0] as Record<string, unknown>) ?? {})),
    ];
    expect(names.filter((name) => CANDIDATES.includes(name))).toEqual([]);
    // Control: the scan is not looking for words that cannot occur. `languages` is the one
    // release-side column this layer legitimately reads, and a query that named the *wedding's*
    // language instead would have been caught by it.
    expect(names).toContain("languages");
    expect(names).toContain("status");
    expect(names).toContain("tradition_pack_release_id");
  });

  it("refuses an update that matched no row instead of calling it a save", async () => {
    planQueries({ weddings: [emptyResult()] });

    const result = await selectTraditionRelease(USER, WEDDING, RELEASE);

    expect(result.data).toBeNull();
    expect(result.error).toBe("that pack could not be chosen");
    expect(warningLines.join("\n")).toContain("code none");
  });

  it("keeps a rejected write's policy prose out of the phrase the host sees", async () => {
    planQueries({
      weddings: [databaseError(
        'new row violates row-level security policy for table "weddings"',
        "42501",
      )],
    });

    const result = await clearTraditionRelease(USER, WEDDING);

    expect(result.error).toBe("the pack selection could not be cleared");
    expect(result.error).not.toMatch(/row-level|security|weddings|policy/);
    expect(warningLines.join("\n")).toContain("forbidden, code 42501");
    expect(warningLines.join("\n")).not.toContain("row-level security");
  });
});
