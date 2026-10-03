// The host's workbench, tested as a person who is typing.
//
// What is at stake on this page is a promise about timing: what the host sees is what a
// guest will get *once they save and publish*, and nothing before that. So the assertions
// below are mostly about the gap between the screen and the rows — an unsaved paragraph
// must be visible and must be labelled as unsaved, a freeze must refuse that paragraph,
// and a failure must leave the words on screen.
//
// Stage 5 added a second promise of the same kind, and it is the reason most of this file
// now talks about one call instead of three: the document on the canvas, the section list the
// editor is built from, and the findings that hold a freeze back all come from
// `api.preview_invitation_document`, in one answer about one snapshot. A page that showed the
// server's verdict beside a document it had read at a different moment would be exactly the
// preview/freeze mismatch §20 exists to remove. So the tests below check the wiring (one read,
// re-read after every write, the newest answer wins), the consequence (the freeze button
// follows the server's list, not this file's opinion), and the honesty of the two lists the
// page prints — the server's findings and this build's drawing notes are different facts,
// labelled apart.
//
// The four adapter modules are mocked, which is the honest seam for this file: what the
// page asks the database for is qualified over real PostgREST in `supabase/tests/api/`,
// and what an adapter does with an answer is qualified in `weddingQueries.test.tsx`,
// `weddingContentQueries.test.ts` and `publicInvitationTransport.test.ts`. Re-stubbing the
// transport here would test the mock. `InvitationRenderer` is deliberately real, because
// the point of §U is that this page draws with the guest's renderer and not a copy of it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import {
  guestInvitation,
  guestPayload,
  packedGuestPayload,
  payloadOfWith,
} from "@/test/invitationFixture";
import { BUILT_IN_AUTHORING } from "@/lib/invitationAuthoring";
import type { PackHostField, PackOverrideRule, PackSectionKey } from "@/lib/traditionPackContract";
import type {
  SelectedTraditionRelease,
  TraditionReleaseOption,
} from "@/integrations/supabase/traditionReleases";
import type {
  InvitationDraftContent,
  QueryResult,
  StoredInvitationVersion,
  WeddingDesign,
} from "@/integrations/supabase/weddings";
import type {
  AuthoringSection,
  InvitationIssue,
  PublicationState,
  SelectedReleaseSummary,
} from "@/integrations/supabase/publication";

const USER = "11111111-1111-4111-8111-111111111111";
const WEDDING = "33333333-3333-4333-8333-333333333333";
const DESIGN = "44444444-4444-4444-8444-444444444444";
const TOKEN = "abcdefghijabcdefghijabcdefghijabcdefghijabcde";

/** The heading `AuthoritativeIssues` prints, spelled as the component spells it. Tests name it
 *  rather than retyping it in five places, because the string is itself part of what §20 requires
 *  (one *clearly named* list) and the freeze panel quotes it back to the host. */
const FINDINGS_HEADING = "What the server says stands between this and a version";

const api = vi.hoisted(() => ({
  getWeddingDesign: vi.fn(),
  getDraftContent: vi.fn(),
  listInvitationVersions: vi.fn(),
  updateStyleSettings: vi.fn(),
  updateDraftContent: vi.fn(),
  previewInvitationDocument: vi.fn(),
  createInvitationVersion: vi.fn(),
  getPublicationState: vi.fn(),
  publishInvitation: vi.fn(),
  rotateInvitationLink: vi.fn(),
  revokeInvitationPublication: vi.fn(),
  listPeople: vi.fn(),
  listVenues: vi.fn(),
  listCeremonies: vi.fn(),
  createPerson: vi.fn(),
  listSelectableTraditionReleases: vi.fn(),
  getSelectedTraditionRelease: vi.fn(),
  selectTraditionRelease: vi.fn(),
  clearTraditionRelease: vi.fn(),
}));

vi.mock("@/integrations/supabase/weddings", () => ({
  EMPTY_DRAFT_CONTENT: { welcome: null, familyIntroduction: null, eventNotes: null, closing: null },
  getWeddingDesign: (...a: unknown[]) => api.getWeddingDesign(...a),
  getDraftContent: (...a: unknown[]) => api.getDraftContent(...a),
  listInvitationVersions: (...a: unknown[]) => api.listInvitationVersions(...a),
  updateStyleSettings: (...a: unknown[]) => api.updateStyleSettings(...a),
  updateDraftContent: (...a: unknown[]) => api.updateDraftContent(...a),
}));

// Only the document endpoint the page actually uses is wired to a spy. `previewInvitation` is
// deliberately absent: the workbench must not be reading the guest projection and the server's
// findings from two different calls, and a page that still reached for the old one would fail
// here on an undefined function rather than pass on a stub.
vi.mock("@/integrations/supabase/publication", () => ({
  previewInvitationDocument: (...a: unknown[]) => api.previewInvitationDocument(...a),
  createInvitationVersion: (...a: unknown[]) => api.createInvitationVersion(...a),
  getPublicationState: (...a: unknown[]) => api.getPublicationState(...a),
  publishInvitation: (...a: unknown[]) => api.publishInvitation(...a),
  rotateInvitationLink: (...a: unknown[]) => api.rotateInvitationLink(...a),
  revokeInvitationPublication: (...a: unknown[]) => api.revokeInvitationPublication(...a),
}));

// The three row lists arrive empty: this page's contract is the draft text, the styling and
// the publication gesture. `contentEditor.test.tsx` is where the rows themselves are tested,
// and `weddingContentQueries.test.ts` where what the adapter sends is proved. `createPerson`
// is the one write a test below uses, because it is the shortest gesture that provably makes
// the page ask for a fresh document.
vi.mock("@/integrations/supabase/weddingContent", () => {
  const unused = vi.fn();
  return {
    listPeople: (...a: unknown[]) => api.listPeople(...a),
    listVenues: (...a: unknown[]) => api.listVenues(...a),
    listCeremonies: (...a: unknown[]) => api.listCeremonies(...a),
    createPerson: (...a: unknown[]) => api.createPerson(...a),
    updatePerson: unused,
    removePerson: unused,
    createVenue: unused,
    updateVenue: unused,
    removeVenue: unused,
    createCeremony: unused,
    updateCeremony: unused,
    removeCeremony: unused,
  };
});

// The tradition-pack reads and writes, stubbed at the same seam as the other three adapters:
// the catalogue's own behaviour is `traditionPackPanel.test.tsx`, and what the adapter sends
// over PostgREST is `traditionReleases.test.ts`. Here the panel only needs an answer, and the
// default one is "nothing to choose, nothing chosen" — the state a fresh wedding is in.
vi.mock("@/integrations/supabase/traditionReleases", () => ({
  listSelectableTraditionReleases: (...a: unknown[]) => api.listSelectableTraditionReleases(...a),
  getSelectedTraditionRelease: (...a: unknown[]) => api.getSelectedTraditionRelease(...a),
  selectTraditionRelease: (...a: unknown[]) => api.selectTraditionRelease(...a),
  clearTraditionRelease: (...a: unknown[]) => api.clearTraditionRelease(...a),
}));

// One stable identity object: a fresh one per call would re-run the load effect on every
// render, which is not what the provider does.
const authValue = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" },
  session: null,
  loading: false,
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authValue }));

import EditProject from "@/pages/EditProject";

const ok = <T,>(data: T) => ({ data, error: null });
const fail = (error: string) => ({ data: null, error });

const designRow = (overrides: Partial<WeddingDesign> = {}): WeddingDesign => ({
  id: WEDDING,
  title: "Arun weds Deepa",
  primaryLanguage: "ta",
  estimatedGuestCount: 120,
  designTemplateId: DESIGN,
  createdAt: "2026-09-20T09:00:00+00:00",
  styleSettings: {
    font: "Noto Sans Tamil",
    fontSize: "24",
    color: "#6b1e2a",
    alignment: "center",
    foilEnabled: false,
  },
  previewSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  ...overrides,
});

/** Equal to what the projection in `guestPayload()` carries, so a freshly loaded page is
 *  clean: an unsaved-change test that starts from a mismatch would prove nothing about
 *  typing. */
const savedDraft: InvitationDraftContent = {
  welcome: "With the blessings of our elders",
  familyIntroduction: "Our families invite you",
  eventNotes: null,
  closing: null,
};

const frozenVersion: StoredInvitationVersion = {
  id: "v-1",
  versionNumber: 1,
  createdAt: "2026-09-21T06:00:00+00:00",
};

const unpublished: PublicationState = {
  versionNumber: null,
  publishedAt: null,
  linkActive: false,
  linkExpiresAt: null,
};

/** One answer of `api.preview_invitation_document`, in the adapter's already-parsed shape: the
 *  document, the findings about it, the section declaration behind it and the release it stands
 *  on. The defaults are a wedding with no pack and nothing standing in its way, which is what a
 *  fresh wedding's editor has to look like before any test says otherwise. */
interface DocumentAnswer {
  invitation: PublicInvitation;
  issues: InvitationIssue[];
  authoring: AuthoringSection[];
  selectedRelease: SelectedReleaseSummary | null;
}

const documentAnswer = (overrides: Partial<DocumentAnswer> = {}): DocumentAnswer => ({
  invitation: parsePublicInvitation(guestPayload()),
  issues: [],
  authoring: BUILT_IN_AUTHORING,
  selectedRelease: null,
  ...overrides,
});

const documentOk = (overrides: Partial<DocumentAnswer> = {}) => ok(documentAnswer(overrides));

/** One entry of an AUTHORING DECLARATION. Built here rather than read from a definition file,
 *  because what the page is tested against is the server's answer, not a release document. */
const declared = (
  sectionKey: PackSectionKey,
  kind: AuthoringSection["kind"],
  options: {
    position?: number;
    required?: boolean;
    hostField?: PackHostField | null;
    overrideRule?: AuthoringSection["overrideRule"];
    requiresVenue?: boolean | null;
  } = {},
): AuthoringSection => ({
  sectionKey,
  kind,
  position: options.position ?? 0,
  required: options.required ?? false,
  hostField: options.hostField ?? null,
  overrideRule: options.overrideRule ?? null,
  requiresVenue: options.requiresVenue ?? null,
});

/** The platform's own declaration with one rule changed on the `welcome` section, so a test of
 *  `pack_only` or `host_must_supply` differs from the default by exactly the fact it is about. */
const welcomeRule = (rule: PackOverrideRule): AuthoringSection[] =>
  BUILT_IN_AUTHORING.map(section =>
    section.sectionKey === "welcome" ? { ...section, overrideRule: rule } : section,
  );

/** The projection with one person's name replaced, for the reads a test has to tell apart on
 *  the canvas rather than in a call log. */
const invitationWithPerson = (displayName: string): PublicInvitation =>
  parsePublicInvitation(
    payloadOfWith(
      guestInvitation() as unknown as Record<string, unknown>,
      ["invitation", "people", 0, "display_name"],
      displayName,
    ),
  ) as PublicInvitation;

/** One `private.invitation_issue_records` row as the adapter hands it over: the code and message
 *  key the server wrote, its own severity, and none of Postgres' `message`, `details` or `hint`,
 *  which `publication.ts` throws away before anything reaches a component. */
const finding = (overrides: Partial<InvitationIssue>): InvitationIssue => ({
  code: "required_text_missing",
  messageKey: "required_text_missing",
  sectionKey: "welcome",
  field: "welcome",
  blocking: true,
  params: {},
  ...overrides,
});

const mount = () =>
  render(
    <MemoryRouter initialEntries={[`/project/${WEDDING}/edit`]}>
      <Routes>
        <Route path="/project/:id/edit" element={<EditProject />} />
      </Routes>
    </MemoryRouter>,
  );

/** The release block of a document answer, retired since the wedding pointed at it.
 *  `isCurrent` is the server's own `status = 'approved'` read as a present-tense fact, and it is
 *  the ONLY lifecycle information this build is given: no `deprecated_at`, no reviewer, no
 *  changelog. Everything §21's screen says is built from that one boolean and the identity beside
 *  it. */
const RETIRED_SUMMARY: SelectedReleaseSummary = {
  packKey: "test-reviewed-fixture",
  displayName: "TEST ONLY — Synthetic Reviewed Fixture",
  releaseNumber: 1,
  definitionSchemaVersion: 2,
  isCurrent: false,
};

const RELEASE_R1 = "55555555-5555-4555-8555-555555555555";
const RELEASE_R2 = "66666666-6666-4666-8666-666666666666";

/** One row of the picker's catalogue: an approved release, which is why the retired R1 is never
 *  in it. */
const catalogueRelease = (id: string, releaseNumber: number): TraditionReleaseOption => ({
  id,
  packKey: RETIRED_SUMMARY.packKey,
  packDisplayName: RETIRED_SUMMARY.displayName,
  scopeStatement: "Structural wording sections only; no ritual instruction.",
  releaseNumber,
  languages: ["ta", "en"],
});

/** What the pack panel reads back as this wedding's own selection. */
const weddingSelection = (
  id: string,
  releaseNumber: number,
  retired: boolean,
): SelectedTraditionRelease => ({
  ...catalogueRelease(id, releaseNumber),
  definition: { sections: [] },
  definitionSchemaVersion: 2,
  retired,
});

/** Wait for the loaded workbench.
 *
 *  The five reads the page makes on mount resolve into one `setState` batch, so the outline and
 *  the row controls appear in the same commit as the document: waiting for a control that only
 *  the loaded state has is also waiting for `preview_invitation_document` to have been applied.
 *  The row editor's own heading is not such a signal (it prints while its lists are still
 *  loading), which is why the sync point is the button. */
const ready = async () => {
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 2, name: "Share with guests" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Your invitation, section by section" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a person" })).toBeInTheDocument();
  });
};

const visit = async () => {
  const result = mount();
  await ready();
  return result;
};

/** The same sync point for a declaration that names no row lists, where the button above is not
 *  on the screen to wait for. `ready()` is not optional in the other tests: it is what proves the
 *  mount's five reads have been applied rather than merely started. */
const readyOnProse = async (fieldLabel: string) => {
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 2, name: "Your invitation, section by section" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(fieldLabel)).toBeInTheDocument();
  });
};

const status = () => screen.getByRole("status");

const freezeButton = () => screen.getByRole("button", { name: /Freeze this draft/ });

beforeEach(() => {
  api.getWeddingDesign.mockReset().mockResolvedValue(ok(designRow()));
  api.getDraftContent.mockReset().mockResolvedValue(ok(savedDraft));
  api.listInvitationVersions.mockReset().mockResolvedValue(ok([frozenVersion]));
  api.updateStyleSettings.mockReset().mockResolvedValue(ok(null));
  api.updateDraftContent.mockReset().mockResolvedValue(ok(savedDraft));
  api.previewInvitationDocument.mockReset().mockResolvedValue(documentOk());
  api.createInvitationVersion.mockReset();
  api.getPublicationState.mockReset().mockResolvedValue(ok(unpublished));
  api.publishInvitation.mockReset();
  api.rotateInvitationLink.mockReset();
  api.revokeInvitationPublication.mockReset();
  api.listPeople.mockReset().mockResolvedValue(ok([]));
  api.listVenues.mockReset().mockResolvedValue(ok([]));
  api.listCeremonies.mockReset().mockResolvedValue(ok([]));
  api.createPerson.mockReset().mockResolvedValue(ok({ id: "p-1" }));
  api.listSelectableTraditionReleases.mockReset().mockResolvedValue(ok([]));
  api.getSelectedTraditionRelease.mockReset().mockResolvedValue({ data: null, error: null });
  api.selectTraditionRelease.mockReset().mockResolvedValue(ok(null));
  api.clearTraditionRelease.mockReset().mockResolvedValue(ok(null));
});

/** The document the host is being shown, and nothing else.
 *
 *  Read off the page rather than from `container.textContent`: a `<textarea>`'s value is its
 *  child text node in the DOM, so the whole page's text includes every word the host has typed
 *  whether or not the canvas drew it. An assertion on the page would have passed on a preview
 *  that showed nothing — which is precisely the bug this scoping exists to catch. */
const canvasText = () => screen.getByRole("article").textContent ?? "";

describe("one server read behind the canvas, the editor and the findings", () => {
  it("asks the document endpoint once for this wedding and draws its projection", async () => {
    const { container } = await visit();
    // The document on the canvas is the one `api.preview_invitation_document` built, so the
    // names, ceremonies and venues are the rows' content and not this page's invention.
    expect(container.textContent).toContain("Sri Kanchi Mahal");
    expect(container.textContent).toContain("Wedding ceremony");
    expect(api.previewInvitationDocument).toHaveBeenCalledTimes(1);
    expect(api.previewInvitationDocument).toHaveBeenCalledWith(WEDDING);
  });

  it("builds the controls from the declaration it was handed, not from its own list", async () => {
    // A release with two sections: a line the pack fills and one the host writes. The platform's
    // own editor would have offered four prose fields and three row lists here; a screen that
    // still did would be deciding the layout in the browser, which is what §19 forbids.
    const declaration = [
      declared("blessing", "text", { position: 1 }),
      declared("welcome", "text", {
        position: 2,
        hostField: "welcome",
        overrideRule: "host_may_replace",
      }),
    ];
    api.previewInvitationDocument.mockResolvedValue(documentOk({ authoring: declaration }));
    mount();
    await readyOnProse("The opening");
    expect(screen.getByLabelText("The opening")).toBeInTheDocument();
    expect(screen.queryByLabelText("Who is inviting")).toBeNull();
    expect(screen.queryByLabelText("A note about the ceremonies")).toBeNull();
    expect(screen.queryByLabelText("The last words")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a person" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a venue" })).toBeNull();
    // And in the release's order. `welcome` is position 1 in the projection above and position 2
    // in this declaration, so an outline that read the document instead of the declaration would
    // show the two blocks the other way round.
    const blocks = Array.from(document.querySelectorAll("div[id^='authoring-']")).map(node => node.id);
    expect(blocks).toEqual(["authoring-blessing", "authoring-welcome"]);
    // A section with no host field is said plainly rather than given an imaginary field.
    expect(screen.getByText("This section is filled by your pack, so there is nothing for you to write here.")).toBeInTheDocument();
  });

  it("mounts the row editors wherever the declaration puts a list", async () => {
    await visit();
    // The workbench is the only place a host can put a grandmother's name into the
    // invitation, so the page has to carry the section rather than a link to it.
    expect(screen.getByRole("heading", { level: 3, name: "The people" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "The venues" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "The ceremonies" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a venue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a ceremony" })).toBeInTheDocument();
    expect(api.listPeople).toHaveBeenCalledWith(WEDDING);
    expect(api.listVenues).toHaveBeenCalledWith(WEDDING);
    expect(api.listCeremonies).toHaveBeenCalledWith(WEDDING);
  });

  it("takes no section list out of a release that forbids a replacement", async () => {
    // `pack_only` with the host's old line still in the draft row: the release answers its own
    // wording for that slot, so the stored text is neither offered as an editable field nor
    // drawn on the canvas as though a guest would read it.
    const packFilled = packedGuestPayload() as {
      invitation: { sections: { items: Record<string, unknown>[] } };
    };
    packFilled.invitation.sections.items[0] = {
      ...packFilled.invitation.sections.items[0],
      host_field: "welcome",
      body: {
        source: "reviewed_pack",
        text: "[placeholder opening line from the release]",
        language: "ta",
        fallback_used: false,
        overrode_pack_text: false,
      },
    };
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({
        invitation: parsePublicInvitation(packFilled) as PublicInvitation,
        authoring: welcomeRule("pack_only"),
      }),
    );
    await visit();
    expect(screen.queryByLabelText("The opening")).toBeNull();
    expect(canvasText()).toContain("[placeholder opening line from the release]");
    // Unlike the `host_may_replace` case below, the saved draft here *does* hold a line for this
    // slot: the resolver never reads it for a `pack_only` section, which is precisely the
    // situation §19 asks to be said out loud rather than silently dropped or quietly overwritten.
    expect(canvasText()).not.toContain(savedDraft.welcome);
    expect(
      screen.getByText("This release does not accept a replacement for this section, so there is no field for it here."),
    ).toBeInTheDocument();
    expect(screen.getByText(/keeps the wording your chosen pack supplies, whatever you wrote here earlier/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing you wrote has been deleted/)).toBeInTheDocument();
  });
});

describe("the server's findings, as the freeze answer", () => {
  it("prints the blocking findings first, in its own words, and holds the freeze button off", async () => {
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({
        issues: [
          finding({
            code: "host_override_not_permitted",
            messageKey: "host_override_not_permitted",
            sectionKey: "event_notes",
            field: "event_notes",
            blocking: false,
          }),
          finding({}),
          finding({
            code: "required_list_empty",
            messageKey: "required_list_empty",
            sectionKey: "family",
            field: null,
            params: { kind: "people_list" },
          }),
        ],
      }),
    );
    await visit();
    const panel = screen.getByRole("heading", { level: 2, name: FINDINGS_HEADING }).closest("section");
    expect(panel).not.toBeNull();
    const lines = Array.from(panel?.querySelectorAll("li") ?? []);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.textContent).toContain("Must be fixed.");
    expect(lines[1]?.textContent).toContain("Must be fixed.");
    expect(lines[2]?.textContent).toContain("A note, not a blocker.");
    // The platform's own section names itself once: `welcome`'s release heading and its field
    // label are the same string, and a sentence that printed it twice would read as two places.
    expect(screen.getByText("The opening needs wording before this can be frozen.")).toBeInTheDocument();
    expect(panel?.textContent).not.toMatch(/Write it in The opening/);
    expect(panel?.textContent).toContain("needs at least one person added before this can be frozen");
    // Each finding points at the place to fix it, and only at a place this screen mounted.
    expect(screen.getAllByRole("link", { name: "Go to that section" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Go to that list" })).toHaveAttribute("href", "#people-heading");
    expect(freezeButton()).toBeDisabled();
    expect(screen.getByText(/Fixing one is enough to re-run them/)).toBeInTheDocument();
    // The machine's names stay in the machine: a host reading a code would be reading a row.
    expect(document.body.textContent).not.toMatch(
      /required_text_missing|required_list_empty|host_override_not_permitted|people_list|event_notes/,
    );
    // And the advisory does not steal the button: it is the blocking pair above that does, so the
    // panel has to be able to say which is which.
    expect(panel?.textContent).toContain("This is the same check the freeze button runs");
  });

  it("names an advisory as a note and leaves the freeze button alone", async () => {
    // The one non-blocking record the server has: the host's stored line for a section the
    // release fills. It is worth telling them about, and it is not a reason to refuse a version.
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({
        issues: [
          finding({
            code: "host_override_not_permitted",
            messageKey: "host_override_not_permitted",
            sectionKey: "event_notes",
            field: "event_notes",
            blocking: false,
          }),
        ],
      }),
    );
    await visit();
    expect(screen.getByRole("heading", { level: 2, name: FINDINGS_HEADING })).toBeInTheDocument();
    expect(screen.getByText("A note, not a blocker.")).toBeInTheDocument();
    expect(freezeButton()).toBeEnabled();
    // The waiting line belongs to a blocked freeze and nothing else: an enabled button that
    // claims to be waiting would leave the host looking for a blocker the list does not name.
    expect(screen.queryByText(/Fixing one is/)).toBeNull();
  });

  it("keeps the drawing note and the freeze verdict apart", async () => {
    // A section this build's renderer cannot place, and nothing from the server about it. The
    // host has to be able to tell "your bundle is older than this release" from "your
    // invitation is not ready": one is not a reason to refuse a version, and if it were shown as
    // one, a host would go looking for a mistake they never made.
    const unknownKind = payloadOfWith(
      guestInvitation() as unknown as Record<string, unknown>,
      ["invitation", "sections", "items", 1, "kind"],
      "prose",
    );
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({ invitation: parsePublicInvitation(unknownKind) as PublicInvitation }),
    );
    await visit();
    const note = screen.getByRole("heading", { level: 3, name: "What this preview could not draw" });
    expect(note).toBeInTheDocument();
    // The normalizer's own sentence, unedited: the list is the same object the renderer was
    // handed, so what is named here is what was skipped there.
    expect(document.body.textContent).toContain("claims kind prose, which no renderer in this build knows, so it was skipped");
    // Host-facing prose beside it, and nothing of the list inside the guest's document.
    expect(document.body.textContent).toContain("Your guests see none of this list");
    expect(canvasText()).not.toContain("no renderer in this build knows");
    // It says which list it is, and points at the other one by its heading.
    expect(document.body.textContent).toContain("It is not the freeze check");
    expect(note.parentElement?.textContent).toContain("the server");
    // The server's list is a separate thing, and here there is nothing in it to print.
    expect(screen.queryByRole("heading", { level: 2, name: FINDINGS_HEADING })).toBeNull();
    expect(freezeButton()).toBeEnabled();
    // §20's "never a raw schema error", measured as absence of the shapes one would be: a JSON
    // pointer, a quoted key, or a brace. The host reads sentences this app wrote.
    expect(note.parentElement?.textContent).not.toMatch(/[{}"]|\/sections\/|expected /);
  });

  it("re-reads the findings after a save, so the verdict is about the new rows", async () => {
    await visit();
    expect(api.previewInvitationDocument).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.previewInvitationDocument).toHaveBeenCalledTimes(2));
  });
});

describe("when the document read cannot be trusted", () => {
  it("keeps the newest answer when an older read lands last", async () => {
    // The deterministic case §20 asks for: a slow response to the first question, a fast
    // response to the second, and the slow one arriving after. Two writes were made — a save and
    // a new person — so the truth about the rows is the second answer, and the late first
    // answer would undo it. It carries a blocking finding as well, which makes the failure
    // observable rather than a name on a canvas nobody compares.
    const reads: Array<(value: QueryResult<DocumentAnswer>) => void> = [];
    api.previewInvitationDocument.mockImplementation(
      () => new Promise<QueryResult<DocumentAnswer>>(resolve => {
        reads.push(resolve);
      }),
    );
    mount();
    reads[0](documentOk());
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(reads).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to invitation" }));
    await waitFor(() => expect(reads).toHaveLength(3));

    reads[2](documentOk({ invitation: invitationWithPerson("Deepa Raman") }));
    await waitFor(() => expect(canvasText()).toContain("Deepa Raman"));

    reads[1](
      documentOk({
        invitation: invitationWithPerson("Arun from the older read"),
        issues: [finding({ blocking: true })],
      }),
    );
    // Flush the late answer's own work, then check nothing it said reached the screen.
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
    expect(canvasText()).toContain("Deepa Raman");
    expect(canvasText()).not.toContain("Arun from the older read");
    expect(screen.queryByRole("heading", { level: 2, name: FINDINGS_HEADING })).toBeNull();
    expect(freezeButton()).toBeEnabled();
  });

  it("says a check could not be re-read, and leaves the host's page intact", async () => {
    api.previewInvitationDocument.mockResolvedValue(fail("the preview could not be drawn"));
    await visit();
    expect(screen.getByText(/could not be re-read just now/)).toBeInTheDocument();
    // The failure is about the read, not the invitation: the manual editor the host has always
    // had stays on screen, and no findings panel appears out of a list that never arrived.
    expect(screen.getByLabelText("The opening")).toBeInTheDocument();
    expect(canvasText()).toContain(savedDraft.welcome);
    expect(screen.queryByRole("heading", { level: 2, name: FINDINGS_HEADING })).toBeNull();
    expect(freezeButton()).toBeEnabled();
    // The adapter's phrase, and nothing underneath it.
    expect(document.body.textContent).not.toMatch(/42501|preview_invitation_document|jsonb|constraint/i);
  });
});

describe("what the host is shown while typing", () => {
  it("shows typing at once and says it is not saved yet", async () => {
    await visit();
    expect(canvasText()).not.toContain("Please come early for the aarthi");
    fireEvent.change(screen.getByLabelText("A note about the ceremonies"), {
      target: { value: "Please come early for the aarthi" },
    });
    // On the canvas, not merely in the field: this slot's saved row is empty, so the
    // projection answered no body for it at all, and a preview that waited for Save to show a
    // first paragraph would be showing the host a document they are not writing.
    expect(canvasText()).toContain("Please come early for the aarthi");
    expect(screen.getByText(/Draft preview — unsaved changes shown/)).toBeInTheDocument();
    expect(status()).toHaveTextContent("Unsaved changes");
    // Local until Save: typing spends no request.
    expect(api.updateDraftContent).not.toHaveBeenCalled();
  });

  it("takes a paragraph off the canvas when the host deletes it", async () => {
    await visit();
    expect(canvasText()).toContain(savedDraft.welcome);
    fireEvent.change(screen.getByLabelText("The opening"), { target: { value: "" } });
    expect(canvasText()).not.toContain(savedDraft.welcome);
  });

  it("draws the host's words over a pack line the moment they type, and drops the pack's", async () => {
    // A section the release is filling: `host_field: welcome` with a `reviewed_pack` body,
    // which is exactly what the projection answers when the chosen pack has wording for a slot
    // and the host's own draft line is empty.
    const packFilled = packedGuestPayload() as {
      invitation: { sections: { items: Record<string, unknown>[] } };
    };
    packFilled.invitation.sections.items[0] = {
      ...packFilled.invitation.sections.items[0],
      host_field: "welcome",
      body: {
        source: "reviewed_pack",
        text: "[placeholder opening line from the release]",
        language: "ta",
        fallback_used: false,
        overrode_pack_text: false,
      },
    };
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({ invitation: parsePublicInvitation(packFilled) as PublicInvitation }),
    );
    // The draft row has to agree with that projection: a pack line is only on the page because
    // the host's own line for that slot is empty. A test that left the saved words in place
    // would be showing the canvas two answers to one question.
    api.getDraftContent.mockResolvedValue(ok({ ...savedDraft, welcome: null }));
    await visit();
    expect(canvasText()).toContain("[placeholder opening line from the release]");

    fireEvent.change(screen.getByLabelText("The opening"), {
      target: { value: "Arun and Deepa invite you" },
    });
    // Both halves of one sentence: the host's words are on the page and the reviewed line is
    // not, because directive §12 forbids a document that reads as the pack's while carrying
    // words no reviewer saw.
    expect(canvasText()).toContain("Arun and Deepa invite you");
    expect(canvasText()).not.toContain("[placeholder opening line from the release]");
  });

  it("mounts the tradition-pack choice for this wedding", async () => {
    await visit();
    expect(screen.getByRole("heading", { level: 2, name: "Tradition & wording" })).toBeInTheDocument();
    expect(api.listSelectableTraditionReleases).toHaveBeenCalled();
    expect(api.getSelectedTraditionRelease).toHaveBeenCalledWith(USER, WEDDING);
    // Nothing chosen is a state the screen says out loud rather than an empty box.
    expect(screen.getByRole("radio", { name: /No tradition pack — write it yourself/ })).toBeChecked();
  });

  it("does not nag about unsaved changes when the typing is undone", async () => {
    await visit();
    const field = screen.getByLabelText("The last words");
    fireEvent.change(field, { target: { value: "With love," } });
    expect(status()).toHaveTextContent("Unsaved changes");
    fireEvent.change(field, { target: { value: "" } });
    expect(status()).toHaveTextContent("Saved");
    expect(screen.getByText(/^Draft preview$/)).toBeInTheDocument();
  });

  it("hands the chosen styling to the next save, unchanged", async () => {
    await visit();
    fireEvent.click(screen.getByRole("button", { name: "Use Gold" }));
    expect(screen.getByRole("button", { name: "Use Gold" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Align text left" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.updateStyleSettings).toHaveBeenCalled());
    expect(api.updateStyleSettings).toHaveBeenCalledWith(USER, WEDDING, {
      font: "Noto Sans Tamil",
      fontSize: "24",
      color: "#c9972f",
      alignment: "left",
      foilEnabled: false,
    });
  });

  it("stores a template-only flourish without showing it to the guest", async () => {
    const { container } = await visit();
    const canvas = container.querySelector('section[aria-labelledby="preview-heading"]');
    const before = canvas?.textContent ?? "";
    fireEvent.click(screen.getByRole("checkbox"));
    expect(canvas?.textContent ?? "").toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.updateStyleSettings).toHaveBeenCalled());
    // It is a host preference, saved like any other setting — and `publicInvitationShape`
    // is where the guest's document is proven to have no place for it.
    expect(api.updateStyleSettings.mock.calls[0][2]).toMatchObject({ foilEnabled: true });
    expect(screen.getByText(/changes nothing\s*a guest sees/)).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("writes the styling and the words in one gesture, then re-reads the document", async () => {
    await visit();
    fireEvent.change(screen.getByLabelText("The opening"), {
      target: { value: "Arun and Deepa invite you" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(status()).toHaveTextContent("Saving…");
    await waitFor(() => expect(api.previewInvitationDocument).toHaveBeenCalledTimes(2));
    expect(api.updateStyleSettings).toHaveBeenCalledWith(USER, WEDDING, {
      font: "Noto Sans Tamil",
      fontSize: "24",
      color: "#6b1e2a",
      alignment: "center",
      foilEnabled: false,
    });
    expect(api.updateDraftContent).toHaveBeenCalledWith(WEDDING, {
      ...savedDraft,
      welcome: "Arun and Deepa invite you",
    });
    expect(status()).toHaveTextContent("Saved");
    expect(screen.getByText(/^Draft preview$/)).toBeInTheDocument();
  });

  it("says it failed in its own words, and leaves the typing where it was", async () => {
    api.updateDraftContent.mockResolvedValue(fail("the draft could not be saved"));
    await visit();
    fireEvent.change(screen.getByLabelText("The opening"), {
      target: { value: "Arun and Deepa invite you" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(status()).toHaveTextContent("Could not save"));
    expect(screen.getByLabelText("The opening")).toHaveValue("Arun and Deepa invite you");
    expect(status()).toHaveTextContent("Your text is still here");
    // Nothing of the database's own sentence reaches the host: no code, no hint, no table.
    expect(document.body.textContent).not.toMatch(/42501|invitation_drafts|constraint|row level/i);
  });

  it("refuses to freeze what is only on the screen", async () => {
    api.createInvitationVersion.mockResolvedValue(ok({ id: "v-2", versionNumber: 2 }));
    await visit();
    fireEvent.change(screen.getByLabelText("The last words"), { target: { value: "With love," } });
    fireEvent.click(freezeButton());
    expect(api.createInvitationVersion).not.toHaveBeenCalled();
    expect(screen.getByText(/a version freezes what is saved, not what is on screen/)).toBeInTheDocument();
  });

  it("freezes a clean draft and names the version it made", async () => {
    api.createInvitationVersion.mockResolvedValue(ok({ id: "v-2", versionNumber: 2 }));
    await visit();
    fireEvent.click(freezeButton());
    await waitFor(() => expect(api.createInvitationVersion).toHaveBeenCalledWith(WEDDING));
    await waitFor(() => expect(screen.getByText("Version 2 is frozen. It cannot be edited.")).toBeInTheDocument());
    expect(api.listInvitationVersions).toHaveBeenCalledTimes(2);
  });
});

describe("publishing and sharing", () => {
  it("shows the address the publish call carried, built into a full link", async () => {
    api.publishInvitation.mockResolvedValue(ok({ path: `/i/${TOKEN}`, linkReused: false }));
    await visit();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.publishInvitation).toHaveBeenCalledWith(WEDDING, "v-1"));
    const shown = screen.getByText(new RegExp(TOKEN));
    expect(shown.textContent).toBe(`${window.location.origin}/i/${TOKEN}`);
    expect(screen.getByText(/It is shown once/)).toBeInTheDocument();
    expect(screen.getByText(/Copy the address now/)).toBeInTheDocument();
  });

  it("does not claim a second address when the live one was re-pointed", async () => {
    api.publishInvitation.mockResolvedValue(ok({ path: null, linkReused: true }));
    api.getPublicationState.mockResolvedValue(ok({ ...unpublished, versionNumber: 1, linkActive: true, publishedAt: "2026-09-21T06:00:00+00:00" }));
    const { container } = await visit();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(screen.getByText("Your existing address now shows this version. Nothing new was created.")).toBeInTheDocument(),
    );
    // No minted credential, so no address box at all — the page cannot build a link out of
    // a token it was never given.
    expect(screen.queryByText(/It is shown once/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
    expect(container.textContent).not.toContain(`/i/${TOKEN}`);
    expect(screen.getByText(/A live address cannot be shown again/)).toBeInTheDocument();
  });

  it("replaces the old address when a new link is made, and says the old one is retired", async () => {
    const rotated = "zyxwvutsrqponmlkjihgfedcba0123456789abcdefghj";
    api.rotateInvitationLink.mockResolvedValue(ok({ path: `/i/${rotated}`, previousRevokedAt: "2026-09-26T00:00:00+00:00" }));
    api.getPublicationState.mockResolvedValue(ok({ ...unpublished, linkActive: true, versionNumber: 1 }));
    await visit();
    fireEvent.click(screen.getByRole("button", { name: "New link, same version" }));
    await waitFor(() => expect(api.rotateInvitationLink).toHaveBeenCalledWith(WEDDING));
    expect(screen.getByText(new RegExp(rotated)).textContent).toBe(`${window.location.origin}/i/${rotated}`);
    expect(screen.getByText(/the old one was retired/)).toBeInTheDocument();
  });

  it("takes a link down without pretending a guest was notified", async () => {
    api.revokeInvitationPublication.mockResolvedValue(ok({ revoked: true, tokensRevoked: 1 }));
    api.getPublicationState.mockResolvedValue(ok({ ...unpublished, linkActive: true, versionNumber: 1 }));
    await visit();
    fireEvent.click(screen.getByRole("button", { name: "Take the link down" }));
    await waitFor(() =>
      expect(screen.getByText(/The link is taken down/)).toBeInTheDocument(),
    );
    expect(document.body.textContent).not.toMatch(/guests? (were|have been) notified|sent an? (email|message)/i);
  });

  it("stops describing the link as live once it is taken down", async () => {
    // The state read answers twice: the live link while it exists, then "this wedding has
    // no publication" after the takedown. A reading that comes back successfully empty is
    // still a reading — holding on to the previous one would tell the host their retired
    // address still works while their guests are being refused.
    api.revokeInvitationPublication.mockResolvedValue(ok({ revoked: true, tokensRevoked: 1 }));
    api.getPublicationState
      .mockResolvedValueOnce(ok({ ...unpublished, linkActive: true, versionNumber: 1 }))
      .mockResolvedValueOnce(ok(null));
    const { container } = await visit();
    // Split across the status line's own elements, so it is read from the container.
    expect(container.textContent).toContain("A link is live showing version 1");
    fireEvent.click(screen.getByRole("button", { name: "Take the link down" }));
    await waitFor(() =>
      expect(screen.getByText(/The link is taken down/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("This invitation has not been published yet.")).toBeInTheDocument(),
    );
    expect(container.textContent).not.toContain("A link is live");
    // With nothing live, there is nothing left to rotate or take down.
    expect(screen.getByRole("button", { name: "Take the link down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New link, same version" })).toBeDisabled();
  });

  it("reports a refusal as the adapter's phrase, alone", async () => {
    api.publishInvitation.mockResolvedValue(fail("this invitation could not be published"));
    await visit();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByText("this invitation could not be published")).toBeInTheDocument());
    expect(screen.queryByText(/It is shown once/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/42501|permission denied|schema|function api\./i);
  });

  it("will not offer a freeze before the invitation has a language", async () => {
    api.getWeddingDesign.mockResolvedValue(ok(designRow({ primaryLanguage: null })));
    await visit();
    expect(freezeButton()).toBeDisabled();
    expect(screen.getByText(/Choose the invitation language/)).toBeInTheDocument();
  });
});

describe("a draft that cannot be opened", () => {
  it("says so without building an editor out of nothing", async () => {
    api.getWeddingDesign.mockResolvedValue(fail("this invitation could not be opened"));
    render(
      <MemoryRouter initialEntries={[`/project/${WEDDING}/edit`]}>
        <Routes>
          <Route path="/project/:id/edit" element={<EditProject />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "This invitation draft could not be opened" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(api.updateDraftContent).not.toHaveBeenCalled();
  });
});

describe("the region a host works in", () => {
  it("names the loaded workbench's content region as the page's main landmark", async () => {
    // §30's accessibility pass measured this page's landmarks as `{main:0, header:1, nav:0}` and
    // handed the reading to §33: the error and loading branches of this page both open a `<main>`,
    // so a screen that only ever reported the gap on the success branch was pointing at the one
    // screen a host actually works on. A landmark test has to be scoped to the loaded page, which
    // is why it waits for `ready()` rather than mounting and looking.
    const { container } = await visit();
    const regions = container.querySelectorAll("main");
    expect(regions).toHaveLength(1);
    // Both halves of the work are inside it: a landmark that covered the canvas but not the panel
    // would leave a keyboard user jumping back out of the region to do half the job.
    expect(regions[0].contains(container.querySelector('section[aria-labelledby="preview-heading"]'))).toBe(true);
    expect(regions[0].querySelector("aside")).not.toBeNull();
    // The sticky toolbar is page chrome, and sits outside — its Save Draft control is found by its
    // own label, so moving it inside the landmark would buy nothing and say something false.
    const save = screen.getByRole("button", { name: "Save Draft" });
    expect(regions[0].contains(save)).toBe(false);
    expect(save).toBeInTheDocument();
  });
});

describe("an invitation standing on a retired release", () => {
  it("names the older release on the strength of the document read alone", async () => {
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({ selectedRelease: RETIRED_SUMMARY }),
    );
    const { container } = await visit();
    // The page had to be told nothing else to say this: one call, one answer, and the notice is
    // that answer's consequence.
    expect(api.previewInvitationDocument).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "This invitation uses an older release of TEST ONLY — Synthetic Reviewed Fixture — release 1",
    );
    expect(container.textContent).toContain("keep showing exactly what they show now");
  });

  it("holds a new freeze back while it keeps the already frozen versions publishable", async () => {
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({ selectedRelease: RETIRED_SUMMARY }),
    );
    await visit();
    expect(freezeButton()).toBeDisabled();
    expect(api.createInvitationVersion).not.toHaveBeenCalled();

    // Retirement reaches forward, never behind: the version frozen while the release was current
    // is still there to publish, and publishing it writes no new wording from the retired one.
    api.publishInvitation.mockResolvedValue(ok({ path: null, linkReused: true }));
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    await waitFor(() => expect(api.publishInvitation).toHaveBeenCalledWith(WEDDING, "v-1"));
  });

  it("says a live link is still live, and says which release it is showing", async () => {
    api.previewInvitationDocument.mockResolvedValue(
      documentOk({ selectedRelease: RETIRED_SUMMARY }),
    );
    api.getPublicationState.mockResolvedValue(
      ok({ ...unpublished, versionNumber: 1, linkActive: true, publishedAt: "2026-09-21T06:00:00+00:00" }),
    );
    await visit();
    // The status line and the older-release notice are two different facts, and neither one is
    // allowed to cancel the other out: the host needs "your guests can still read it" as plainly
    // as they need "do not freeze from this".
    expect(screen.getByText("A link is live")).toBeInTheDocument();
    expect(screen.getByText(/showing version 1/)).toBeInTheDocument();
    expect(screen.getByText(/This invitation uses an older release/)).toBeInTheDocument();
  });

  it("moves onto a newer release only when the host chooses it, and then offers the freeze again", async () => {
    // R1/R2 as §21 sequences it, at the page seam: the wedding is on R1, R2 is approved and
    // selectable, and nothing about the wedding changes until a click. (That V1 keeps its R1
    // credit and a new V2 may be frozen from R2 is the database's claim, walked end to end in
    // `supabase/tests/stage5/`.)
    api.previewInvitationDocument
      .mockResolvedValueOnce(documentOk({ selectedRelease: RETIRED_SUMMARY }))
      .mockResolvedValue(
        documentOk({
          selectedRelease: { ...RETIRED_SUMMARY, releaseNumber: 2, isCurrent: true },
        }),
      );
    api.listSelectableTraditionReleases.mockResolvedValue(ok([catalogueRelease(RELEASE_R2, 2)]));
    api.getSelectedTraditionRelease
      .mockResolvedValueOnce(ok(weddingSelection(RELEASE_R1, 1, true)))
      .mockResolvedValue(ok(weddingSelection(RELEASE_R2, 2, false)));
    const { container } = await visit();

    expect(freezeButton()).toBeDisabled();
    expect(container.textContent).toContain("This invitation uses an older release");
    expect(api.selectTraditionRelease).not.toHaveBeenCalled();
    expect(api.previewInvitationDocument).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("radio", { name: /release 2 — newer release of the one you chose/ }),
    );
    await waitFor(() =>
      expect(api.selectTraditionRelease).toHaveBeenCalledWith(USER, WEDDING, RELEASE_R2),
    );

    // The write is followed by the two reads it invalidates: the panel's own selection, and the
    // document the freeze button's reason came from.
    await waitFor(() => {
      expect(freezeButton()).toBeEnabled();
      expect(screen.getByText(/Chosen: TEST ONLY — Synthetic Reviewed Fixture, release 2/)).toBeInTheDocument();
    });
    expect(api.previewInvitationDocument).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("This invitation uses an older release");
    // No version was written by any of this, and the frozen list was not re-read as though the
    // retirement had touched it.
    expect(api.createInvitationVersion).not.toHaveBeenCalled();
  });
});
