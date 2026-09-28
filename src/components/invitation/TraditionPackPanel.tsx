// Which reviewed release this invitation borrows its structure from — and the explicit
// choice not to borrow anything.
//
// Three rules decided the shape of this panel.
//
//   * It writes one column and nothing else. A choice here is
//     `UPDATE weddings SET tradition_pack_release_id = …` on the host's own wedding, through
//     `traditionReleases.ts`; the release row itself is content-maintenance territory and this
//     file has no path to it. So a host cannot edit the wording they are being offered, which
//     is the whole of what makes that wording reviewable in the first place.
//   * Approval is not re-checked here. `weddings_pack_release_gate` refuses a selection of
//     anything that is not approved at the moment of the write, and the freeze-time trigger
//     refuses a new version from a release retired since. A client-side lifecycle test would
//     look like the guarantee while being a filter anyone could edit, so a refusal arrives as
//     the adapter's phrase and is printed as one.
//   * Nothing about the review is shown. The panel names the pack, its release number, the
//     languages it covers and the scope statement that sits on the concept row — and stops.
//     `review_label`, `review_basis`, `review_scope` and who reviewed it are not selected by
//     the adapter at all (see the header of `traditionReleases.ts`), and directive §12 keeps
//     them off the customer surface: a host needs to know what a pack covers, not to be told
//     to trust a reviewer they cannot verify. For the same reason the wording here never calls
//     a pack "reviewed": the catalogue is filtered to releases whose status is `approved`, but
//     an approval is a governance record this surface deliberately does not display, so
//     describing it on a screen would be a claim about a person the host cannot check.
//
// "No tradition pack" is an option rather than the absence of one, because writing everything
// yourself is a decision the platform should let a host make on purpose.

import { useCallback, useEffect, useState } from 'react';
import {
  clearTraditionRelease,
  getSelectedTraditionRelease,
  listSelectableTraditionReleases,
  selectTraditionRelease,
  type SelectedTraditionRelease,
  type TraditionReleaseOption,
} from '@/integrations/supabase/traditionReleases';
import { TRADITION_PACK_DEFINITION_SCHEMA_VERSION } from '@/lib/traditionPackContract';
import { LANGUAGES } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

const NO_PACK = 'none';

/** A language code the release carries, spoken in the words the planning page already uses.
 *  An unfamiliar code prints as itself: a pack that covers a language this build has never
 *  heard of is still a pack that claims to cover it, and renaming it to nothing would be
 *  this panel's invention rather than the release's. */
const languageLabel = (code: string): string => {
  const known = LANGUAGES.find(language => language.code === code);
  return known === undefined ? code : known.label;
};

export interface TraditionPackPanelProps {
  userId: string;
  weddingId: string;
  /** The lines the chosen release is currently supplying wording for, in the host's own
   *  field names. Read off the server's projection by the page rather than resolved from the
   *  pinned definition here, so the hint can only ever name wording the document actually
   *  carries — and disappears once the host has replaced it with their own. */
  suppliedSlotLabels: string[];
  /** Re-read the projection after a choice, so the canvas is the document the new selection
   *  resolves to rather than the one the old selection produced. */
  onSelectionChanged: () => void;
}

const TraditionPackPanel = ({
  userId,
  weddingId,
  suppliedSlotLabels,
  onSelectionChanged,
}: TraditionPackPanelProps) => {
  const [options, setOptions] = useState<TraditionReleaseOption[]>([]);
  const [selected, setSelected] = useState<SelectedTraditionRelease | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [catalogue, selection] = await Promise.all([
      listSelectableTraditionReleases(),
      getSelectedTraditionRelease(userId, weddingId),
    ]);
    const phrases = [catalogue.error, selection.error].filter((phrase): phrase is string => phrase !== null);
    if (catalogue.data) setOptions(catalogue.data);
    if (selection.error === null) setSelected(selection.data);
    // One phrase, the first one: two failures are one fact to the host ("the packs could not
    // be loaded"), and a list of server sentences is what the adapter layer exists to prevent.
    if (phrases.length > 0) setLoadError(phrases[0]);
    else setLoaded(true);
  }, [userId, weddingId]);

  useEffect(() => {
    setLoaded(false);
    setLoadError(null);
    void load();
  }, [load]);

  const choose = async (releaseId: string | null) => {
    setPendingChoice(releaseId ?? NO_PACK);
    setWriteError(null);
    const result = releaseId === null
      ? await clearTraditionRelease(userId, weddingId)
      : await selectTraditionRelease(userId, weddingId, releaseId);
    setPendingChoice(null);
    if (result.error !== null) {
      // The radio is controlled by `selected`, which this failed write left alone, so the
      // choice the host clicked is simply not shown as the current one. Nothing here pretends
      // a column the database refused has changed.
      setWriteError(result.error);
      return;
    }
    const refreshed = await getSelectedTraditionRelease(userId, weddingId);
    if (refreshed.error === null) setSelected(refreshed.data);
    onSelectionChanged();
  };

  const currentId = selected === null ? NO_PACK : selected.id;
  const busy = pendingChoice !== null;

  const optionRow = (option: TraditionReleaseOption) => {
    const isCurrent = option.id === currentId;
    return (
      <label
        key={option.id}
        className={`flex cursor-pointer gap-2 rounded-lg border p-3 transition-colors ${
          isCurrent ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <input
          type="radio"
          name="tradition-pack-release"
          value={option.id}
          checked={isCurrent}
          disabled={busy}
          onChange={() => { void choose(option.id); }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="min-w-0 space-y-1">
          <span className="block text-xs font-medium">
            {option.packDisplayName}
            <span className="text-muted-foreground"> · release {option.releaseNumber}</span>
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Languages: {option.languages.map(languageLabel).join(', ')}
          </span>
          <span className="block text-[11px] leading-snug">{option.scopeStatement}</span>
        </span>
      </label>
    );
  };

  const noPackRow = (
    <label
      className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${
        currentId === NO_PACK ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <input
        type="radio"
        name="tradition-pack-release"
        value={NO_PACK}
        checked={currentId === NO_PACK}
        disabled={busy}
        onChange={() => { void choose(null); }}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="space-y-1">
        <span className="block text-xs font-medium">No tradition pack — write it yourself</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">
          The invitation is drawn from your own words and rows, in the order this platform has
          always used. Nothing is supplied for you.
        </span>
      </span>
    </label>
  );

  return (
    <section className="space-y-3" aria-labelledby="tradition-heading">
      <h2 id="tradition-heading" className="font-display font-semibold text-sm">
        Tradition &amp; wording
      </h2>

      {/* Outside every conditional on purpose: the statement that a pack is optional has to hold
          while the catalogue is loading, when it fails to load, and when it comes back empty. A
          host who reads no packs should not have to take a pack in order to read that. */}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Tradition packs are optional. You can create an invitation without one.
      </p>

      {!loaded && loadError === null ? (
        <p className="animate-pulse text-xs text-muted-foreground">Loading the tradition packs…</p>
      ) : null}

      {loadError !== null ? (
        <>
          <p role="alert" className="text-xs text-destructive">{loadError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={() => {
              // The same two reads the mount ran; a retry is the only honest action left when
              // a catalogue could not be loaded.
              setLoadError(null);
              void load();
            }}
          >
            Try again
          </Button>
        </>
      ) : null}

      {loaded ? (
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-[11px] leading-snug text-muted-foreground">
            {options.length === 0
              ? 'No pack is available to choose right now, so this invitation is drawn from your own words.'
              : 'Choose a pack, or write everything yourself.'}
          </legend>
          {options.map(optionRow)}
          {noPackRow}
        </fieldset>
      ) : null}

      {busy ? <p className="text-xs text-muted-foreground">Saving your choice…</p> : null}
      {writeError !== null ? <p role="alert" className="text-xs text-destructive">{writeError}</p> : null}

      {loaded && selected !== null ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium">
            Chosen: {selected.packDisplayName}, release {selected.releaseNumber}
          </p>
          {selected.retired ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              This pack has been retired since you chose it. Versions you already froze keep
              showing what it said; a new freeze from it is refused until you choose again.
            </p>
          ) : null}
          {selected.definitionSchemaVersion !== TRADITION_PACK_DEFINITION_SCHEMA_VERSION ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              This pack was written against a newer definition format than this build reads.
              Anything it adds that this build cannot place is listed under the preview instead
              of drawn on it.
            </p>
          ) : null}
          {suppliedSlotLabels.length > 0 ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              It supplies the wording for: {suppliedSlotLabels.join(', ')}. Type your own words
              into those fields and they replace the pack's — and the invitation then records
              those lines as yours, not as the pack's. Clear the field and save, and the pack's
              line comes back.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default TraditionPackPanel;
