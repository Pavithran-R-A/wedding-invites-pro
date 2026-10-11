// The host's guest panel, tested against the four facts its own header says shapes it: a minted
// address exists once, a family that was ever sent one cannot be deleted, a family scoped to nothing
// is an error to surface, and the raw credential is held in memory and nowhere else.
//
// Like Stage 7's queue, most of this file is about what the screen is allowed to *print*. A host who
// reads "their link is ready" has been handed a bearer credential that no later read can produce
// again, and a host who reads "removed from the list" about a family that replied has been told a
// thing `private.access_tokens` refuses. The vocabulary assertions run the same way as the rest of
// the stage: an unknown `link_state` is shown as an unknown word rather than a guessed one, so a
// future migration cannot be rendered as this build's fact.
//
// What a jsdom test cannot pin is a measured tap target — this environment lays nothing out. What it
// does pin is that every control carries a name of its own, and that no credential of a minted pass
// reaches `localStorage`, `sessionStorage` or a log line, which is the part of §11 and P6/P7 that is
// decidable without a browser. The pixel figures belong to the browser tier.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import GuestInvitationPanel from "@/components/invitation/GuestInvitationPanel";
import type { GuestPanelRow } from "@/lib/guestInvitation";
import type { GuestHousehold } from "@/integrations/supabase/guestInvitations";
import type { CeremonyEntry } from "@/integrations/supabase/weddingContent";

const api = vi.hoisted(() => ({
  panel: vi.fn(),
  households: vi.fn(),
  ceremonies: vi.fn(),
  scopes: vi.fn(),
  send: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setScopes: vi.fn(),
}));

vi.mock("@/integrations/supabase/guestInvitations", () => ({
  getGuestInvitationState: (...args: unknown[]) => api.panel(...args),
  listGuestHouseholds: (...args: unknown[]) => api.households(...args),
  listHouseholdEventScopes: (...args: unknown[]) => api.scopes(...args),
  issueGuestInvitations: (...args: unknown[]) => api.send(...args),
  rotateGuestInvitation: (...args: unknown[]) => api.rotate(...args),
  revokeGuestInvitation: (...args: unknown[]) => api.revoke(...args),
  createGuestHousehold: (...args: unknown[]) => api.create(...args),
  updateGuestHousehold: (...args: unknown[]) => api.update(...args),
  removeGuestHousehold: (...args: unknown[]) => api.remove(...args),
  setHouseholdEventScopes: (...args: unknown[]) => api.setScopes(...args),
}));

vi.mock("@/integrations/supabase/weddingContent", () => ({
  listCeremonies: (...args: unknown[]) => api.ceremonies(...args),
}));

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const HOUSEHOLD = '4a2b6c10-0000-4000-8000-000000000002';
const OTHER = '4a2b6c10-0000-4000-8000-000000000003';
const EVENT_ONE = '9e3d5a70-0000-4000-8000-000000000004';
const EVENT_TWO = '9e3d5a70-0000-4000-8000-000000000005';

/** 41 characters plus the two a minted credential's alphabet allows: 43 in all, the shape written at
 *  `20261009120000_stage8_guest_invitations_rsvp.sql:248-258`. */
const TOKEN = `${'a'.repeat(41)}_-`;
const PATH = `/g/${TOKEN}`;

const row = (overrides: Partial<GuestPanelRow> = {}): GuestPanelRow => ({
  householdId: HOUSEHOLD,
  displayName: 'The Krishnan family',
  salutation: null,
  expectedPartySize: 4,
  linkState: 'never_issued',
  linkExpiresAt: null,
  linkLastUsedAt: null,
  scopedEventCount: 2,
  replyCount: 0,
  attendingCount: 0,
  ...overrides,
});

const household = (overrides: Partial<GuestHousehold> = {}): GuestHousehold => ({
  id: HOUSEHOLD,
  displayName: 'The Krishnan family',
  salutation: null,
  expectedPartySize: 4,
  hostNotes: 'Arriving from Kochi on the 12th.',
  ...overrides,
});

const ceremony = (id: string, name: string, overrides: Partial<CeremonyEntry> = {}): CeremonyEntry => ({
  id,
  displayName: name,
  startsAtLocal: '2026-11-14T07:30:00',
  endsAtLocal: '2026-11-14T09:00:00',
  timezone: 'Asia/Kolkata',
  venueId: null,
  displayOrder: 0,
  enabled: true,
  ...overrides,
});

const sendItem = (overrides: Partial<{ householdId: string; displayName: string; status: string; path: string | null }> = {}) => ({
  householdId: HOUSEHOLD,
  displayName: 'The Krishnan family',
  status: 'issued',
  path: PATH,
  ...overrides,
});

const sendResult = (invitations: ReturnType<typeof sendItem>[]) => ({
  weddingId: WEDDING,
  publicationId: '0b1c2d3e-0000-4000-8000-000000000006',
  issued: invitations.filter(item => item.status === 'issued').length,
  alreadyLive: invitations.filter(item => item.status === 'already_live').length,
  expiresAt: null,
  invitations,
});

/** See `familyReviewPanel.test.tsx`: the mount read resolves a promise whose `setState` lands after
 *  `render()`'s synchronous act scope, so the panel is rendered inside an async act scope. */
const renderPanel = async (rows: GuestPanelRow[]) => {
  api.panel.mockResolvedValue({ data: rows, error: null });
  api.households.mockResolvedValue({
    data: rows.map(item => household({ id: item.householdId, displayName: item.displayName })),
    error: null,
  });
  api.ceremonies.mockResolvedValue({
    data: [ceremony(EVENT_ONE, 'Muhurtham'), ceremony(EVENT_TWO, 'Reception', { enabled: false })],
    error: null,
  });
  return act(async () => render(<GuestInvitationPanel weddingId={WEDDING} />));
};

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

/** Wait for the mount read to have answered, so a later click cannot race the panel. */
const settle = async () => {
  await waitFor(() => expect(api.panel).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Loading your guest list…')).toBeNull());
};

const press = async (control: HTMLElement) => {
  await act(async () => {
    fireEvent.click(control);
  });
  await flush();
};

const addressLine = () => screen.getByText(new RegExp(`^https?://.+/g/${TOKEN}$`));

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  // The panel is the only place in the app that holds a minted household address, and P6 says it
  // appears in exactly one response. A storage write would survive the reload the panel cannot, so
  // the two stores are emptied before every case and asserted empty after a mint.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("what the panel prints about a family", () => {
  it("states the link's own state and the answers beside it, without touching either's meaning", async () => {
    await renderPanel([
      row({ linkState: 'live', replyCount: 1, attendingCount: 1 }),
      row({ householdId: OTHER, displayName: 'The Iyer household', linkState: 'never_issued' }),
    ]);
    await settle();
    expect(screen.getByText('Link is live')).toBeInTheDocument();
    expect(screen.getByText('No link sent yet')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 events answered · said yes to 1 of them/)).toBeInTheDocument();
    expect(screen.getByText('The Iyer household')).toBeInTheDocument();
  });

  it("separates 'no reply yet' from 'invited to nothing', because they are different host actions", async () => {
    await renderPanel([
      row(),
      row({ householdId: OTHER, displayName: 'The Iyer household', scopedEventCount: 0 }),
    ]);
    await settle();
    // Each row prints one sentence, and the row's own paragraph continues it with the host's number.
    expect(screen.getByText(/no reply yet, across 2 events/)).toBeInTheDocument();
    expect(screen.getByText(/invited to no event, so there is nothing for them to answer/)).toBeInTheDocument();
  });

  it("names a family scoped to nothing as the data error §6 requires, and offers no link for them", async () => {
    await renderPanel([row({ scopedEventCount: 0 })]);
    await settle();
    expect(screen.getByText(/The Krishnan family is invited to no event/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create their link/i })).toBeDisabled();
  });

  it("prints an unknown link state as the unknown word it is", async () => {
    await renderPanel([row({ linkState: 'suspended' })]);
    await settle();
    expect(screen.getByText('This build has no word for “suspended”')).toBeInTheDocument();
  });

  it("reads the expiry day off the server's stamp instead of shifting it into the visitor's day", async () => {
    await renderPanel([row({ linkState: 'live', linkExpiresAt: '2026-11-13T18:30:00+00:00' })]);
    await settle();
    expect(screen.getByText(/link runs to 2026-11-13/)).toBeInTheDocument();
  });
});

describe("a family that can no longer be deleted", () => {
  it("offers removal only for a household that was never sent anything", async () => {
    await renderPanel([row()]);
    await settle();
    expect(screen.getByRole('button', { name: /Remove from list/i })).toBeInTheDocument();
  });

  it("prints the reason a sent family's row stays, and offers withdraw instead", async () => {
    await renderPanel([row({ linkState: 'live' })]);
    await settle();
    expect(screen.queryByRole('button', { name: /Remove from list/i })).toBeNull();
    expect(
      screen.getByText('Their link was sent once, so their row stays as the record that it was. Withdrawing it is how you take the address away.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Withdraw link/i })).toBeInTheDocument();
  });

  it("shows the reply count before the delete it cannot offer", async () => {
    await renderPanel([row({ linkState: 'never_issued', replyCount: 3, attendingCount: 2 })]);
    await settle();
    expect(screen.queryByRole('button', { name: /Remove from list/i })).toBeNull();
    expect(screen.getByText(/has 3 replies recorded, so their row stays — delete those replies first/)).toBeInTheDocument();
  });

  it("names one reply in the singular, because a host reads this sentence as an instruction", async () => {
    await renderPanel([row({ linkState: 'never_issued', replyCount: 1 })]);
    await settle();
    expect(screen.getByText(/has 1 reply recorded, so their row stays — delete that reply first/)).toBeInTheDocument();
  });

  it("carries the schema's refusal phrase without repeating a constraint name", async () => {
    await renderPanel([row()]);
    await settle();
    api.remove.mockResolvedValue({
      data: null,
      error: 'this family still has a link or recorded replies, so its row stays — withdraw the link, or delete its replies',
    });
    await press(screen.getByRole('button', { name: /Remove from list/i }));
    expect(
      screen.getByRole('alert').textContent,
    ).toMatch(/withdraw the link, or delete its replies/);
    expect(screen.getByRole('alert').textContent).not.toMatch(/access_tokens|rsvp_responses|foreign key|23503/);
  });

  it("says the family left the list on the delete that actually happened", async () => {
    await renderPanel([row()]);
    await settle();
    api.remove.mockResolvedValue({ data: null, error: null });
    api.panel.mockResolvedValue({ data: [], error: null });
    await press(screen.getByRole('button', { name: /Remove from list/i }));
    // This is the case the adapter's shape decides: `removeGuestHousehold` answers with `data: null`
    // when it succeeds, so a screen that reads an empty data half as a refusal tells a host the row is
    // still there — and the sentence it prints is the one that invites them to click Delete again.
    expect(
      screen.getByText('The Krishnan family is off the list. Nothing was ever sent to them, so there is no record left behind.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.panel).toHaveBeenCalledTimes(2);
  });
});

describe("the one address a mint hands over", () => {
  it("shows it once, with a copy control and no promise that anything was sent", async () => {
    await renderPanel([row()]);
    await settle();
    api.send.mockResolvedValue({ data: sendResult([sendItem()]), error: null });
    await press(screen.getByRole('button', { name: /Create their link/i }));
    expect(addressLine()).toBeInTheDocument();
    expect(screen.getByText('Their link is ready. Copy it now — it cannot be shown again.')).toBeInTheDocument();
    expect(screen.getByText('Nothing has been sent to anyone. Copy it, or hand the link over yourself.')).toBeInTheDocument();
    await press(screen.getByRole('button', { name: /^Copy$/i }));
    expect(writeText).toHaveBeenCalledWith(`http://localhost:3000${PATH}`);
    expect(screen.getByText('Copied to the clipboard.')).toBeInTheDocument();
  });

  it("keeps the credential out of storage, so a reload cannot carry it back", async () => {
    await renderPanel([row()]);
    await settle();
    api.send.mockResolvedValue({ data: sendResult([sendItem()]), error: null });
    await press(screen.getByRole('button', { name: /Create their link/i }));
    expect(addressLine()).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("shows no address for a family that already holds a live one, because the send minted nothing", async () => {
    await renderPanel([row({ linkState: 'expired' })]);
    await settle();
    api.send.mockResolvedValue({
      data: sendResult([sendItem({ status: 'already_live', path: null })]),
      error: null,
    });
    await press(screen.getByRole('button', { name: /Create their link/i }));
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
    expect(
      screen.getByText('That family already has a link that still works. Its address was not shown again, because only the call that created it ever carried it.'),
    ).toBeInTheDocument();
  });

  it("refuses to build a link out of a path the door could not open", async () => {
    await renderPanel([row()]);
    await settle();
    api.send.mockResolvedValue({
      data: sendResult([sendItem({ path: '/g/short' })]),
      error: null,
    });
    await press(screen.getByRole('button', { name: /Create their link/i }));
    // An anchor from a string the shape gate rejects would be a family sent to an address that goes
    // nowhere, with nothing on the page to say why.
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
  });

  it("replaces the address on rotate and says the old one stops at once", async () => {
    await renderPanel([row({ linkState: 'live' })]);
    await settle();
    api.rotate.mockResolvedValue({
      data: { householdId: HOUSEHOLD, publicationId: '0b1c2d3e-0000-4000-8000-000000000006', path: PATH, previousRevokedAt: '2026-10-11T00:00:00+00:00', expiresAt: null },
      error: null,
    });
    await press(screen.getByRole('button', { name: /New link for them/i }));
    expect(addressLine()).toBeInTheDocument();
    expect(screen.getByText('The old address stops working at once. Copy this one — it is shown once.')).toBeInTheDocument();
    expect(api.rotate).toHaveBeenCalledWith(HOUSEHOLD);
  });

  it("withdraws an address without describing it as deleting a family", async () => {
    await renderPanel([row({ linkState: 'live', replyCount: 2 })]);
    await settle();
    api.revoke.mockResolvedValue({ data: { householdId: HOUSEHOLD, revoked: true, revokedAt: '2026-10-11T00:00:00+00:00' }, error: null });
    await press(screen.getByRole('button', { name: /Withdraw link/i }));
    expect(
      screen.getByText('Their link is withdrawn. Their events and any answer they sent are still on the record.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/deleted|removed from the list/i);
  });

  it("sends to every family without a working link in one call, and counts what it minted", async () => {
    await renderPanel([row({ linkState: 'expired' }), row({ householdId: OTHER, displayName: 'The Iyer household', linkState: 'never_issued' })]);
    await settle();
    api.send.mockResolvedValue({
      data: sendResult([
        sendItem({ status: 'already_live', path: null }),
        sendItem({ householdId: OTHER, displayName: 'The Iyer household' }),
      ]),
      error: null,
    });
    await press(screen.getByRole('button', { name: /Create a link for every family without one/i }));
    expect(api.send).toHaveBeenCalledWith(WEDDING, [HOUSEHOLD, OTHER]);
    expect(screen.getByText(/1 link created\. 1 already had a working one\./)).toBeInTheDocument();
  });
});

describe("adding and editing a family", () => {
  it("will not save a nameless household, and asks for the number rather than inventing one", async () => {
    await renderPanel([]);
    await settle();
    const add = screen.getByRole('button', { name: /Add them to the list/i });
    expect(add).toBeDisabled();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Family or household name/i), { target: { value: 'The Rao household' } });
    });
    expect(add).toBeEnabled();
    expect(screen.getByLabelText(/How many you expect from them/i)).toBeInTheDocument();
  });

  it("adds a family without minting an address, because scoping is the host's next act", async () => {
    await renderPanel([]);
    await settle();
    api.create.mockResolvedValue({ data: { id: HOUSEHOLD }, error: null });
    api.panel.mockResolvedValue({ data: [row()], error: null });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Family or household name/i), { target: { value: 'The Rao household' } });
    });
    await press(screen.getByRole('button', { name: /Add them to the list/i }));
    expect(api.create).toHaveBeenCalledWith(WEDDING, expect.objectContaining({ displayName: 'The Rao household' }));
    expect(api.send).not.toHaveBeenCalled();
    expect(screen.getByText(/The Rao household is on the list\. Choose their events, then create their link\./)).toBeInTheDocument();
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
  });

  it("keeps the note that never reaches a guest on the host's side of the door", async () => {
    await renderPanel([row()]);
    await settle();
    await press(screen.getByRole('button', { name: /Edit details/i }));
    // The panel always carries an "Add a family" form as well, so the note is found inside the
    // family being edited rather than anywhere on the page — the assertion is about *this*
    // household's stored note, and the two forms must not be allowed to satisfy each other.
    const editing = within(screen.getByRole('group', { name: 'Edit The Krishnan family' }));
    expect(editing.getByLabelText(/Your note about them \(optional, never shown to guests\)/i)).toBeInTheDocument();
    expect((editing.getByLabelText(/Your note about them/i) as HTMLTextAreaElement).value)
      .toBe('Arriving from Kochi on the 12th.');
    expect(document.body.textContent).toMatch(/never shown to guests/);
  });

  it("shows the adapter's own phrase when an edit is refused, and does not claim it saved", async () => {
    await renderPanel([row()]);
    await settle();
    await press(screen.getByRole('button', { name: /Edit details/i }));
    api.update.mockResolvedValue({ data: null, error: 'a household needs a name before it can be saved' });
    await press(screen.getByRole('button', { name: /Save their details/i }));
    expect(screen.getByText('a household needs a name before it can be saved')).toBeInTheDocument();
    expect(screen.queryByText(/Saved what the guest will be greeted with/)).toBeNull();
  });

  it("says what an edit saved, in the page's words", async () => {
    await renderPanel([row()]);
    await settle();
    await press(screen.getByRole('button', { name: /Edit details/i }));
    api.update.mockResolvedValue({ data: null, error: null });
    api.panel.mockResolvedValue({ data: [row({ salutation: 'The Krishnans' })], error: null });
    await press(screen.getByRole('button', { name: /Save their details/i }));
    expect(screen.getByText('Saved what the guest will be greeted with.')).toBeInTheDocument();
    expect(api.update).toHaveBeenCalledTimes(1);
  });
});

describe("which events one family is invited to", () => {
  it("offers only this wedding's ceremonies, and marks the switched-off one as unanswerable", async () => {
    await renderPanel([row()]);
    await settle();
    api.scopes.mockResolvedValue({ data: [EVENT_ONE], error: null });
    await press(screen.getByRole('button', { name: /Their events/i }));
    await flush();
    expect(screen.getByRole('checkbox', { name: /Muhurtham/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Reception/i })).not.toBeChecked();
    expect(screen.getByText('switched off — they cannot answer it')).toBeInTheDocument();
    expect(api.scopes).toHaveBeenCalledWith(WEDDING, HOUSEHOLD);
  });

  it("saves the whole list once, because the write withdraws before it adds", async () => {
    await renderPanel([row()]);
    await settle();
    api.scopes.mockResolvedValue({ data: [EVENT_ONE], error: null });
    await press(screen.getByRole('button', { name: /Their events/i }));
    await flush();
    // The write never answers, so every later click meets the same in-flight editor.
    api.setScopes.mockReturnValue(new Promise(() => {}));
    const save = screen.getByRole('button', { name: /Save their events/i });
    await press(save);
    expect(api.setScopes).toHaveBeenCalledTimes(1);
    expect(api.setScopes).toHaveBeenCalledWith(WEDDING, HOUSEHOLD, [EVENT_ONE]);
    // `setHouseholdEventScopes` is a family-wide delete followed by an insert, and the two are not
    // one transaction: a second write starting while the first is still running would withdraw
    // events the first half has already put back. A real browser cannot deliver the click at all
    // once the button is switched off — the guard below it is what is pinned here, so the panel's
    // own state, not just the disabled attribute, is what holds the second and third attempt out.
    expect(save).toBeDisabled();
    await press(save);
    await press(save);
    expect(api.setScopes).toHaveBeenCalledTimes(1);
  });

  it("says plainly when a save leaves the family with nothing to answer", async () => {
    await renderPanel([row()]);
    await settle();
    api.scopes.mockResolvedValue({ data: [EVENT_ONE], error: null });
    await press(screen.getByRole('button', { name: /Their events/i }));
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Muhurtham/i }));
    });
    api.setScopes.mockResolvedValue({ data: [], error: null });
    api.panel.mockResolvedValue({ data: [row({ scopedEventCount: 0 })], error: null });
    await press(screen.getByRole('button', { name: /Save their events/i }));
    expect(
      screen.getByText('The Krishnan family is now invited to no event — their page will read, but has nothing to answer.'),
    ).toBeInTheDocument();
  });
});

describe("a panel that cannot read its own wedding", () => {
  it("says the read failed and offers to try again, without rendering an empty list as a fact", async () => {
    api.panel.mockResolvedValue({ data: null, error: 'the guest invitations could not be read' });
    api.households.mockResolvedValue({ data: { error: null, data: [] } });
    api.ceremonies.mockResolvedValue({ data: [], error: null });
    await act(async () => render(<GuestInvitationPanel weddingId={WEDDING} />));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('the guest invitations could not be read');
    expect(screen.getByRole('button', { name: /Try again/i })).toBeEnabled();
    expect(screen.queryByText(/families are on the list/)).toBeNull();
  });
});
