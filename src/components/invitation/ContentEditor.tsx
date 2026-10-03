// The host's people, venues and ceremonies — edited as rows, not as draft text.
//
// These three lists are canonical tables, and `private.build_invitation_snapshot` freezes
// them as they stand. That is why this editor writes immediately: there is no draft copy of
// a `wedding_people` row for a "Save Draft" button to stage, and a host who typed a
// grandmother's name and then closed the tab would otherwise have lost it with no warning
// the prose above it can give. Each row therefore carries its own Save, and each save
// re-reads the list so what the host sees afterwards is what the row answered with.
//
// Why this file exports a hook and three groups rather than one component. Stage 5's editor
// lays the invitation out in the order the chosen release declares (§19), and that order
// interleaves prose with lists — a release that puts the people between two paragraphs needs
// the *people editor* there, not in a box underneath the prose. One component owning all three
// lists could only be mounted whole, so an ordered outline would have had to mount it whole and
// hide two thirds of it: a second copy of the same row state, and a Save that could be in flight
// in a group nobody is looking at. So the state lives in `useWeddingContentRows` once and each
// list is a view over it. Nothing about that split is pack-specific — `AuthoringOutline` picks a
// group by the section's `kind`, and a release that declares no lists never asks for one.
//
// Three rules this screen keeps to:
//
//   * It asks no question about religion, caste, community or tradition, and infers
//     nothing from a name. "Role" is a word the host writes for their own relative; the
//     platform's `role_key`/`group_key`/`event_key` columns are filled with one
//     placeholder by the adapter and are never printed to a guest (`InvitationRenderer`).
//     A reviewed ceremony vocabulary belongs to the tradition-pack stage.
//   * It offers no coordinate field. A venue's map link is a URL the host pastes; the
//     latitude and longitude columns exist for a geocoder this build does not run.
//   * It shows the adapter's phrase and nothing else. A refusal from Postgres names a
//     table or a constraint, which is a fact about the database rather than something the
//     host can act on — except the one case (a venue a ceremony still uses) where the
//     adapter turns that constraint into an instruction.

import { useCallback, useEffect, useId, useState } from 'react';
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
  type CeremonyEntry,
  type PersonDraft,
  type PersonEntry,
  type VenueDraft,
  type VenueEntry,
} from '@/integrations/supabase/weddingContent';
import type { QueryResult } from '@/integrations/supabase/weddings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** A draft row's fields, in the order the adapter expects. Kept to one function per
 *  entity so an add form and an existing row can never disagree about what "unchanged"
 *  means. */
const personDraft = (row: PersonEntry): PersonDraft => ({
  displayName: row.displayName,
  roleLabel: row.roleLabel ?? '',
  groupLabel: row.groupLabel ?? '',
  displayOrder: row.displayOrder,
});

const venueDraft = (row: VenueEntry): VenueDraft => ({
  name: row.name,
  addressText: row.addressText ?? '',
  mapUrl: row.mapUrl ?? '',
});

const ceremonyDraft = (row: CeremonyEntry): CeremonyDraft => ({
  displayName: row.displayName,
  // `datetime-local` reads a value without seconds; the stored text has them. Showing the
  // stored string unchanged would leave the field blank rather than half-filled.
  startsAtLocal: toFieldDateTime(row.startsAtLocal),
  endsAtLocal: toFieldDateTime(row.endsAtLocal ?? ''),
  timezone: row.timezone,
  venueId: row.venueId ?? NO_VENUE,
  displayOrder: row.displayOrder,
  enabled: row.enabled,
});

/** The sentinel a ceremony's venue select uses for "no venue", because an empty string is
 *  a select with nothing chosen rather than a choice of nothing. */
const NO_VENUE = 'none';

const toFieldDateTime = (value: string): string => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : '');

const toStoredDateTime = (value: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;

/** The whole draft as it should be sent: text fields trimmed by the adapter, a datetime
 *  back in the stored form, and the venue sentinel mapped to no venue. */
const ceremonyPayload = (draft: CeremonyDraft): CeremonyDraft => ({
  ...draft,
  startsAtLocal: toStoredDateTime(draft.startsAtLocal),
  endsAtLocal: toStoredDateTime(draft.endsAtLocal),
  venueId: draft.venueId === NO_VENUE ? '' : draft.venueId,
});

/** In-progress edits to a list of rows, keyed by row id, so a host fixing one name does
 *  not lose the other row they were halfway through typing. */
interface RowDrafts<T extends { id: string }, D> {
  draftFor: (row: T) => D;
  changed: (row: T) => boolean;
  patchFor: (row: T, change: Partial<D>) => void;
  forget: (id: string) => void;
}

function useRowDrafts<T extends { id: string }, D>(toDraft: (row: T) => D): RowDrafts<T, D> {
  const [edits, setEdits] = useState<Record<string, D>>({});
  const draftFor = (row: T): D => edits[row.id] ?? toDraft(row);
  const changed = (row: T): boolean => JSON.stringify(draftFor(row)) !== JSON.stringify(toDraft(row));
  const patchFor = (row: T, change: Partial<D>) =>
    setEdits(prev => ({ ...prev, [row.id]: { ...(prev[row.id] ?? toDraft(row)), ...change } }));
  const forget = (id: string) =>
    setEdits(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)) as Record<string, D>);
  return { draftFor, changed, patchFor, forget };
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'url';
  min?: number;
}

const TextField = ({ id, label, value, onChange, hint, placeholder, disabled, type = 'text', inputMode, min }: FieldProps) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-[11px] font-medium">
      {label}
    </Label>
    <Input
      id={id}
      type={type}
      inputMode={inputMode}
      min={min}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className="h-8 text-xs"
    />
    {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
  </div>
);

const TextAreaField = ({ id, label, value, onChange, hint, placeholder, disabled, rows = 3 }: Omit<FieldProps, 'type'> & { rows?: number }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-[11px] font-medium">
      {label}
    </Label>
    <Textarea
      id={id}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      onChange={e => onChange(e.target.value)}
      className="text-xs"
    />
    {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
  </div>
);

const OrderField = ({ id, value, onChange, disabled }: { id: string; value: number; onChange: (value: number) => void; disabled?: boolean }) => (
  <TextField
    id={id}
    label="Order"
    type="number"
    inputMode="numeric"
    min={0}
    value={String(value)}
    disabled={disabled}
    // A number input's empty value is `''`, which is not a position; 0 is the column's own
    // default, so an emptied field means "back to the start" rather than "nothing".
    onChange={raw => {
      const parsed = Number(raw);
      onChange(Number.isInteger(parsed) && parsed >= 0 ? parsed : 0);
    }}
    hint="Guests read the list in this order, lowest first."
  />
);

const SectionHeading = ({ id, title, intro }: { id: string; title: string; intro: string }) => (
  <>
    <h3 id={id} className="font-display text-sm font-semibold">
      {title}
    </h3>
    <p className="text-[11px] leading-snug text-muted-foreground">{intro}</p>
  </>
);

const RowActions = ({
  dirty,
  busy,
  onSave,
  onRemove,
  removeLabel,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onRemove: () => void;
  removeLabel: string;
}) => (
  <div className="flex gap-2">
    <Button type="button" size="sm" variant="outline" className="rounded-lg h-8 text-xs" onClick={onSave} disabled={busy || !dirty}>
      Save row
    </Button>
    <Button type="button" size="sm" variant="ghost" className="rounded-lg h-8 text-xs text-muted-foreground" onClick={onRemove} disabled={busy}>
      {removeLabel}
    </Button>
  </div>
);

/** Which of the three row lists has an add form open. One slot rather than three, so a host who
 *  opens the person form and then clicks "Add a venue" is not left holding two half-filled add
 *  forms with the same button label. */
export type ContentRowKind = 'person' | 'venue' | 'ceremony';

/** Everything a row group needs, owned once for the whole wedding. */
export interface WeddingContentRows {
  /** The wedding every write from any group is scoped to. On this object rather than on each
   *  group's props so a group takes exactly one prop. */
  readonly weddingId: string;
  /** Prefix for every field id in every group, so an id names one field of one row of one
   *  wedding even when two groups are mounted in the same document. */
  fieldId: string;
  loading: boolean;
  busy: boolean;
  /** The adapter's phrase for the last refusal, or null. One slot for all three lists: a failed
   *  write belongs to the wedding, not to the group that happened to send it. */
  notice: string | null;
  people: PersonEntry[];
  venues: VenueEntry[];
  ceremonies: CeremonyEntry[];
  personRows: RowDrafts<PersonEntry, PersonDraft>;
  venueRows: RowDrafts<VenueEntry, VenueDraft>;
  ceremonyRows: RowDrafts<CeremonyEntry, CeremonyDraft>;
  adding: ContentRowKind | null;
  newPerson: PersonDraft;
  newVenue: VenueDraft;
  newCeremony: CeremonyDraft;
  startAdd: (kind: ContentRowKind) => void;
  cancelAdd: () => void;
  setNewPerson: (change: Partial<PersonDraft>) => void;
  setNewVenue: (change: Partial<VenueDraft>) => void;
  setNewCeremony: (change: Partial<CeremonyDraft>) => void;
  run: (call: Promise<QueryResult<unknown>>, afterWrite: () => void) => Promise<void>;
}

const EMPTY_PERSON: PersonDraft = { displayName: '', roleLabel: '', groupLabel: '', displayOrder: 0 };
const EMPTY_VENUE: VenueDraft = { name: '', addressText: '', mapUrl: '' };
const EMPTY_CEREMONY: CeremonyDraft = {
  displayName: '',
  startsAtLocal: '',
  endsAtLocal: '',
  timezone: '',
  venueId: NO_VENUE,
  displayOrder: 0,
  enabled: true,
};

export interface UseWeddingContentRowsArgs {
  weddingId: string;
  /** Called after any content row changes, so the canvas re-reads the server's projection
   *  and shows the guest's document rather than a guess about it. */
  onContentChanged: () => void;
}

export const useWeddingContentRows = ({
  weddingId,
  onContentChanged,
}: UseWeddingContentRowsArgs): WeddingContentRows => {
  const fieldId = useId();
  const [people, setPeople] = useState<PersonEntry[]>([]);
  const [venues, setVenues] = useState<VenueEntry[]>([]);
  const [ceremonies, setCeremonies] = useState<CeremonyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<ContentRowKind | null>(null);
  const [newPerson, setNewPerson] = useState<PersonDraft>(EMPTY_PERSON);
  const [newVenue, setNewVenue] = useState<VenueDraft>(EMPTY_VENUE);
  const [newCeremony, setNewCeremony] = useState<CeremonyDraft>(EMPTY_CEREMONY);

  const personRows = useRowDrafts(personDraft);
  const venueRows = useRowDrafts(venueDraft);
  const ceremonyRows = useRowDrafts(ceremonyDraft);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([listPeople(weddingId), listVenues(weddingId), listCeremonies(weddingId)]).then(
      ([peopleResult, venueResult, ceremonyResult]) => {
        if (!live) return;
        if (peopleResult.data) setPeople(peopleResult.data);
        if (venueResult.data) setVenues(venueResult.data);
        if (ceremonyResult.data) setCeremonies(ceremonyResult.data);
        setNotice(
          [peopleResult.error, venueResult.error, ceremonyResult.error].find(e => e !== null) ?? null,
        );
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [weddingId]);

  const reload = useCallback(async () => {
    const [peopleResult, venueResult, ceremonyResult] = await Promise.all([
      listPeople(weddingId),
      listVenues(weddingId),
      listCeremonies(weddingId),
    ]);
    // A write that answered successfully and a re-read that then failed must not look like
    // the row vanished: the lists keep their last good content.
    if (peopleResult.data) setPeople(peopleResult.data);
    if (venueResult.data) setVenues(venueResult.data);
    if (ceremonyResult.data) setCeremonies(ceremonyResult.data);
  }, [weddingId]);

  /** One gesture's shape: send, and on a refusal show the adapter's phrase alone. */
  const run = useCallback(
    async (call: Promise<QueryResult<unknown>>, afterWrite: () => void) => {
      setBusy(true);
      setNotice(null);
      const result = await call;
      if (result.error !== null) {
        setBusy(false);
        setNotice(result.error);
        return;
      }
      afterWrite();
      await reload();
      setBusy(false);
      onContentChanged();
    },
    [reload, onContentChanged],
  );

  const startAdd = (kind: ContentRowKind) => {
    setAdding(kind);
    setNotice(null);
    const displayOrder = kind === 'person' ? people.length : kind === 'ceremony' ? ceremonies.length : 0;
    if (kind === 'person') setNewPerson({ ...EMPTY_PERSON, displayOrder });
    if (kind === 'venue') setNewVenue(EMPTY_VENUE);
    if (kind === 'ceremony') setNewCeremony({ ...EMPTY_CEREMONY, displayOrder });
  };

  return {
    weddingId,
    fieldId,
    loading,
    busy,
    notice,
    people,
    venues,
    ceremonies,
    personRows,
    venueRows,
    ceremonyRows,
    adding,
    newPerson,
    newVenue,
    newCeremony,
    startAdd,
    cancelAdd: () => setAdding(null),
    setNewPerson: change => setNewPerson(p => ({ ...p, ...change })),
    setNewVenue: change => setNewVenue(v => ({ ...v, ...change })),
    setNewCeremony: change => setNewCeremony(c => ({ ...c, ...change })),
    run,
  };
};

/** The last refusal, printed once, wherever the page that owns the rows chooses to put it. */
export const ContentNotice = ({ notice }: { notice: string | null }) =>
  notice === null ? null : (
    <p role="alert" className="text-xs text-destructive">
      {notice}
    </p>
  );

export const PeopleGroup = ({ rows }: { rows: WeddingContentRows }) => (
  <div className="space-y-3">
    <SectionHeading
      id="people-heading"
      title="The people"
      intro="Names as guests should read them. Nothing here asks about religion, caste or community, and no role is guessed from a name."
    />
    {rows.loading ? <p className="text-xs text-muted-foreground animate-pulse">Loading the people…</p> : null}
    {!rows.loading && rows.people.length === 0 ? (
      <p className="text-xs text-muted-foreground">No one is listed yet.</p>
    ) : null}
    <ul className="space-y-4">
      {rows.people.map(person => {
        const draft = rows.personRows.draftFor(person);
        return (
          <li key={person.id}>
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium">{person.displayName}</legend>
              <PersonFields
                idPrefix={`${rows.fieldId}-person-${person.id}`}
                draft={draft}
                onChange={change => rows.personRows.patchFor(person, change)}
                disabled={rows.busy}
              />
              <RowActions
                dirty={rows.personRows.changed(person)}
                busy={rows.busy}
                onSave={() =>
                  void rows.run(updatePerson(rows.weddingId, person.id, draft), () => rows.personRows.forget(person.id))
                }
                onRemove={() =>
                  void rows.run(removePerson(rows.weddingId, person.id), () => rows.personRows.forget(person.id))
                }
                removeLabel="Remove"
              />
            </fieldset>
          </li>
        );
      })}
    </ul>
    {rows.adding === 'person' ? (
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs font-medium">Add a person</p>
        <PersonFields
          idPrefix={`${rows.fieldId}-new-person`}
          draft={rows.newPerson}
          onChange={rows.setNewPerson}
          disabled={rows.busy}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-lg h-8 text-xs"
            disabled={rows.busy}
            onClick={() =>
              void rows.run(createPerson(rows.weddingId, rows.newPerson), () => {
                rows.setNewPerson({ ...EMPTY_PERSON, displayOrder: rows.people.length + 1 });
                rows.cancelAdd();
              })
            }
          >
            Add to invitation
          </Button>
          <Button type="button" size="sm" variant="ghost" className="rounded-lg h-8 text-xs" onClick={rows.cancelAdd} disabled={rows.busy}>
            Cancel
          </Button>
        </div>
      </div>
    ) : (
      <Button type="button" size="sm" variant="outline" className="rounded-lg h-8 text-xs" onClick={() => rows.startAdd('person')} disabled={rows.busy}>
        Add a person
      </Button>
    )}
  </div>
);

export const VenueGroup = ({ rows }: { rows: WeddingContentRows }) => (
  <div className="space-y-3">
    <SectionHeading
      id="venues-heading"
      title="The venues"
      intro="Where each gathering happens. A map link is a full https:// address you paste; this build does not look up coordinates."
    />
    {rows.loading ? <p className="text-xs text-muted-foreground animate-pulse">Loading the venues…</p> : null}
    {!rows.loading && rows.venues.length === 0 ? (
      <p className="text-xs text-muted-foreground">No venue is listed yet.</p>
    ) : null}
    <ul className="space-y-4">
      {rows.venues.map(venue => {
        const draft = rows.venueRows.draftFor(venue);
        return (
          <li key={venue.id}>
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium">{venue.name}</legend>
              <VenueFields
                idPrefix={`${rows.fieldId}-venue-${venue.id}`}
                draft={draft}
                onChange={change => rows.venueRows.patchFor(venue, change)}
                disabled={rows.busy}
              />
              <RowActions
                dirty={rows.venueRows.changed(venue)}
                busy={rows.busy}
                onSave={() =>
                  void rows.run(updateVenue(rows.weddingId, venue.id, draft), () => rows.venueRows.forget(venue.id))
                }
                onRemove={() =>
                  void rows.run(removeVenue(rows.weddingId, venue.id), () => rows.venueRows.forget(venue.id))
                }
                removeLabel="Remove venue"
              />
            </fieldset>
          </li>
        );
      })}
    </ul>
    {rows.adding === 'venue' ? (
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs font-medium">Add a venue</p>
        <VenueFields
          idPrefix={`${rows.fieldId}-new-venue`}
          draft={rows.newVenue}
          onChange={rows.setNewVenue}
          disabled={rows.busy}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-lg h-8 text-xs"
            disabled={rows.busy}
            onClick={() =>
              void rows.run(createVenue(rows.weddingId, rows.newVenue), () => {
                rows.setNewVenue(EMPTY_VENUE);
                rows.cancelAdd();
              })
            }
          >
            Add to invitation
          </Button>
          <Button type="button" size="sm" variant="ghost" className="rounded-lg h-8 text-xs" onClick={rows.cancelAdd} disabled={rows.busy}>
            Cancel
          </Button>
        </div>
      </div>
    ) : (
      <Button type="button" size="sm" variant="outline" className="rounded-lg h-8 text-xs" onClick={() => rows.startAdd('venue')} disabled={rows.busy}>
        Add a venue
      </Button>
    )}
  </div>
);

export const CeremonyGroup = ({ rows }: { rows: WeddingContentRows }) => (
  <div className="space-y-3">
    <SectionHeading
      id="ceremonies-heading"
      title="The ceremonies"
      intro="Name each gathering in your own words — there is no list of ceremony names to choose from yet, and nothing is translated for you."
    />
    {rows.loading ? <p className="text-xs text-muted-foreground animate-pulse">Loading the ceremonies…</p> : null}
    {!rows.loading && rows.ceremonies.length === 0 ? (
      <p className="text-xs text-muted-foreground">No ceremony is listed yet.</p>
    ) : null}
    <ul className="space-y-4">
      {rows.ceremonies.map(ceremony => {
        const draft = rows.ceremonyRows.draftFor(ceremony);
        const prefix = `${rows.fieldId}-ceremony-${ceremony.id}`;
        return (
          <li key={ceremony.id}>
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium">{ceremony.displayName}</legend>
              <CeremonyFields
                idPrefix={prefix}
                draft={draft}
                venues={rows.venues}
                onChange={change => rows.ceremonyRows.patchFor(ceremony, change)}
                disabled={rows.busy}
              />
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`${prefix}-enabled`}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={draft.enabled}
                  disabled={rows.busy}
                  onChange={e => rows.ceremonyRows.patchFor(ceremony, { enabled: e.target.checked })}
                />
                <span className="text-[11px] leading-snug">
                  Show this ceremony to guests
                  <span className="block text-muted-foreground">
                    Unchecking it keeps the row for you and leaves it out of the invitation.
                  </span>
                </span>
              </label>
              <RowActions
                dirty={rows.ceremonyRows.changed(ceremony)}
                busy={rows.busy}
                onSave={() =>
                  void rows.run(
                    updateCeremony(rows.weddingId, ceremony.id, ceremonyPayload(draft)),
                    () => rows.ceremonyRows.forget(ceremony.id),
                  )
                }
                onRemove={() =>
                  void rows.run(
                    removeCeremony(rows.weddingId, ceremony.id),
                    () => rows.ceremonyRows.forget(ceremony.id),
                  )
                }
                removeLabel="Remove ceremony"
              />
            </fieldset>
          </li>
        );
      })}
    </ul>
    {rows.adding === 'ceremony' ? (
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs font-medium">Add a ceremony</p>
        <CeremonyFields
          idPrefix={`${rows.fieldId}-new-ceremony`}
          draft={rows.newCeremony}
          venues={rows.venues}
          onChange={rows.setNewCeremony}
          disabled={rows.busy}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-lg h-8 text-xs"
            disabled={rows.busy}
            onClick={() =>
              void rows.run(createCeremony(rows.weddingId, ceremonyPayload(rows.newCeremony)), () => {
                rows.setNewCeremony({ ...EMPTY_CEREMONY, displayOrder: rows.ceremonies.length + 1 });
                rows.cancelAdd();
              })
            }
          >
            Add to invitation
          </Button>
          <Button type="button" size="sm" variant="ghost" className="rounded-lg h-8 text-xs" onClick={rows.cancelAdd} disabled={rows.busy}>
            Cancel
          </Button>
        </div>
      </div>
    ) : (
      <Button type="button" size="sm" variant="outline" className="rounded-lg h-8 text-xs" onClick={() => rows.startAdd('ceremony')} disabled={rows.busy}>
        Add a ceremony
      </Button>
    )}
  </div>
);

/** The three fields a venue row carries. */
const VenueFields = ({
  idPrefix,
  draft,
  onChange,
  disabled,
}: {
  idPrefix: string;
  draft: VenueDraft;
  onChange: (change: Partial<VenueDraft>) => void;
  disabled: boolean;
}) => (
  <>
    <TextField
      id={`${idPrefix}-name`}
      label="Venue name"
      value={draft.name}
      onChange={name => onChange({ name })}
      disabled={disabled}
    />
    <TextAreaField
      id={`${idPrefix}-address`}
      label="Address"
      value={draft.addressText}
      onChange={addressText => onChange({ addressText })}
      hint="Line breaks you type here are line breaks on the invitation."
      disabled={disabled}
    />
    <TextField
      id={`${idPrefix}-map`}
      label="Map link (optional)"
      type="url"
      inputMode="url"
      value={draft.mapUrl}
      placeholder="https://…"
      hint="Only an https:// link is shown to guests."
      onChange={mapUrl => onChange({ mapUrl })}
      disabled={disabled}
    />
  </>
);

/** The four fields a person row carries, in one place so the list and the add form cannot
 *  drift apart on a label, a hint or an order of fields. */
const PersonFields = ({
  idPrefix,
  draft,
  onChange,
  disabled,
}: {
  idPrefix: string;
  draft: PersonDraft;
  onChange: (change: Partial<PersonDraft>) => void;
  disabled: boolean;
}) => (
  <>
    <TextField
      id={`${idPrefix}-name`}
      label="Name"
      value={draft.displayName}
      onChange={displayName => onChange({ displayName })}
      disabled={disabled}
    />
    <TextField
      id={`${idPrefix}-role`}
      label="Role (optional)"
      placeholder="e.g. Mother, Elder brother, Friend"
      value={draft.roleLabel}
      hint="Shown before the name. Leave it empty to show the name alone."
      onChange={roleLabel => onChange({ roleLabel })}
      disabled={disabled}
    />
    <TextField
      id={`${idPrefix}-group`}
      label="Group (optional)"
      placeholder="e.g. Mother's side, Family friends"
      value={draft.groupLabel}
      hint="A heading over the names that share it."
      onChange={groupLabel => onChange({ groupLabel })}
      disabled={disabled}
    />
    <OrderField
      id={`${idPrefix}-order`}
      value={draft.displayOrder}
      onChange={displayOrder => onChange({ displayOrder })}
      disabled={disabled}
    />
  </>
);

/** A ceremony's own fields. `venues` is the host's venue list for this wedding and nothing
 *  else, which is the UI half of the rule the composite foreign key
 *  (`wedding_id, venue_id`) already enforces in the database. */
const CeremonyFields = ({
  idPrefix,
  draft,
  venues,
  onChange,
  disabled,
}: {
  idPrefix: string;
  draft: CeremonyDraft;
  venues: VenueEntry[];
  onChange: (change: Partial<CeremonyDraft>) => void;
  disabled: boolean;
}) => (
  <>
    <TextField
      id={`${idPrefix}-name`}
      label="Ceremony name"
      value={draft.displayName}
      placeholder="e.g. Muhurtham, Reception, a name of your own"
      onChange={displayName => onChange({ displayName })}
      disabled={disabled}
    />
    <TextField
      id={`${idPrefix}-starts`}
      label="Starts (date and time)"
      type="datetime-local"
      value={draft.startsAtLocal}
      hint="The time as it happens where you are — no conversion is applied to it."
      onChange={startsAtLocal => onChange({ startsAtLocal })}
      disabled={disabled}
    />
    <TextField
      id={`${idPrefix}-ends`}
      label="Ends (optional)"
      type="datetime-local"
      value={draft.endsAtLocal}
      onChange={endsAtLocal => onChange({ endsAtLocal })}
      disabled={disabled}
    />
    <TextField
      id={`${idPrefix}-timezone`}
      label="Time zone (optional)"
      value={draft.timezone}
      placeholder="e.g. Asia/Kolkata"
      hint="Written under the date, exactly as you type it. Left empty, the stored default is kept."
      onChange={timezone => onChange({ timezone })}
      disabled={disabled}
    />
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-venue`} className="text-[11px] font-medium">
        Venue
      </Label>
      <select
        id={`${idPrefix}-venue`}
        value={draft.venueId}
        disabled={disabled}
        onChange={e => onChange({ venueId: e.target.value })}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value={NO_VENUE}>No venue</option>
        {venues.map(venue => (
          <option key={venue.id} value={venue.id}>
            {venue.name}
          </option>
        ))}
      </select>
      {/* Says "this invitation" rather than "above". An ordered outline may place the venue list
          after the ceremonies, and a direction that depends on the layout would be wrong in half
          the layouts this group is now mounted in. */}
      {venues.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Nothing to choose yet — a venue you add to this invitation appears here.
        </p>
      ) : null}
    </div>
    <OrderField
      id={`${idPrefix}-order`}
      value={draft.displayOrder}
      onChange={displayOrder => onChange({ displayOrder })}
      disabled={disabled}
    />
  </>
);
