// The host's workbench, tested as a person who is typing.
//
// What is at stake on this page is a promise about timing: what the host sees is what a
// guest will get *once they save and publish*, and nothing before that. So the assertions
// below are mostly about the gap between the screen and the rows — an unsaved paragraph
// must be visible and must be labelled as unsaved, a freeze must refuse that paragraph,
// and a failure must leave the words on screen.
//
// The three adapter modules are mocked, which is the honest seam for this file: what the
// page asks the database for is qualified over real PostgREST in `supabase/tests/api/`,
// and what an adapter does with an answer is qualified in `weddingQueries.test.tsx`,
// `weddingContentQueries.test.ts` and `publicInvitationTransport.test.ts`. Re-stubbing the
// transport here would test the mock. `InvitationRenderer` is deliberately real, because
// the point of §U is that this page draws with the guest's renderer and not a copy of it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { parsePublicInvitation } from "@/lib/publicInvitation";
import { guestPayload } from "@/test/invitationFixture";
import type {
  InvitationDraftContent,
  StoredInvitationVersion,
  WeddingDesign,
} from "@/integrations/supabase/weddings";
import type { PublicationState } from "@/integrations/supabase/publication";

const USER = "11111111-1111-4111-8111-111111111111";
const WEDDING = "33333333-3333-4333-8333-333333333333";
const DESIGN = "44444444-4444-4444-8444-444444444444";
const TOKEN = "abcdefghijabcdefghijabcdefghijabcdefghijabcde";

const api = vi.hoisted(() => ({
  getWeddingDesign: vi.fn(),
  getDraftContent: vi.fn(),
  listInvitationVersions: vi.fn(),
  updateStyleSettings: vi.fn(),
  updateDraftContent: vi.fn(),
  previewInvitation: vi.fn(),
  createInvitationVersion: vi.fn(),
  getPublicationState: vi.fn(),
  publishInvitation: vi.fn(),
  rotateInvitationLink: vi.fn(),
  revokeInvitationPublication: vi.fn(),
  listPeople: vi.fn(),
  listVenues: vi.fn(),
  listCeremonies: vi.fn(),
}));

vi.mock("@/integrations/supabase/weddings", () => ({
  EMPTY_DRAFT_CONTENT: { welcome: null, familyIntroduction: null, eventNotes: null, closing: null },
  getWeddingDesign: (...a: unknown[]) => api.getWeddingDesign(...a),
  getDraftContent: (...a: unknown[]) => api.getDraftContent(...a),
  listInvitationVersions: (...a: unknown[]) => api.listInvitationVersions(...a),
  updateStyleSettings: (...a: unknown[]) => api.updateStyleSettings(...a),
  updateDraftContent: (...a: unknown[]) => api.updateDraftContent(...a),
}));

vi.mock("@/integrations/supabase/publication", () => ({
  previewInvitation: (...a: unknown[]) => api.previewInvitation(...a),
  createInvitationVersion: (...a: unknown[]) => api.createInvitationVersion(...a),
  getPublicationState: (...a: unknown[]) => api.getPublicationState(...a),
  publishInvitation: (...a: unknown[]) => api.publishInvitation(...a),
  rotateInvitationLink: (...a: unknown[]) => api.rotateInvitationLink(...a),
  revokeInvitationPublication: (...a: unknown[]) => api.revokeInvitationPublication(...a),
}));

// The three row lists arrive empty: this page's contract is the draft text, the styling and
// the publication gesture. `contentEditor.test.tsx` is where the rows themselves are tested,
// and `weddingContentQueries.test.ts` where what the adapter sends is proved.
vi.mock("@/integrations/supabase/weddingContent", () => {
  const unused = vi.fn();
  return {
    listPeople: (...a: unknown[]) => api.listPeople(...a),
    listVenues: (...a: unknown[]) => api.listVenues(...a),
    listCeremonies: (...a: unknown[]) => api.listCeremonies(...a),
    createPerson: unused,
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

const visit = async () => {
  const result = render(
    <MemoryRouter initialEntries={[`/project/${WEDDING}/edit`]}>
      <Routes>
        <Route path="/project/:id/edit" element={<EditProject />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Share with guests" })).toBeInTheDocument());
  return result;
};

const status = () => screen.getByRole("status");

beforeEach(() => {
  api.getWeddingDesign.mockReset().mockResolvedValue(ok(designRow()));
  api.getDraftContent.mockReset().mockResolvedValue(ok(savedDraft));
  api.listInvitationVersions.mockReset().mockResolvedValue(ok([frozenVersion]));
  api.updateStyleSettings.mockReset().mockResolvedValue(ok(null));
  api.updateDraftContent.mockReset().mockResolvedValue(ok(savedDraft));
  api.previewInvitation.mockReset().mockResolvedValue(ok(parsePublicInvitation(guestPayload())));
  api.createInvitationVersion.mockReset();
  api.getPublicationState.mockReset().mockResolvedValue(ok(unpublished));
  api.publishInvitation.mockReset();
  api.rotateInvitationLink.mockReset();
  api.revokeInvitationPublication.mockReset();
  api.listPeople.mockReset().mockResolvedValue(ok([]));
  api.listVenues.mockReset().mockResolvedValue(ok([]));
  api.listCeremonies.mockReset().mockResolvedValue(ok([]));
});

describe("what the host is shown while editing", () => {
  it("draws the guest's own renderer, fed by the server's projection", async () => {
    const { container } = await visit();
    // The document on the canvas is the one `api.preview_invitation` built, so the names,
    // ceremonies and venues are the rows' content and not this page's invention.
    expect(container.textContent).toContain("Sri Kanchi Mahal");
    expect(container.textContent).toContain("Wedding ceremony");
    expect(api.previewInvitation).toHaveBeenCalledWith(WEDDING);
  });

  it("mounts the row editor for this wedding's people, venues and ceremonies", async () => {
    await visit();
    // The workbench is the only place a host can put a grandmother's name into the
    // invitation, so the page has to carry the section rather than a link to it.
    expect(screen.getByRole("heading", { level: 2, name: "People, venues and ceremonies" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a venue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a ceremony" })).toBeInTheDocument();
    expect(api.listPeople).toHaveBeenCalledWith(WEDDING);
    expect(api.listVenues).toHaveBeenCalledWith(WEDDING);
    expect(api.listCeremonies).toHaveBeenCalledWith(WEDDING);
  });

  it("shows typing at once and says it is not saved yet", async () => {
    const { container } = await visit();
    expect(container.textContent).not.toContain("Please come early for the aarthi");
    fireEvent.change(screen.getByLabelText("A note about the ceremonies"), {
      target: { value: "Please come early for the aarthi" },
    });
    expect(container.textContent).toContain("Please come early for the aarthi");
    expect(screen.getByText(/Draft preview — unsaved changes shown/)).toBeInTheDocument();
    expect(status()).toHaveTextContent("Unsaved changes");
    // Local until Save: typing spends no request.
    expect(api.updateDraftContent).not.toHaveBeenCalled();
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
    await waitFor(() => expect(api.previewInvitation).toHaveBeenCalledTimes(2));
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
    fireEvent.click(screen.getByRole("button", { name: /Freeze this draft/ }));
    expect(api.createInvitationVersion).not.toHaveBeenCalled();
    expect(screen.getByText(/a version freezes what is saved, not what is on screen/)).toBeInTheDocument();
  });

  it("freezes a clean draft and names the version it made", async () => {
    api.createInvitationVersion.mockResolvedValue(ok({ id: "v-2", versionNumber: 2 }));
    await visit();
    fireEvent.click(screen.getByRole("button", { name: /Freeze this draft/ }));
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
    expect(screen.getByRole("button", { name: /Freeze this draft/ })).toBeDisabled();
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
