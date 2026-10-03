// The editor laid out by a release, tested against a release's declaration.
//
// §19's whole claim is that the host's screen stops owning the invitation's structure: the
// order, the requirement and the three wording rules arrive from `api.preview_invitation_document`
// as the AUTHORING DECLARATION, and this component only asks a declared section which control
// belongs to it. So the assertions are about *who decided what is on the screen*. Each one
// changes a fact in the declaration and reads back the consequence — a rule that removes a
// field, a `requires_venue` that adds a sentence, a list kind that mounts the row editor that
// already existed.
//
// The row editors are the real ones, driven by the real hook over a stubbed adapter, because
// "reuse the existing people editor" is only proven if the actual `PeopleGroup` is what shows
// up. The stub answers reads only; the write loop is `contentEditor.test.tsx`'s subject.
//
// The invitations are built as the projection builds them, through `parsePublicInvitation`, so a
// section's heading and provenance are read from a parsed document rather than from a
// hand-written render shape. A declaration and a document that disagreed would be an impossible
// pair, so `withDocument` below builds them together from one list.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type {
  CeremonyEntry,
  PersonEntry,
  VenueEntry,
} from "@/integrations/supabase/weddingContent";
import type { InvitationDraftContent } from "@/integrations/supabase/weddings";

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

import AuthoringOutline from "@/components/invitation/AuthoringOutline";
import { useWeddingContentRows } from "@/components/invitation/ContentEditor";
import { guestInvitation } from "@/test/invitationFixture";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import { BUILT_IN_AUTHORING } from "@/lib/invitationAuthoring";
import type { AuthoringSection } from "@/integrations/supabase/publication";
import type { PackHostField, PackSectionKey } from "@/lib/traditionPackContract";

const WEDDING = "33333333-3333-4333-8333-333333333333";

const PEOPLE: PersonEntry[] = [
  { id: "p1", displayName: "Arun Kumar", roleLabel: "Groom", groupLabel: null, displayOrder: 0 },
];
const VENUES: VenueEntry[] = [
  { id: "v1", name: "Sri Kanchi Mahal", addressText: "12 Temple Street", mapUrl: null },
];
const CEREMONIES: CeremonyEntry[] = [
  {
    id: "c1",
    displayName: "Muhurtham",
    startsAtLocal: "2026-11-14T07:30:00",
    endsAtLocal: null,
    timezone: "Asia/Kolkata",
    venueId: "v1",
    displayOrder: 0,
    enabled: true,
  },
];

beforeEach(() => {
  Object.values(api).forEach(fn => fn.mockReset());
  const ok = <T,>(data: T[]) => Promise.resolve({ data, error: null });
  api.listPeople.mockImplementation(() => ok([...PEOPLE]));
  api.listVenues.mockImplementation(() => ok([...VENUES]));
  api.listCeremonies.mockImplementation(() => ok([...CEREMONIES]));
});

// --------------------------------------------------------------------------- declarations

/** One entry of a release's declaration, in the shape the adapter types it. */
const declared = (
  sectionKey: PackSectionKey,
  kind: AuthoringSection['kind'],
  options: {
    required?: boolean;
    hostField?: PackHostField | null;
    overrideRule?: AuthoringSection['overrideRule'];
    requiresVenue?: boolean | null;
  } = {},
): AuthoringSection => ({
  sectionKey,
  kind,
  position: 0,
  required: options.required ?? false,
  hostField: options.hostField ?? null,
  overrideRule: options.overrideRule ?? null,
  requiresVenue: options.requiresVenue ?? null,
});

/** The matching projection entry: a text section carries a body where the release supplies
 *  wording or the host wrote over it, and a list section carries only its heading. Written in the
 *  projection's own snake_case, because that is the layer being mirrored. */
const projected = (
  section: AuthoringSection,
  index: number,
  wording: { heading: string | null; packText: string | null },
  draft: Record<PackHostField, string | null>,
) => {
  const hostText = section.hostField === null ? null : draft[section.hostField];
  return {
    section_key: section.sectionKey,
    position: index + 1,
    kind: section.kind,
    required: section.required,
    host_field: section.hostField,
    heading:
      wording.heading === null
        ? null
        : { text: wording.heading, language: 'ta', fallback_used: false },
    body:
      section.kind !== 'text'
        ? null
        : hostText !== null
          ? {
              source: 'host',
              text: hostText,
              language: null,
              fallback_used: null,
              overrode_pack_text: wording.packText !== null,
            }
          : wording.packText === null
            ? null
            : {
                source: 'reviewed_pack',
                text: wording.packText,
                language: 'ta',
                fallback_used: false,
                overrode_pack_text: false,
              },
  };
};

const EMPTY_DRAFT: Record<PackHostField, string | null> = {
  welcome: null,
  family_introduction: null,
  event_notes: null,
  closing: null,
};

interface DocumentOptions {
  /** The release's own heading and reviewed wording, per slot. */
  readonly wording?: Partial<
    Record<PackSectionKey, { heading?: string | null; packText?: string | null }>
  >;
  readonly draft?: Partial<Record<PackHostField, string | null>>;
}

/** The declaration and the document built from it, so the two cannot disagree about a heading, a
 *  body's source, or which slot a section writes. */
const withDocument = (
  declaration: AuthoringSection[],
  options: DocumentOptions = {},
): { invitation: PublicInvitation; draft: InvitationDraftContent } => {
  const draft = { ...EMPTY_DRAFT, ...options.draft };
  const items = declaration.map((section, index) => {
    // A slot the test says nothing about is a slot with neither a heading nor reviewed wording,
    // which is what the projection writes for it — not a missing field a later read has to guess.
    const wording = options.wording?.[section.sectionKey];
    return projected(
      section,
      index,
      { heading: wording?.heading ?? null, packText: wording?.packText ?? null },
      draft,
    );
  });
  const invitation = parsePublicInvitation({
    available: true,
    invitation: {
      ...guestInvitation({ language: 'ta', draft }),
      sections: { requested: 'ta', items },
    },
  });
  if (invitation === null) throw new Error('the test built a document the parser refuses');
  return {
    invitation,
    draft: {
      welcome: draft.welcome,
      familyIntroduction: draft.family_introduction,
      eventNotes: draft.event_notes,
      closing: draft.closing,
    },
  };
};

// --------------------------------------------------------------------------- harness

interface HarnessProps {
  authoring: AuthoringSection[];
  invitation: PublicInvitation;
  /** The draft the page starts on; the harness then holds it, the way `EditProject` does, so a
   *  typed field is still typed on the next render. */
  draft: InvitationDraftContent;
  onDraftChange?: (value: InvitationDraftContent) => void;
  disabled?: boolean;
}

const Harness = ({ authoring, invitation, draft, onDraftChange, disabled = false }: HarnessProps) => {
  const [held, setHeld] = useState(draft);
  const rows = useWeddingContentRows({ weddingId: WEDDING, onContentChanged: () => {} });
  return (
    <AuthoringOutline
      authoring={authoring}
      invitation={invitation}
      draft={held}
      onDraftChange={value => {
        setHeld(value);
        onDraftChange?.(value);
      }}
      rows={rows}
      disabled={disabled}
    />
  );
};

const openOutline = async (props: HarnessProps) => {
  const result = render(<Harness {...props} />);
  // The row lists arrive after the first paint, and only where the declaration mounted a group —
  // so the wait is on the loading lines rather than on a name, which a release with no people
  // list would never show.
  await waitFor(() => expect(screen.queryAllByText(/^Loading the /)).toHaveLength(0));
  return result;
};

/** The blocks in the order the screen put them, by the anchors a finding links to. */
const blockOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[id^="authoring-"]')).map(el => el.id);

const blockOf = (container: HTMLElement, sectionKey: string): HTMLElement =>
  container.querySelector(`#authoring-${sectionKey}`) as HTMLElement;

// --------------------------------------------------------------------------- the order

describe("the release's own order", () => {
  it("lays the controls out in the declared sequence, not the platform's", async () => {
    const declaration = [
      declared('blessing', 'text'),
      declared('family', 'people_list'),
      declared('welcome', 'text', { hostField: 'welcome', overrideRule: 'host_may_replace' }),
      declared('ceremonies', 'event_list'),
      declared('closing', 'text', { hostField: 'closing', overrideRule: 'pack_only' }),
    ];
    const { invitation, draft } = withDocument(declaration);
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(blockOrder(container)).toEqual([
      'authoring-blessing',
      'authoring-family',
      'authoring-welcome',
      'authoring-ceremonies',
      'authoring-closing',
    ]);
  });

  it("names a section with the heading the release wrote for it", async () => {
    const declaration = [declared('blessing', 'text')];
    const { invitation, draft } = withDocument(declaration, {
      wording: {
        blessing: { heading: '[placeholder heading from the release]', packText: '[placeholder wording]' },
      },
    });
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(within(blockOf(container, 'blessing')).getByRole('heading', { level: 3 })).toHaveTextContent(
      '[placeholder heading from the release]',
    );
  });

  it("says so when a release declares nothing, instead of inventing a field", async () => {
    const { invitation, draft } = withDocument([]);
    const { container } = await openOutline({ authoring: [], invitation, draft });
    expect(container).toHaveTextContent('declares no sections');
    expect(container.querySelector('textarea')).toBeNull();
  });
});

// --------------------------------------------------------------------------- the three rules

describe("a section whose wording may not be replaced", () => {
  const declaration = [
    declared('welcome', 'text', { hostField: 'welcome', overrideRule: 'pack_only' }),
  ];
  const wording = {
    welcome: { heading: 'The opening', packText: '[placeholder wording the host keeps]' },
  };

  it("shows the reviewed line and offers no field that implies a replacement is accepted", async () => {
    const { invitation, draft } = withDocument(declaration, { wording });
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    const block = blockOf(container, 'welcome');
    expect(within(block).getByText('[placeholder wording the host keeps]')).toBeInTheDocument();
    expect(block.querySelector('textarea')).toBeNull();
    expect(within(block).getByText(/does not accept a replacement/)).toBeInTheDocument();
  });

  it("warns that the host's earlier line is stored and unused, and offers nothing that could empty it", async () => {
    const onDraftChange = vi.fn();
    const { invitation, draft } = withDocument(declaration, {
      wording,
      draft: { welcome: 'A line this host wrote under an earlier release' },
    });
    const { container } = await openOutline({
      authoring: declaration,
      invitation,
      draft,
      onDraftChange,
    });
    const block = blockOf(container, 'welcome');
    expect(within(block).getByRole('status')).toHaveTextContent(
      'The opening keeps the wording your chosen pack supplies, whatever you wrote here earlier. Nothing you wrote has been deleted — your own line is simply not used by this release.',
    );
    // Non-destructive, in the only sense a screen can promise: no control that could clear the
    // stored line is offered, and none is used.
    expect(block.querySelector('textarea')).toBeNull();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("names the section, never its machine key", async () => {
    const { invitation, draft } = withDocument(declaration, {
      wording,
      draft: { welcome: 'An earlier line' },
    });
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(blockOf(container, 'welcome')).toHaveTextContent('The opening keeps the wording');
    expect(blockOf(container, 'welcome').textContent).not.toContain('welcome keeps');
  });

  it("says nothing about an unused line when the host never wrote one", async () => {
    const { invitation, draft } = withDocument(declaration, { wording });
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(blockOf(container, 'welcome')).not.toHaveTextContent(/not used by this release/);
  });

  it("does not call a stored field of spaces a line the host wrote", async () => {
    const { invitation, draft } = withDocument(declaration, {
      wording,
      draft: { welcome: '   ' },
    });
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(blockOf(container, 'welcome')).not.toHaveTextContent(/Nothing you wrote has been deleted/);
  });

  it("admits the section has no wording when none was supplied", async () => {
    const { invitation, draft } = withDocument(declaration);
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(blockOf(container, 'welcome')).toHaveTextContent('Nothing supplies this section yet.');
  });
});

describe("a section the host may rewrite", () => {
  const declaration = [
    declared('welcome', 'text', { hostField: 'welcome', overrideRule: 'host_may_replace' }),
    declared('closing', 'text', { hostField: 'closing', overrideRule: 'host_may_replace' }),
  ];

  it("shows the pack's line beside the field while the field is empty", async () => {
    const { invitation, draft } = withDocument(declaration, {
      wording: { welcome: { heading: null, packText: '[placeholder wording]' } },
    });
    await openOutline({ authoring: declaration, invitation, draft });
    expect(screen.getByLabelText('The opening')).toHaveValue('');
    expect(screen.getByText("Your pack's wording, used while this field is empty")).toBeInTheDocument();
    expect(screen.getByText('[placeholder wording]')).toBeInTheDocument();
  });

  it("distinguishes the pack's wording from the host's once the host has written", async () => {
    const { invitation, draft } = withDocument(declaration, {
      wording: { welcome: { heading: null, packText: '[placeholder wording]' } },
      draft: { welcome: 'Our own words' },
    });
    await openOutline({ authoring: declaration, invitation, draft });
    expect(screen.getByLabelText('The opening')).toHaveValue('Our own words');
    expect(screen.getByText(/Your own words are on the page here/)).toBeInTheDocument();
  });

  it("writes only the slot its own host field names", async () => {
    const { invitation, draft } = withDocument(declaration);
    const onDraftChange = vi.fn();
    await openOutline({ authoring: declaration, invitation, draft, onDraftChange });
    fireEvent.change(screen.getByLabelText('The opening'), { target: { value: 'Typed' } });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      welcome: 'Typed',
      familyIntroduction: null,
      eventNotes: null,
      closing: null,
    });
    fireEvent.change(screen.getByLabelText('The last words'), { target: { value: 'Bye' } });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      welcome: 'Typed',
      familyIntroduction: null,
      eventNotes: null,
      closing: 'Bye',
    });
    fireEvent.change(screen.getByLabelText('The last words'), { target: { value: '' } });
    // An emptied slot is `null`, not `''`: "wrote nothing" and "wrote a blank line" differ.
    expect(onDraftChange).toHaveBeenLastCalledWith({
      welcome: 'Typed',
      familyIntroduction: null,
      eventNotes: null,
      closing: null,
    });
  });

  it("leaves every field disabled while a save is in flight", async () => {
    const { invitation, draft } = withDocument(declaration);
    await openOutline({ authoring: declaration, invitation, draft, disabled: true });
    expect(screen.getByLabelText('The opening')).toBeDisabled();
    expect(screen.getByLabelText('The last words')).toBeDisabled();
  });
});

describe("a section only the host can supply", () => {
  const declaration = [
    declared('event_notes', 'text', {
      hostField: 'event_notes',
      overrideRule: 'host_must_supply',
      required: true,
    }),
  ];

  it("offers the field, states that no wording exists, and shows the requirement", async () => {
    const { invitation, draft } = withDocument(declaration);
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    const block = blockOf(container, 'event_notes');
    expect(within(block).getByLabelText('A note about the ceremonies')).toBeInTheDocument();
    expect(within(block).getByText(/no wording is supplied for it/)).toBeInTheDocument();
    expect(
      within(block).getByText(
        'Required by your chosen pack: a version cannot be frozen while this is empty.',
      ),
    ).toBeInTheDocument();
    expect(within(block).queryByText(/wording, used while this field is empty/)).toBeNull();
  });
});

// --------------------------------------------------------------------------- the lists

describe("a list section", () => {
  it("reuses the people editor the platform already had, with no pack-specific copy", async () => {
    const declaration = [declared('family', 'people_list', { required: true })];
    const { invitation, draft } = withDocument(declaration);
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    const block = blockOf(container, 'family');
    expect(within(block).getByRole('heading', { level: 3, name: 'The people' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Add a person' })).toBeInTheDocument();
    expect(await within(block).findByText('Arun Kumar')).toBeInTheDocument();
    expect(
      within(block).getByText(
        'Required by your chosen pack: a version cannot be frozen while this is empty.',
      ),
    ).toBeInTheDocument();
    // The group's own intro, unchanged — no release-specific sentence was bolted onto it.
    expect(within(block).getByText(/no role is guessed from a name/)).toBeInTheDocument();
  });

  it("mounts the venue editor once, at the event list, and states the venue requirement in general words", async () => {
    const declaration = [declared('ceremonies', 'event_list', { requiresVenue: true })];
    const { invitation, draft } = withDocument(declaration);
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    const block = blockOf(container, 'ceremonies');
    expect(block.querySelectorAll('[id="venues-heading"]')).toHaveLength(1);
    expect(block.querySelectorAll('[id="ceremonies-heading"]')).toHaveLength(1);
    expect(within(block).getByRole('button', { name: 'Add a venue' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Add a ceremony' })).toBeInTheDocument();
    expect(
      within(block).getByText('Your chosen pack asks every ceremony below to have a venue.'),
    ).toBeInTheDocument();
  });

  it("does not ask for a venue when the release does not", async () => {
    const declaration = [declared('ceremonies', 'event_list', { requiresVenue: false })];
    const { invitation, draft } = withDocument(declaration);
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(container).not.toHaveTextContent(/asks every ceremony/);
  });
});

// --------------------------------------------------------------------------- no pack, and no leaks

describe("a wedding with no pack", () => {
  it("keeps the manual editor it always had and imposes no new requirement", async () => {
    const { invitation, draft } = withDocument(BUILT_IN_AUTHORING, {
      draft: { welcome: 'With the blessings of our elders' },
    });
    const { container } = await openOutline({ authoring: BUILT_IN_AUTHORING, invitation, draft });
    expect(screen.getByLabelText('The opening')).toHaveValue('With the blessings of our elders');
    for (const label of ['Who is inviting', 'A note about the ceremonies', 'The last words']) {
      expect(screen.getByLabelText(label).tagName).toBe('TEXTAREA');
    }
    // Nothing about the no-pack layout gained a requirement, a pack sentence or a heading.
    expect(container).not.toHaveTextContent('Required by your chosen pack');
    expect(container).not.toHaveTextContent('pack');
    expect(container).toHaveTextContent('The people');
    expect(container).toHaveTextContent('The ceremonies');
  });
});

describe("what the screen never prints", () => {
  it("prints no machine key, rule word or section identifier", async () => {
    const declaration = [
      declared('blessing', 'text'),
      declared('family_introduction', 'text', {
        hostField: 'family_introduction',
        overrideRule: 'host_may_replace',
      }),
      declared('event_notes', 'text', {
        hostField: 'event_notes',
        overrideRule: 'host_must_supply',
        required: true,
      }),
      declared('family', 'people_list', { required: true }),
      declared('ceremonies', 'event_list', { requiresVenue: true }),
    ];
    const { invitation, draft } = withDocument(declaration, {
      wording: {
        blessing: { heading: null, packText: '[placeholder blessing]' },
        family_introduction: { heading: null, packText: '[placeholder family line]' },
      },
    });
    const { container } = await openOutline({ authoring: declaration, invitation, draft });
    expect(container.textContent ?? '').not.toMatch(
      /family_introduction|event_notes|host_may_replace|host_must_supply|pack_only|reviewed_pack|requires_venue|override_rule|section_key/,
    );
  });
});
