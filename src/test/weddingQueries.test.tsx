// Stage 2 phase 78: the app's query contract, tested without a network.
//
// These tests pin what the data layer *asks for*, which is the half of the security model
// the browser controls: which table is named, which columns cross the wire, which fields a
// create may send, and what happens when the answer is an error or a row that RLS hid. The
// other half — whether Postgres would have answered at all — is qualified by
// supabase/tests/stage2/, and nothing here claims to prove it.

import { beforeEach, describe, expect, it, vi } from "vitest";
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
  createWedding,
  getWedding,
  getWeddingDesign,
  listDesignOptions,
  listWeddings,
  updatePlanningDetails,
  updateStyleSettings,
} from "@/integrations/supabase/weddings";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";

// The signed-in identity the pages read, returned as one stable object: a fresh object on
// every call would re-fire any effect keyed on `user`, which is not what the app does.
// Nothing here exercises auth itself — Stage 2 changed no sign-in path, and that boundary is
// qualified in supabase/tests/stage2/.
const authStub = vi.hoisted(() => {
  const value = {
    user: { id: "11111111-1111-4111-8111-111111111111" },
    session: null,
    loading: false,
  };
  return () => value;
});
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: authStub }));

const renderWithRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter initialEntries={["/dashboard"]}>{ui}</MemoryRouter>);

type WeddingRow = Database["public"]["Tables"]["weddings"]["Row"];

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WEDDING = "33333333-3333-4333-8333-333333333333";
const DESIGN = "44444444-4444-4444-8444-444444444444";

const weddingRow = (overrides: Partial<WeddingRow> = {}): WeddingRow => ({
  id: WEDDING,
  owner_user_id: USER,
  title: "Asha & Karthik",
  primary_language: "ta",
  additional_languages: [],
  estimated_guest_count: 120,
  lifecycle_status: "draft",
  tradition_pack_id: null,
  design_template_id: DESIGN,
  style_settings: { font: "Playfair Display" },
  created_at: "2026-09-25T09:00:00+00:00",
  updated_at: "2026-09-25T09:00:00+00:00",
  ...overrides,
});

const methodsOn = (table: string): string[] =>
  recordedSteps()
    .filter((step) => step.table === table)
    .map((step) => step.method);

const argsOf = (table: string, method: string): readonly unknown[] =>
  recordedSteps().find((step) => step.table === table && step.method === method)?.args ?? [];

beforeEach(() => {
  planQueries({});
});

describe("the wedding list and detail reads", () => {
  it("asks for its own weddings by owner, newest first, and nothing else", async () => {
    planQueries({ weddings: [rowReturned([weddingRow()])] });
    const result = await listWeddings(USER);

    expect(queriedTables()).toEqual(["weddings"]);
    expect(methodsOn("weddings")).toEqual(["from", "select", "eq", "order"]);
    expect(argsOf("weddings", "select")).toEqual([
      "id, title, primary_language, estimated_guest_count, design_template_id, created_at",
    ]);
    expect(argsOf("weddings", "eq")).toEqual(["owner_user_id", USER]);
    expect(argsOf("weddings", "order")).toEqual(["created_at", { ascending: false }]);
    expect(result.data).toEqual([
      {
        id: WEDDING,
        title: "Asha & Karthik",
        primaryLanguage: "ta",
        estimatedGuestCount: 120,
        designTemplateId: DESIGN,
        createdAt: "2026-09-25T09:00:00+00:00",
      },
    ]);
  });

  it("reads a wedding that is not there as absent, not as a failure", async () => {
    // This is the shape RLS produces for somebody else's row: no error, no row.
    planQueries({ weddings: [emptyResult()] });
    await expect(getWedding(OTHER, WEDDING)).resolves.toEqual({ data: null, error: null });
    expect(methodsOn("weddings")).toContain("maybeSingle");
  });

  it("never repeats a database message to the caller", async () => {
    planQueries({ weddings: [databaseError('new row violates row-level security policy "weddings_owner_insert"')] });
    const result = await getWedding(USER, WEDDING);
    expect(result.error).toBeTruthy();
    expect(result.error ?? "").not.toMatch(/row-level security|weddings_owner_insert|policy/);
  });
});

describe("the design preview read", () => {
  it("reads the wedding, then its artwork, and keeps them separate", async () => {
    planQueries({
      weddings: [rowReturned(weddingRow())],
      design_templates: [rowReturned({ preview_svg: "<svg />" })],
    });
    const result = await getWeddingDesign(USER, WEDDING);

    expect(queriedTables()).toEqual(["weddings", "design_templates"]);
    expect(String(argsOf("weddings", "select")[0])).toContain("style_settings");
    expect(argsOf("design_templates", "select")).toEqual(["preview_svg"]);
    expect(argsOf("design_templates", "in")).toEqual(["status", ["draft", "approved"]]);
    expect(result.data).toMatchObject({ previewSvg: "<svg />", styleSettings: { font: "Playfair Display" } });
  });

  it("opens on a blank canvas when the artwork cannot be read", async () => {
    planQueries({
      weddings: [rowReturned(weddingRow())],
      design_templates: [databaseError("relation does not exist")],
    });
    const result = await getWeddingDesign(USER, WEDDING);
    expect(result.error).toBeNull();
    expect(result.data?.previewSvg).toBeNull();
    expect(result.data?.title).toBe("Asha & Karthik");
  });

  it("does not invent a design for a wedding with no template", async () => {
    planQueries({ weddings: [rowReturned(weddingRow({ design_template_id: null }))] });
    const result = await getWeddingDesign(USER, WEDDING);
    expect(queriedTables()).toEqual(["weddings"]);
    expect(result.data?.previewSvg).toBeNull();
  });
});

describe("writes", () => {
  it("creates a wedding with planning facts only, never a lifecycle or billing field", async () => {
    planQueries({ weddings: [rowReturned({ id: WEDDING })] });
    await createWedding(USER, { title: "Asha & Karthik", primaryLanguage: "ta", designTemplateId: DESIGN });

    const payload = payloadOf("weddings", "insert");
    expect(Object.keys(payload).sort()).toEqual([
      "design_template_id",
      "owner_user_id",
      "primary_language",
      "title",
    ]);
    // lifecycle_status is the server's to set; an app that sends it would be claiming a
    // published state the schema has no client-writable path to.
    expect(payload).not.toHaveProperty("lifecycle_status");
    expect(payload).not.toHaveProperty("estimated_guest_count");
    expect(payload).not.toHaveProperty("id");
  });

  it("sends only the fields that changed, and no query at all for an empty change", async () => {
    planQueries({ weddings: [rowReturned(null)] });
    await updatePlanningDetails(USER, WEDDING, { estimatedGuestCount: 80 });
    expect(payloadOf("weddings", "update")).toEqual({ estimated_guest_count: 80 });

    const before = recordedSteps().length;
    const result = await updatePlanningDetails(USER, WEDDING, {});
    expect(recordedSteps().length).toBe(before);
    expect(result).toEqual({ data: null, error: null });
  });

  it("replaces the style settings and touches no other column", async () => {
    planQueries({ weddings: [rowReturned(null)] });
    await updateStyleSettings(USER, WEDDING, { font: "DM Sans", foilEnabled: false });
    expect(payloadOf("weddings", "update")).toEqual({ style_settings: { font: "DM Sans", foilEnabled: false } });
    expect(argsOf("weddings", "eq")).toEqual(["id", WEDDING]);
  });
});

describe("the design catalogue", () => {
  it("offers only the visible statuses, from the canonical table", async () => {
    planQueries({ design_templates: [rowReturned([{ id: DESIGN, display_name: "Maroon Heritage", preview_svg: null }])] });
    const result = await listDesignOptions();
    expect(queriedTables()).toEqual(["design_templates"]);
    expect(argsOf("design_templates", "in")).toEqual(["status", ["draft", "approved"]]);
    expect(argsOf("design_templates", "select")).toEqual(["id, display_name, preview_svg"]);
    expect(result.data).toEqual([{ id: DESIGN, displayName: "Maroon Heritage", previewSvg: null }]);
  });

  it("never names an archived scaffold table", async () => {
    planQueries({
      weddings: [rowReturned([weddingRow()]), rowReturned([weddingRow()]), rowReturned({ id: WEDDING })],
      design_templates: [rowReturned([])],
    });
    await Promise.all([
      listWeddings(USER),
      getWeddingDesign(USER, WEDDING),
      listDesignOptions(),
      createWedding(USER, { title: "t", primaryLanguage: null, designTemplateId: null }),
    ]);
    expect(new Set(queriedTables())).toEqual(new Set(["weddings", "design_templates"]));
  });
});

describe("a page reading through the adapter", () => {
  it("lists the signed-in user's weddings by name, date and language", async () => {
    // One query, from the page's own effect: the page names no table and calls no client.
    planQueries({ weddings: [rowReturned([weddingRow({ estimated_guest_count: 120 })])] });
    renderWithRouter(<Dashboard />);

    expect(await screen.findByText("Asha & Karthik")).toBeTruthy();
    expect(screen.getByText(/Tamil/)).toBeTruthy();
    expect(screen.getByText(/~120 guests/)).toBeTruthy();
    expect(queriedTables()).toEqual(["weddings"]);
    expect(screen.getByRole("link", { name: /Asha & Karthik/ }).getAttribute("href")).toBe(
      `/project/${WEDDING}/configure`,
    );
  });

  it("says so when the invitations cannot be read", async () => {
    planQueries({ weddings: [databaseError("connection terminated unexpectedly")] });
    renderWithRouter(<Dashboard />);
    expect(await screen.findByText(/could not load your invitations/i)).toBeTruthy();
    // The failure is a sentence the customer can act on, not the driver's error text.
    expect(document.body.textContent ?? "").not.toMatch(/connection terminated/);
  });
});
