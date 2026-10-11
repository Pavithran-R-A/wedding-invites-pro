// The reply list, and the host's own hand in it.
//
// Most of what this panel promises is about provenance rather than presentation. `response_source` is
// the database's distinction between a family's own answer and the host's transcription of a phone
// call (`20260925120500_stage2_rls_and_grants.sql:278-294` enforces it in a WITH CHECK arm), and once
// two rows carry the same family and the same event, the screen has to say which is which or the host
// is reading a merged fact that no row holds. §7's ruling — the honest way to correct a family's
// answer is delete then record, never a silent overwrite — is therefore the load-bearing assertion in
// this file: a guest's row gets a delete button and nothing else.
//
// The rest is the shape of the manual entry: the event list comes from that household's scopes so the
// form cannot offer a choice the composite key would refuse, a decline answers with no headcount, and
// a number the panel cannot trust is switched off rather than rounded. `expected_party_size` bounds a
// guest, never the host (§7's asymmetry), so no case here expects a cap.
//
// What jsdom cannot pin is layout; what it can pin is that the row list is one row per answer, that an
// unfamiliar vocabulary word is printed as itself, and that no invitation address reaches this screen
// at all — the reply list has no reason to carry one.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import GuestRepliesPanel from "@/components/invitation/GuestRepliesPanel";
import type { GuestReply } from "@/integrations/supabase/guestInvitations";

const api = vi.hoisted(() => ({
  replies: vi.fn(),
  households: vi.fn(),
  ceremonies: vi.fn(),
  scopes: vi.fn(),
  record: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/integrations/supabase/guestInvitations", () => ({
  listGuestReplies: (...args: unknown[]) => api.replies(...args),
  listGuestHouseholds: (...args: unknown[]) => api.households(...args),
  listHouseholdEventScopes: (...args: unknown[]) => api.scopes(...args),
  recordManualReply: (...args: unknown[]) => api.record(...args),
  removeGuestReply: (...args: unknown[]) => api.remove(...args),
}));

vi.mock("@/integrations/supabase/weddingContent", () => ({
  listCeremonies: (...args: unknown[]) => api.ceremonies(...args),
}));

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const HOUSEHOLD = '4a2b6c10-0000-4000-8000-000000000002';
const OTHER = '4a2b6c10-0000-4000-8000-000000000003';
const MUHURTHAM = '9e3d5a70-0000-4000-8000-000000000004';
const RECEPTION = '9e3d5a70-0000-4000-8000-000000000005';
const REPLY = 'c5d6e7f8-0000-4000-8000-000000000007';

const reply = (overrides: Partial<GuestReply> = {}): GuestReply => ({
  id: REPLY,
  householdId: HOUSEHOLD,
  eventId: MUHURTHAM,
  attending: 'attending',
  partySize: 3,
  responseSource: 'guest',
  respondedAt: '2026-10-04T13:22:00+00:00',
  ...overrides,
});

const ceremony = (id: string, displayName: string) => ({
  id,
  displayName,
  startsAtLocal: '2026-11-14T07:30:00',
  endsAtLocal: '2026-11-14T09:00:00',
  timezone: 'Asia/Kolkata',
  venueId: null,
  displayOrder: 0,
  enabled: true,
});

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

const settle = async () => {
  await waitFor(() => expect(api.replies).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Loading replies…')).toBeNull());
};

const press = async (control: HTMLElement) => {
  await act(async () => {
    fireEvent.click(control);
  });
  await flush();
};

const type = async (field: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(field, { target: { value } });
  });
};

/** Choose a family, then let their scoped-event read answer before returning. */
const chooseFamily = async (householdId: string) => {
  await type(screen.getByLabelText(/Which family\?/i), householdId);
  await flush();
};

const chooseAnswer = async (name: RegExp) => {
  await press(screen.getByRole('radio', { name }));
};

const renderPanel = async (
  replies: GuestReply[],
  options: { scopes?: string[]; households?: { id: string; displayName: string }[] } = {},
) => {
  api.replies.mockResolvedValue({ data: replies, error: null });
  api.households.mockResolvedValue({
    data: options.households ?? [
      { id: HOUSEHOLD, displayName: 'The Krishnan family', salutation: 'The Krishnans', expectedPartySize: 4, hostNotes: null },
      { id: OTHER, displayName: 'The Iyer household', salutation: null, expectedPartySize: null, hostNotes: null },
    ],
    error: null,
  });
  api.ceremonies.mockResolvedValue({
    data: [ceremony(MUHURTHAM, 'Muhurtham'), ceremony(RECEPTION, 'Reception')],
    error: null,
  });
  api.scopes.mockResolvedValue({ data: options.scopes ?? [MUHURTHAM], error: null });
  return act(async () => render(<GuestRepliesPanel weddingId={WEDDING} />));
};

/** The manual form, addressed by its own legend rather than by the page. */
const manualForm = () => within(screen.getByRole('group', { name: 'Write in an answer they gave you' }));

beforeEach(() => {
  vi.clearAllMocks();
  api.record.mockResolvedValue({ data: { id: REPLY }, error: null });
  api.remove.mockResolvedValue({ data: null, error: null });
});

describe("whose answer a row is", () => {
  it("prints the two sources as two sentences, never one merged fact", async () => {
    await renderPanel([
      reply(),
      reply({ id: `${REPLY.slice(0, 22)}8`, householdId: OTHER, responseSource: 'host_manual' }),
    ]);
    await settle();
    expect(screen.getByText(/they sent it themselves/)).toBeInTheDocument();
    expect(screen.getByText(/you recorded it/)).toBeInTheDocument();
  });

  it("prints an unfamiliar source as the unknown word it is, rather than claiming either author", async () => {
    await renderPanel([reply({ responseSource: 'imported' })]);
    await settle();
    expect(
      screen.getByText(/recorded by a route this build has no word for \(“imported”\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/they sent it themselves/)).toBeNull();
    expect(screen.queryByText(/you recorded it/)).toBeNull();
  });

  it("reads the answer's day off the server's stamp instead of shifting it into the host's day", async () => {
    await renderPanel([reply({ respondedAt: '2026-10-04T23:40:00+00:00' })]);
    await settle();
    expect(screen.getByText(/2026-10-04/)).toBeInTheDocument();
  });

  it("names the family and the event, and shows no identifier for either", async () => {
    await renderPanel([reply({ householdId: '00000000-0000-4000-8000-0000000000ff' })]);
    await settle();
    expect(screen.getByText('a family')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/00000000-0000-4000-8000-0000000000ff/);
  });

  it("says nothing about a link, because the reply list has no business carrying an address", async () => {
    await renderPanel([reply()]);
    await settle();
    expect(document.body.textContent).not.toMatch(/\/g\/|https?:\/\//);
  });
});

describe("what an answer reads as", () => {
  it("counts guests for a yes, in the singular for one", async () => {
    await renderPanel([reply({ partySize: 1 })]);
    await settle();
    expect(screen.getByText(/coming · 1 guest ·/)).toBeInTheDocument();
  });

  it("gives a decline no headcount, because zero is what the door writes too", async () => {
    await renderPanel([reply({ attending: 'declined', partySize: 0 })]);
    await settle();
    expect(screen.getByText(/not coming · they sent it themselves/)).toBeInTheDocument();
    expect(screen.queryByText(/0 guests/)).toBeNull();
  });

  it("prints an answer word this build has no radio for as the family's own word", async () => {
    await renderPanel([reply({ attending: 'maybe', partySize: 2 })]);
    await settle();
    expect(screen.getByText(/recorded as “maybe” · 2/)).toBeInTheDocument();
  });

  it("lists one line per answer, because a family answers per event and nothing is summed", async () => {
    await renderPanel([
      reply({ id: `${REPLY.slice(0, 22)}1` }),
      reply({ id: `${REPLY.slice(0, 22)}2`, eventId: RECEPTION, partySize: 2 }),
    ]);
    await settle();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/coming · 3 guests/)).toBeInTheDocument();
    expect(screen.getByText(/coming · 2 guests/)).toBeInTheDocument();
    // Two rows for one family are printed as two rows. Nothing here adds a household's answers into
    // a headcount, which is the arithmetic §7 keeps on the guest's side of the door.
    expect(document.body.textContent).not.toMatch(/· 5 guests/);
  });

  it("says so when nobody has answered, without hiding the manual form", async () => {
    await renderPanel([]);
    await settle();
    expect(
      screen.getByText(/Nobody has answered yet\. When a family replies on their own link it appears here/),
    ).toBeInTheDocument();
    expect(manualForm().getByLabelText(/Which family\?/i)).toBeInTheDocument();
  });
});

describe("a guest's own answer", () => {
  it("offers a delete and no editor, because a silent overwrite is what the policy refuses", async () => {
    await renderPanel([reply()]);
    await settle();
    const row = screen.getAllByRole('listitem')[0];
    expect(within(row).getByRole('button', { name: /^Delete$/i })).toBeInTheDocument();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(within(row).queryByRole('combobox')).toBeNull();
    expect(within(row).queryByRole('radio')).toBeNull();
    expect(within(row).queryByRole('button', { name: /edit|save|correct/i })).toBeNull();
  });

  it("states the two-step correction the screen relies on, in the same breath as the form", async () => {
    await renderPanel([reply()]);
    await settle();
    expect(
      screen.getByText(/If a family already answered on their link and told you something different by phone, delete their reply above and record this one\./),
    ).toBeInTheDocument();
  });

  it("says their link still works after deleting what they sent, because nothing about the link moved", async () => {
    await renderPanel([reply()]);
    await settle();
    api.replies.mockResolvedValue({ data: [], error: null });
    await press(screen.getByRole('button', { name: /^Delete$/i }));
    expect(api.remove).toHaveBeenCalledWith(WEDDING, REPLY);
    expect(
      screen.getByText(/^Deleted what The Krishnan family sent for Muhurtham\. Their link still works, so they can answer again — and if they told you something else by phone, record that now\./),
    ).toBeInTheDocument();
  });

  it("keeps the shorter sentence for deleting its own entry", async () => {
    await renderPanel([reply({ responseSource: 'host_manual' })]);
    await settle();
    api.replies.mockResolvedValue({ data: [], error: null });
    await press(screen.getByRole('button', { name: /^Delete$/i }));
    expect(screen.getByText('Deleted your own entry for The Krishnan family at Muhurtham.')).toBeInTheDocument();
  });

  it("prints the adapter's refusal when a delete fails, and re-reads rather than dropping the row", async () => {
    await renderPanel([reply()]);
    await settle();
    api.remove.mockResolvedValue({ data: null, error: 'the replies could not be saved' });
    await press(screen.getByRole('button', { name: /^Delete$/i }));
    expect(screen.getByRole('alert').textContent).toBe('the replies could not be saved');
    expect(screen.queryByText(/^Deleted/)).toBeNull();
    await settle();
    expect(api.replies).toHaveBeenCalledTimes(2);
  });
});

describe("writing in an answer they gave by phone", () => {
  it("asks for the family before the event, because a scope is a fact about them", async () => {
    await renderPanel([reply()]);
    await settle();
    expect(
      manualForm().getByText(/Choose the family first — you can only record an answer for an event they were invited to\./),
    ).toBeInTheDocument();
    expect(api.scopes).not.toHaveBeenCalled();
  });

  it("reads that family's scopes and offers only the events they were invited to", async () => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    expect(api.scopes).toHaveBeenCalledWith(WEDDING, HOUSEHOLD);
    const event = manualForm().getByLabelText(/Which event of theirs\?/i) as HTMLSelectElement;
    const offered = [...event.options].map(option => option.textContent?.trim());
    expect(offered).toEqual(['Choose an event', 'Muhurtham']);
    expect(offered).not.toContain('Reception');
  });

  it("says plainly when the family has no events to be recorded against, and names where to fix it", async () => {
    await renderPanel([reply()], { scopes: [] });
    await settle();
    await chooseFamily(HOUSEHOLD);
    expect(
      manualForm().getByText(/That family is invited to no event, so there is nothing to record\. Set their events under/),
    ).toBeInTheDocument();
    expect(manualForm().getByText('Guest invitations')).toBeInTheDocument();
    expect(manualForm().queryByLabelText(/Which event of theirs\?/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Record their answer/i })).toBeDisabled();
  });

  it("records the family, the event, the answer and their word for the number, exactly as typed", async () => {
    await renderPanel([reply()]);
    await settle();
    api.replies.mockResolvedValue({ data: [reply(), reply({ id: `${REPLY.slice(0, 22)}9`, eventId: RECEPTION })], error: null });
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    await chooseAnswer(/They are coming/i);
    await type(screen.getByLabelText(/How many, as they told you\?/i), '7');
    await press(screen.getByRole('button', { name: /Record their answer/i }));
    expect(api.record).toHaveBeenCalledWith(WEDDING, {
      householdId: HOUSEHOLD, eventId: MUHURTHAM, attending: 'attending', partySize: 7,
    });
    // 7 is above the household's own expectation of 4, and nothing here objects: §7's asymmetry.
    expect(screen.getByText('Recorded for The Krishnan family.')).toBeInTheDocument();
    expect(api.replies).toHaveBeenCalledTimes(2);
  });

  it("clears the form after a recorded answer so the next entry cannot inherit it", async () => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    await chooseAnswer(/They are coming/i);
    await type(screen.getByLabelText(/How many, as they told you\?/i), '2');
    await press(screen.getByRole('button', { name: /Record their answer/i }));
    expect((manualForm().getByLabelText(/Which family\?/i) as HTMLSelectElement).value).toBe('');
    // The number field belongs to a yes, so its absence is itself the sign that no answer is held.
    expect(screen.queryByLabelText(/How many, as they told you\?/i)).toBeNull();
    expect(screen.getByRole('radio', { name: /They are coming/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /They are not coming/i })).not.toBeChecked();
  });

  it("writes no number for a decline, whatever was typed before the answer was changed", async () => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    await chooseAnswer(/They are coming/i);
    await type(screen.getByLabelText(/How many, as they told you\?/i), '5');
    await chooseAnswer(/They are not coming/i);
    expect(screen.queryByLabelText(/How many, as they told you\?/i)).toBeNull();
    await press(screen.getByRole('button', { name: /Record their answer/i }));
    expect(api.record).toHaveBeenCalledWith(WEDDING, {
      householdId: HOUSEHOLD, eventId: MUHURTHAM, attending: 'declined', partySize: 0,
    });
  });

  it("asks for the number only once the answer is a yes", async () => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    expect(screen.queryByLabelText(/How many, as they told you\?/i)).toBeNull();
    await chooseAnswer(/They are coming/i);
    expect(
      screen.getByText(/This field is not held to what you expected of them/),
    ).toBeInTheDocument();
  });

  it.each([
    ['empty', ''],
    ['a fraction', '2.5'],
    ['a negative', '-3'],
    ['a space', ' '],
  ])("keeps Record switched off for %s, because a number this screen cannot read is not an answer", async (_label, value) => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    await chooseAnswer(/They are coming/i);
    await type(screen.getByLabelText(/How many, as they told you\?/i), value);
    expect(screen.getByRole('button', { name: /Record their answer/i })).toBeDisabled();
    expect(api.record).not.toHaveBeenCalled();
  });

  it("refuses to record before an event and an answer exist, not merely before a number does", async () => {
    await renderPanel([reply()]);
    await settle();
    expect(screen.getByRole('button', { name: /Record their answer/i })).toBeDisabled();
    await chooseFamily(HOUSEHOLD);
    expect(screen.getByRole('button', { name: /Record their answer/i })).toBeDisabled();
    expect(api.record).not.toHaveBeenCalled();
  });

  it("prints the schema's refusal when a scope was taken away elsewhere, and re-reads the list", async () => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    await chooseAnswer(/They are coming/i);
    await type(screen.getByLabelText(/How many, as they told you\?/i), '2');
    api.record.mockResolvedValue({
      data: null,
      error: 'that family is not invited to that event, so the answer cannot be recorded',
    });
    await press(screen.getByRole('button', { name: /Record their answer/i }));
    expect(screen.getByRole('alert').textContent)
      .toBe('that family is not invited to that event, so the answer cannot be recorded');
    expect(screen.queryByText(/^Recorded for/)).toBeNull();
    // The draft stays put so the host can act on the sentence, and the list is re-read because the
    // scopes that caused the refusal are a fact the screen no longer holds.
    expect((manualForm().getByLabelText(/Which family\?/i) as HTMLSelectElement).value).toBe(HOUSEHOLD);
    await settle();
    expect(api.replies).toHaveBeenCalledTimes(2);
  });

  it("carries whatever wording the adapter refuses with, and claims no save beside it", async () => {
    await renderPanel([reply()]);
    await settle();
    await chooseFamily(HOUSEHOLD);
    await type(manualForm().getByLabelText(/Which event of theirs\?/i), MUHURTHAM);
    await chooseAnswer(/They are coming/i);
    await type(screen.getByLabelText(/How many, as they told you\?/i), '2');
    api.record.mockResolvedValue({ data: null, error: 'the number of guests must be a whole number' });
    await press(screen.getByRole('button', { name: /Record their answer/i }));
    expect(screen.getByRole('alert').textContent).toBe('the number of guests must be a whole number');
    expect(screen.queryByText(/^Recorded for/)).toBeNull();
  });
});

describe("a list that could not be read", () => {
  it("says the read failed and offers to try again, without claiming nobody answered", async () => {
    api.replies.mockResolvedValue({ data: null, error: 'the replies could not be loaded' });
    await act(async () => render(<GuestRepliesPanel weddingId={WEDDING} />));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('the replies could not be loaded');
    expect(screen.getByRole('button', { name: /Try again/i })).toBeEnabled();
    expect(screen.queryByText(/Nobody has answered yet/)).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it("re-reads when the host asks it to", async () => {
    api.replies.mockResolvedValue({ data: null, error: 'the replies could not be loaded' });
    await act(async () => render(<GuestRepliesPanel weddingId={WEDDING} />));
    await flush();
    api.replies.mockResolvedValue({ data: [reply()], error: null });
    await press(screen.getByRole('button', { name: /Try again/i }));
    await settle();
    expect(screen.getByText(/they sent it themselves/)).toBeInTheDocument();
    expect(api.replies).toHaveBeenCalledTimes(2);
  });
});
