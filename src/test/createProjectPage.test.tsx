// Pilot P4: the two creation screens, read as a customer reads them.
//
// Issue #1's premise is that a feature is not done because a door exists; the mirror of that rule is that a
// screen is not honest because it *looks* modest. Both pages in this file were understating or overstating on
// purpose, and each one was wrong in a way a mock test could never see:
//
//   * `CreateProject.tsx` offered five `primary_language` codes in rollout order and said nothing about what
//     choosing a language no installed pack speaks does. The freeze door reads the languages of the release
//     pinned in the snapshot and raises a blocking `language_not_covered` finding when that release does not
//     include the wedding's language
//     (`supabase/migrations/20260929120000_stage5_pack_driven_authoring_review.sql:1095`), which the
//     publication panel then holds the freeze button back for. The same page also promised "you can change all
//     of it later" when the name and the main language have no editor anywhere in this build (`title` is
//     written only by the INSERT at `src/integrations/supabase/weddings.ts:191`, and while
//     `updatePlanningDetails` can patch both fields — `:207` and `:208` — the only screen that calls it sends
//     `estimatedGuestCount` and nothing else (`src/pages/ConfigureProject.tsx:40-42`)).
//   * `ConfigureProject.tsx` listed family approval, guest lists/RSVP and QR/PDF as "Planned, not part of this
//     draft yet" three stages after those three shipped (`/r/:token`, `/g/:token`, the output panel and
//     `ShareQrPlate`). A truthful-looking caution box that talks customers *out* of using what is in front of
//     them is still a customer-facing lie.
//
// The first repair of the first bullet over-claimed, and this file says so rather than editing that away: it
// printed "cannot be published yet" beside three languages, which is true only of a draft that *attaches a
// pack*. The arm is conditional — it reads the pinned release's `languages` at `:1071` and fires only when
// that value is an array at `:1090`, so a snapshot with no pack raises nothing, and Stage 5's journey A
// measured the no-pack path through the shipped UI all the way to a live guest link
// (`docs/audits/stage-5-pack-driven-authoring-review.md` §25). An invitation with no reviewed pack behind it is
// a draft the host writes themselves, not a draft that cannot be sent, so the sentences here are about pack
// wording and never about the draft's future.
//
// What this tier pins, in that order: the coverage sentence comes from the same door the editor's pack panel
// reads, `null` coverage is a third state that claims nothing, the warning informs without blocking the draft,
// the page states the pack-free path instead of hiding it, and the capability box names features that exist.
// Nothing here re-runs the Stage 5/7/8/9 batteries — those claim the doors work; these cells claim only that
// the pages say the same thing the doors do.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CreateProject from '@/pages/CreateProject';
import ConfigureProject from '@/pages/ConfigureProject';
import type { QueryResult } from '@/integrations/supabase/weddings';

const WEDDING = '2f8a6b1c-0d3e-4a5f-6b7c-8d9e0f1a2b3c';

const api = vi.hoisted(() => ({
  createWedding: vi.fn(),
  listDesignOptions: vi.fn(),
  listSelectableTraditionReleases: vi.fn(),
  getWedding: vi.fn(),
  updatePlanningDetails: vi.fn(),
}));

const authValue = { user: { id: 'host-1', email: 'host@example.test' } as never, signOut: vi.fn() };

vi.mock('@/integrations/supabase/weddings', () => ({
  createWedding: (...a: unknown[]) => api.createWedding(...a),
  listDesignOptions: (...a: unknown[]) => api.listDesignOptions(...a),
  updatePlanningDetails: (...a: unknown[]) => api.updatePlanningDetails(...a),
  getWedding: (...a: unknown[]) => api.getWedding(...a),
  listWeddings: vi.fn(),
}));
vi.mock('@/integrations/supabase/traditionReleases', () => ({
  listSelectableTraditionReleases: (...a: unknown[]) => api.listSelectableTraditionReleases(...a),
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => authValue }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const ok = <T,>(data: T): QueryResult<T> => ({ data, error: null });
const fail = (error: string): QueryResult<never> => ({ data: null, error });

/** A release shaped like `listSelectableTraditionReleases`' own option, because the picker reads
 *  `languages` off it and a fixture that invented a different key would pass against nothing. */
const release = (languages: string[]) => ({
  id: `release-${languages.join('-')}`, packId: 'pack-1', releaseNumber: 1, languages,
});

/** The five codes `LANGUAGES` still lists, in the order the picker prints them. */
const CODES = ['en', 'ta', 'te', 'ml', 'kn'];

/** The label the picker puts beside a language no selectable release speaks — the whole subject of this
 *  tier, and named once here so a cell cannot quietly drift onto a rewording of it. */
const WARN = 'no reviewed pack speaks this language';

const renderCreate = () => render(<MemoryRouter><CreateProject /></MemoryRouter>);

const renderConfigure = () => render(
  <MemoryRouter initialEntries={[`/project/${WEDDING}/configure`]}>
    <Routes>
      <Route path="/project/:id/configure" element={<ConfigureProject />} />
    </Routes>
  </MemoryRouter>,
);

const languageSelect = () => screen.getByLabelText('Main language') as HTMLSelectElement;
/** An option's own rendered text, read off the `select` rather than through a matcher: the warning this
 *  tier cares about is *inside* the option, and `getAllByRole('option')` would have to be indexed by hand. */
const optionText = (code: string): string =>
  Array.from(languageSelect().options).find((option) => option.value === code)?.textContent ?? '';

/** Submit the form with a chosen language and no pack knowledge in the way. */
const createIn = async (code: string) => {
  fireEvent.change(screen.getByLabelText('Invitation name'), { target: { value: 'Priya and Karthik' } });
  fireEvent.change(languageSelect(), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Invitation Draft' }));
  await waitFor(() => expect(api.createWedding).toHaveBeenCalled());
};

/**
 * Waits for the coverage read to land as an answer rather than a question. The marker is the sentence the
 * answered state prints, not the mock call: the effect only *starts* the read synchronously, so a cell that
 * asserted right after `renderCreate()` would be asserting the loading state — which the page genuinely
 * shows, but which none of these cells claims to test.
 */
const covered = () =>
  waitFor(() => expect(document.body.textContent ?? '').toContain('A language marked here'));

beforeEach(() => {
  vi.restoreAllMocks();
  api.listDesignOptions.mockResolvedValue(ok([]));
  api.createWedding.mockResolvedValue({ data: { id: WEDDING }, error: null });
  api.listSelectableTraditionReleases.mockResolvedValue(ok([release(['ta', 'en'])]));
  api.getWedding.mockResolvedValue(ok({
    id: WEDDING, title: 'Priya and Karthik', primaryLanguage: 'ta', estimatedGuestCount: 120,
    designTemplateId: null, createdAt: '2026-10-01T09:00:00+00:00',
  }));
  api.updatePlanningDetails.mockResolvedValue(ok(null));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the main-language picker tells the host what choosing each language does', () => {
  it('still offers the five codes, because narrowing the list would be this page inventing a limit', async () => {
    renderCreate();
    await covered();
    expect(Array.from(languageSelect().options).map((option) => option.value)).toEqual(CODES);
  });

  it('marks a language no installed pack speaks, and leaves one a covered release speaks alone', async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([release(['ta', 'en'])]));
    renderCreate();
    await covered();
    expect(optionText('te')).toContain(WARN);
    expect(optionText('ml')).toContain(WARN);
    expect(optionText('ta')).not.toContain(WARN);
    expect(optionText('en')).not.toContain(WARN);
  });

  it('takes coverage from the union of every selectable release, so two packs can cover two languages between them', async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([
      release(['ta', 'en']), release(['te']),
    ]));
    renderCreate();
    await covered();
    expect(optionText('te')).not.toContain(WARN);
    expect(optionText('kn')).toContain(WARN);
  });

  it('says plainly when no pack is installed at all, and still lets the draft be written', async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([]));
    renderCreate();
    await covered();
    expect(CODES.every((code) => optionText(code).includes(WARN))).toBe(true);
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('No reviewed pack is installed in this build at all');
    expect(text()).toContain('that is enough to publish');
  });

  it('claims nothing about coverage when the coverage read itself failed — knowing is not the same as guessing', async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(fail('the tradition packs could not be loaded'));
    renderCreate();
    // Wait for the *answered* failure state. Asserting the absence of a warning while the page is still
    // reading would pass for the wrong reason.
    await waitFor(() => expect(document.body.textContent ?? '').toContain('could not be read just now'));
    expect(CODES.some((code) => optionText(code).includes(WARN))).toBe(false);
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('could not be read just now');
    // …and the sentence that would be a claim in either direction is absent, not merely hard to match.
    expect(text()).not.toMatch(/no reviewed pack (covers|renders|speaks)/i);
    expect(text()).not.toMatch(/can be published/i);
  });

  it('reads coverage from the same door the editor\'s pack panel reads, once, on mount', async () => {
    renderCreate();
    await waitFor(() => expect(api.listSelectableTraditionReleases).toHaveBeenCalledTimes(1));
    expect(api.listSelectableTraditionReleases).toHaveBeenCalledWith();
  });

  it('warns about the pack and never about the draft: no sentence here says the invitation cannot be published', async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([release(['ta', 'en'])]));
    renderCreate();
    await covered();
    // The warning fires, so this is not a cell that passes because nothing was printed…
    expect(optionText('te')).toContain(WARN);
    // …and the thing printed is about reviewed pack wording, not about the host being unable to send.
    expect(CODES.some((code) => /cannot be published|can.?not be sent/i.test(optionText(code)))).toBe(false);
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('writing it yourself still works');
    expect(text()).toContain('publishing your own wording does not need a pack');
    expect(text()).not.toMatch(/draft written in it cannot be published/i);
  });

  it('does not block a draft in an uncovered language: the warning informs and the chosen code still crosses', async () => {
    api.listSelectableTraditionReleases.mockResolvedValue(ok([release(['ta', 'en'])]));
    renderCreate();
    await covered();
    expect(optionText('te')).toContain(WARN);
    await createIn('te');
    expect(api.createWedding).toHaveBeenCalledWith('host-1', expect.objectContaining({
      title: 'Priya and Karthik', primaryLanguage: 'te',
    }));
  });

  it('drops the retired promise that everything can be changed later, and names the two things that cannot', async () => {
    renderCreate();
    const text = () => document.body.textContent ?? '';
    await waitFor(() => expect(text()).toContain('The wording'));
    expect(text()).not.toMatch(/you can change all of it later/i);
    expect(text()).toContain('the name and the main language are not');
    // The claim is about this build, so it must not survive as a claim about the data either: no screen in
    // `src/` writes `weddings.title` after the INSERT, which is what makes the sentence worth pinning.
    expect(text()).toContain('no screen that changes them once a draft exists');
  });
});

describe("the configure screen's capability box matches what the shipped product does", () => {
  const box = async () => {
    renderConfigure();
    const heading = await screen.findByText('What this build does, and what it does not');
    return heading.parentElement?.textContent ?? '';
  };

  it('lists the four host capabilities that have screens, rather than calling them future work', async () => {
    const words = await box();
    expect(words).toContain('publish it as a link your guests open');
    expect(words).toContain('their own link and read the replies');
    expect(words).toContain('family reviewer');
    expect(words).toContain('QR plate');
    expect(words).toContain('support message');
  });

  it('retires the box that talked customers out of features they can already use', async () => {
    renderConfigure();
    await screen.findByText('What this build does, and what it does not');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Planned, not part of this draft yet/);
    expect(text).not.toMatch(/directions for the product, not capabilities of this build/);
    expect(text).not.toMatch(/Family approval of a specific version/);
  });

  it('keeps the three things the pilot genuinely does not do, in the same box', async () => {
    const words = await box();
    expect(words).toContain('this pilot is free and there is no checkout');
    expect(words).toContain('Emailing your guests for you');
    expect(words).toContain('a person handles');
    expect(words).toContain('Nothing on this page can be purchased or activated.');
  });

  it('still refuses to pretend the guest count is a guest list or a bill', async () => {
    renderConfigure();
    await screen.findByText('What this build does, and what it does not');
    expect(screen.getByText('Estimated guests')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('It is not a guest list');
  });
});
