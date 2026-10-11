// The families, their links, and which ceremonies each one is invited to.
//
// This is the host's half of Stage 8, and the shape of the panel is decided by four facts the
// database already forces, each of which has a matching sentence in `docs/architecture/`
// `guest-rsvp-security.md` §7:
//
//   * A raw household address exists in exactly one response. `private.access_tokens` holds only the
//     SHA-256 digest, so the credential is legible in the answer that minted it and nowhere else
//     (`20261009120000_stage8_guest_invitations_rsvp.sql:248-258`). After a reload this panel can
//     report a link's *state* through `api.get_guest_invitation_state` — ten columns, none of them
//     token material (`…sql:506-522`) — and cannot show the address again. The offered remedy is
//     rotate, which mints a successor and retires the previous row in the same call (`…sql:449-464`),
//     never a re-read of a secret the database deliberately no longer has. So a minted path is held
//     in component state, written to no storage, and dropped on reload like Stage 7's review link.
//   * A family that has ever been sent a link cannot be deleted. `private.access_tokens` pins the
//     household with a `NO ACTION` composite key (`20260925120400_stage2_assets_entitlements_secrets.sql:169`),
//     because Stage 2 ruled that a minted credential is evidence and "does not vanish as a side effect
//     of a wedding removal" (`:129-131`), and `rsvp_responses` does the same for a recorded answer
//     (`20260925120300_stage2_guests_approvals_rsvp.sql:93-94`). A delete button that ignored that
//     would be a control that promises an action and returns a constraint name, so the control appears
//     only where both keys are empty, and the count that holds it back is printed in words first.
//   * Withdrawing is the real "remove this family". It stops the address resolving at once
//     (`…sql:314`, `:346-361`) while the household, its events and its answers stay where they are,
//     so it is always offered and never described as deleting anything.
//   * Scoping is the host's act of inviting one family to one ceremony, and a household scoped to
//     nothing is a data error rather than a family invited to nothing: the door still reads,
//     `can_respond` is false (`…sql:692`), and §6's table says the panel must flag it. So the count is
//     printed on the row, and zero is printed as a problem to fix.
//
// `host_notes` is editable here because this is the screen allowed to see it. It has no path to a
// guest: the door's projection names no such key, and P3 of §9 asserts that with a marker written into
// the column and read back from the response bytes.
//
// Unfamiliar vocabulary is printed as what it is. `link_state` comes from a CASE the migration owns
// (`…sql:510-513`) and a word outside those four is shown as "this build has no word for …", the same
// posture Stage 7's queue took: inventing a label for tomorrow's migration would put it on screen as
// today's fact.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createGuestHousehold,
  getGuestInvitationState,
  issueGuestInvitations,
  listGuestHouseholds,
  listHouseholdEventScopes,
  removeGuestHousehold,
  revokeGuestInvitation,
  rotateGuestInvitation,
  setHouseholdEventScopes,
  updateGuestHousehold,
  type GuestHousehold,
  type HouseholdDraft,
} from '@/integrations/supabase/guestInvitations';
import { listCeremonies, type CeremonyEntry } from '@/integrations/supabase/weddingContent';
import { guestTokenFromPath, type GuestPanelRow, type GuestSendItem } from '@/lib/guestInvitation';

/** The name CHECK bounds the column (`20260925120300_stage2_guests_approvals_rsvp.sql:20-21`); the
 *  input repeats it so a host is not stopped by a database they cannot see. */
const NAME_MAX = 120;
const SALUTATION_MAX = 120;
const NOTES_MAX = 500;

const EMPTY_DRAFT: HouseholdDraft = {
  displayName: '',
  salutation: '',
  expectedPartySize: '',
  hostNotes: '',
};

const LINK_STATE_WORDS: Record<string, string> = {
  never_issued: 'No link sent yet',
  live: 'Link is live',
  expired: 'Link has run out',
  revoked: 'Link withdrawn',
};

const linkWords = (linkState: string): string =>
  LINK_STATE_WORDS[linkState] ?? `This build has no word for “${linkState}”`;

/** `link_state` and the reply counts are two different facts about one family and the design note
 *  refuses to merge them (§7's "two vocabularies are printed, not interpreted"): a live link with no
 *  answer and a withdrawn link with an answer are both states a host acts on. */
const eventCount = (count: number): string => `${count} ${count === 1 ? 'event' : 'events'}`;
const repliesWord = (count: number): string => `${count} ${count === 1 ? 'reply' : 'replies'}`;

const answerWords = (row: GuestPanelRow): string => {
  if (row.scopedEventCount === 0) {
    return 'invited to no event, so there is nothing for them to answer';
  }
  // `attending_count` counts the household's *answer rows* marked attending
  // (`…sql:520-522`), so it is "how many of their events they said yes to", never a headcount. The
  // headcounts live on the reply rows and this panel deliberately adds nothing up across households:
  // §7's rule is that the summing belongs to the door, and a per-family number printed as a total
  // invites a host to read one family's guests as the wedding's.
  const saidYes = row.attendingCount === 0
    ? 'said yes to none of them'
    : `said yes to ${row.attendingCount} of them`;
  if (row.replyCount === 0) return `no reply yet, across ${eventCount(row.scopedEventCount)}`;
  return `${row.replyCount} of ${eventCount(row.scopedEventCount)} answered · ${saidYes}`;
};

const dayOf = (iso: string | null): string | null => {
  if (iso === null) return null;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

/** One address this session was handed. `path` is the credential's only appearance in this file after
 *  the mint, and `householdId` is what lets the panel print it beside the family it belongs to. */
interface MintedLink {
  householdId: string;
  displayName: string;
  url: string;
}

/** The absolute address to hand a host, from the path the mint answered with.
 *
 *  `api.issue_guest_invitations` and `api.rotate_guest_invitation` both answer with a *path*
 *  (`/g/<credential>`, spelled at `…sql:293` and `:469`), not a bare token, so the shape test here reads
 *  the credential back out of that path with the same function the guest route uses
 *  (`src/lib/guestInvitation.ts:85-89`) and refuses to print an address the door could not open. A path
 *  of the wrong shape is a projection this build does not recognise; printing it as a link would send a
 *  family to an address that goes nowhere, with nothing on the page to explain why. */
const linkOf = (path: string): string | null =>
  guestTokenFromPath(path) === null ? null : `${window.location.origin}${path}`;

const HouseForm = ({
  idPrefix,
  draft,
  busy,
  heading,
  onChange,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  idPrefix: string;
  draft: HouseholdDraft;
  busy: boolean;
  heading: string;
  onChange: (next: HouseholdDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
}) => {
  const field = (name: keyof HouseholdDraft) => `${idPrefix}-${name}`;
  return (
    <fieldset className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <legend className="px-1 text-[11px] font-medium leading-snug">{heading}</legend>
      <div className="space-y-1">
        <Label htmlFor={field('displayName')} className="text-[11px] font-medium">
          Family or household name
        </Label>
        <Input
          id={field('displayName')}
          value={draft.displayName}
          maxLength={NAME_MAX}
          disabled={busy}
          onChange={event => onChange({ ...draft, displayName: event.target.value })}
          className="h-11 text-xs"
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          How you know them. Guests see this as their own greeting.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={field('salutation')} className="text-[11px] font-medium">
          Greeting line, if you want one (optional)
        </Label>
        <Input
          id={field('salutation')}
          value={draft.salutation}
          maxLength={SALUTATION_MAX}
          disabled={busy}
          placeholder="e.g. The Krishnan family"
          onChange={event => onChange({ ...draft, salutation: event.target.value })}
          className="h-11 text-xs"
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          Left empty, their page opens with the name above. This is text you write and they read — it is
          not checked against anything.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={field('expectedPartySize')} className="text-[11px] font-medium">
          How many you expect from them (optional)
        </Label>
        <Input
          id={field('expectedPartySize')}
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step={1}
          value={draft.expectedPartySize}
          disabled={busy}
          onChange={event => onChange({ ...draft, expectedPartySize: event.target.value })}
          className="h-11 text-xs"
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          Their link then lets them send up to this many. Leave it empty to ask no number of them — and
          note this is the ceiling on *their* reply, never on yours: when they phone you instead, you
          record whatever they actually said.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={field('hostNotes')} className="text-[11px] font-medium">
          Your note about them (optional, never shown to guests)
        </Label>
        <Textarea
          id={field('hostNotes')}
          value={draft.hostNotes}
          maxLength={NOTES_MAX}
          rows={2}
          disabled={busy}
          onChange={event => onChange({ ...draft, hostNotes: event.target.value })}
          className="text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-11 rounded-lg text-xs"
          onClick={onSubmit}
          disabled={busy || draft.displayName.trim() === ''}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 rounded-lg text-xs"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
};

/** One family's ceremonies. The list is read when the host opens it, because the panel row already
 *  carries the *count* (`api.get_guest_invitation_state`, `…sql:506-522`) and an open screen for forty
 *  families would otherwise spend forty reads on the ones nobody is editing. */
const ScopeEditor = ({
  weddingId,
  householdId,
  displayName,
  ceremonies,
  busy,
  onSaved,
  onRefused,
  onClosed,
}: {
  weddingId: string;
  householdId: string;
  displayName: string;
  ceremonies: CeremonyEntry[];
  busy: boolean;
  onSaved: (message: string) => void;
  onRefused: (error: string) => void;
  onClosed: () => void;
}) => {
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void listHouseholdEventScopes(weddingId, householdId).then(result => {
      if (!live) return;
      if (result.data === null) {
        setLoadError(result.error ?? 'the events for that household could not be read');
        return;
      }
      setChosen(result.data);
      setLoadError(null);
    });
    return () => {
      live = false;
    };
  }, [weddingId, householdId]);

  const save = async () => {
    if (chosen === null || saving) return;
    // `setHouseholdEventScopes` is two REST calls (withdraw, then invite) that are not one
    // transaction, so a second click while the first is still in flight can interleave another
    // family-wide delete between its two halves. The parent's `busy` never covers this write, because
    // ScopeEditor owns it, so the guard is local.
    setSaving(true);
    const result = await setHouseholdEventScopes(weddingId, householdId, chosen);
    setSaving(false);
    if (result.data === null) {
      onRefused(result.error ?? 'the events for that household could not be saved');
      return;
    }
    onSaved(
      result.data.length === 0
        ? `${displayName} is now invited to no event — their page will read, but has nothing to answer.`
        : `${displayName} is now invited to ${eventCount(result.data.length)}.`,
    );
  };

  if (loadError !== null) return <p role="alert" className="text-xs text-destructive">{loadError}</p>;
  if (chosen === null) {
    return <p className="animate-pulse text-[11px] text-muted-foreground">Loading their events…</p>;
  }

  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-[11px] font-medium">Events {displayName} is invited to</legend>
      {ceremonies.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          This wedding has no ceremonies yet, so there is nothing to invite them to. Add one under{' '}
          <em>Your invitation, section by section</em> first.
        </p>
      ) : (
        <ul className="space-y-1">
          {ceremonies.map(ceremony => {
            const checked = chosen.includes(ceremony.id);
            const boxId = `scope-${householdId}-${ceremony.id}`;
            return (
              <li key={ceremony.id}>
                <label htmlFor={boxId} className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input
                    id={boxId}
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    className="h-5 w-5 shrink-0 accent-primary"
                    onChange={event =>
                      setChosen(current => {
                        if (current === null) return current;
                        return event.target.checked
                          ? [...current, ceremony.id]
                          : current.filter(id => id !== ceremony.id);
                      })
                    }
                  />
                  <span className="min-w-0 text-xs">
                    {ceremony.displayName}
                    {ceremony.enabled ? null : <em className="block not-italic text-muted-foreground">switched off — they cannot answer it</em>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Saving takes away first, then adds, so a half-finished change can only ever show a family fewer
        events than you meant — never one you were removing. Anything they already answered stays on the
        record even if you take its event away.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-11 rounded-lg text-xs" onClick={() => { void save(); }} disabled={busy || saving}>
          {saving ? 'Saving their events…' : 'Save their events'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-11 rounded-lg text-xs" onClick={onClosed} disabled={busy || saving}>
          Done
        </Button>
      </div>
    </fieldset>
  );
};

export interface GuestInvitationPanelProps {
  weddingId: string;
}

const GuestInvitationPanel = ({ weddingId }: GuestInvitationPanelProps) => {
  const [rows, setRows] = useState<GuestPanelRow[] | null>(null);
  const [households, setHouseholds] = useState<GuestHousehold[]>([]);
  const [ceremonies, setCeremonies] = useState<CeremonyEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newHousehold, setNewHousehold] = useState<HouseholdDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<HouseholdDraft>(EMPTY_DRAFT);
  const [scopeFor, setScopeFor] = useState<string | null>(null);
  const [links, setLinks] = useState<MintedLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /** Same ticket discipline as the review queue: a late read from before a withdraw must not put a
   *  withdrawn link back on screen as live, and the panel counts are the rows the writes changed. */
  const readTicket = useRef(0);

  const load = useCallback(async () => {
    readTicket.current += 1;
    const ticket = readTicket.current;
    const [panel, people, events] = await Promise.all([
      getGuestInvitationState(weddingId),
      listGuestHouseholds(weddingId),
      listCeremonies(weddingId),
    ]);
    if (ticket !== readTicket.current) return;
    if (panel.data === null) {
      setLoadError(panel.error ?? 'the guest invitations could not be read');
      return;
    }
    setRows(panel.data);
    setHouseholds(people.data ?? []);
    setCeremonies(events.data ?? []);
    setLoadError(null);
  }, [weddingId]);

  useEffect(() => {
    setRows(null);
    setLoadError(null);
    void load();
  }, [load]);

  const rowFor = (householdId: string): GuestPanelRow | undefined =>
    rows?.find(row => row.householdId === householdId);

  const handBack = (items: GuestSendItem[]): void => {
    const minted = items
      .map(item => ({ item, url: item.path === null ? null : linkOf(item.path) }))
      .filter((entry): entry is { item: GuestSendItem; url: string } => entry.url !== null)
      .map(({ item, url }) => ({ householdId: item.householdId, displayName: item.displayName, url }));
    if (minted.length > 0) setLinks(current => [...current, ...minted]);
  };

  /** Adding a family is one write and its own quiet step: the address is a second act, so the host is
   *  never handed a link for a household whose events they have not chosen yet. */
  const add = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await createGuestHousehold(weddingId, newHousehold);
    setBusy(false);
    if (result.data === null) {
      setError(result.error ?? 'the households could not be saved');
      return;
    }
    // The adapter's `createGuestHousehold` answers with only the new row's id
    // (`src/integrations/supabase/guestInvitations.ts:276-294`), and the draft input is the same string
    // the write used after the same blank check, so the name is read from what the host typed rather
    // than from a second list call made just to print a sentence.
    setMessage(`${newHousehold.displayName.trim()} is on the list. Choose their events, then create their link.`);
    setNewHousehold(EMPTY_DRAFT);
    await load();
  };

  const saveEdit = async (householdId: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await updateGuestHousehold(weddingId, householdId, editDraft);
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    setMessage('Saved what the guest will be greeted with.');
    await load();
  };

  const send = async (householdId: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await issueGuestInvitations(weddingId, [householdId]);
    setBusy(false);
    if (result.data === null) {
      setError(result.error ?? 'the invitations could not be sent');
      await load();
      return;
    }
    handBack(result.data.invitations);
    const item = result.data.invitations[0];
    setMessage(
      item?.status === 'already_live'
        ? 'That family already has a link that still works. Its address was not shown again, because only the call that created it ever carried it.'
        : 'Their link is ready. Copy it now — it cannot be shown again.',
    );
    await load();
  };

  const sendAll = async () => {
    const waiting = (rows ?? []).filter(row => row.linkState !== 'live');
    if (waiting.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await issueGuestInvitations(weddingId, waiting.map(row => row.householdId));
    setBusy(false);
    if (result.data === null) {
      setError(result.error ?? 'the invitations could not be sent');
      await load();
      return;
    }
    handBack(result.data.invitations);
    const created = `${result.data.issued} ${result.data.issued === 1 ? 'link created' : 'links created'}`;
    setMessage(
      result.data.issued === 0
        ? 'None of them needed a new link — every family you picked already has one that works.'
        : `${created}. ${result.data.alreadyLive} already had a working one. Copy the addresses now; they cannot be shown again.`,
    );
    await load();
  };

  const rotate = async (householdId: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await rotateGuestInvitation(householdId);
    setBusy(false);
    if (result.data === null) {
      setError(result.error ?? 'that invitation link could not be replaced');
      await load();
      return;
    }
    const url = linkOf(result.data.path);
    if (url !== null) {
      const name = rowFor(householdId)?.displayName ?? households.find(h => h.id === householdId)?.displayName ?? 'They';
      setLinks(current => [...current, { householdId, displayName: name, url }]);
    }
    setMessage('The old address stops working at once. Copy this one — it is shown once.');
    await load();
  };

  const withdraw = async (householdId: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await revokeGuestInvitation(householdId);
    setBusy(false);
    if (result.data === null) {
      setError(result.error ?? 'that invitation link could not be withdrawn');
      await load();
      return;
    }
    setMessage(
      result.data.revoked
        ? 'Their link is withdrawn. Their events and any answer they sent are still on the record.'
        : 'That family had no live link to withdraw.',
    );
    await load();
  };

  const remove = async (row: GuestPanelRow) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await removeGuestHousehold(weddingId, row.householdId);
    setBusy(false);
    // `removeGuestHousehold` answers `QueryResult<null>`: an empty data half is its success, so the
    // error alone tells the two apart. A `data === null` check here would print a failure over a
    // family whose row is already gone — and the sentence it prints would be the one thing that
    // tells a host to try the destructive click again.
    if (result.error !== null) {
      setError(result.error);
      await load();
      return;
    }
    setMessage(`${row.displayName} is off the list. Nothing was ever sent to them, so there is no record left behind.`);
    await load();
  };

  const copy = async (link: MintedLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.householdId);
    } catch {
      setCopiedId(null);
    }
  };

  const startEdit = (household: GuestHousehold) => {
    setEditingId(household.id);
    setScopeFor(null);
    setEditDraft({
      displayName: household.displayName,
      salutation: household.salutation ?? '',
      expectedPartySize: household.expectedPartySize === null ? '' : String(household.expectedPartySize),
      hostNotes: household.hostNotes ?? '',
    });
  };

  const noLiveLink = (rows ?? []).filter(row => row.linkState !== 'live').length;
  const unscoped = (rows ?? []).filter(row => row.scopedEventCount === 0);

  return (
    <section className="space-y-3" aria-labelledby="guest-invitations-heading">
      <h2 id="guest-invitations-heading" className="font-display font-semibold text-sm">
        Guest invitations
      </h2>

      <p className="text-[11px] leading-snug text-muted-foreground">
        List the families, choose which ceremonies each one is invited to, and send each household its
        own link. A guest opens it with no account and answers only for their own household.
      </p>

      <HouseForm
        idPrefix="guest-new"
        draft={newHousehold}
        busy={busy}
        heading="Add a family"
        onChange={setNewHousehold}
        onSubmit={() => { void add(); }}
        submitLabel="Add them to the list"
      />

      {loadError !== null ? (
        <>
          <p role="alert" className="text-xs text-destructive">{loadError}</p>
          <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs" onClick={() => { void load(); }}>
            Try again
          </Button>
        </>
      ) : null}

      {rows === null && loadError === null ? (
        <p className="animate-pulse text-xs text-muted-foreground">Loading your guest list…</p>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[11px] leading-snug">
            {rows.length} {rows.length === 1 ? 'family is' : 'families are'} on the list.{' '}
            {noLiveLink === 0
              ? 'Every one of them has a working link.'
              : `${noLiveLink} of them ${noLiveLink === 1 ? 'has' : 'have'} no working link yet.`}
          </p>
          {noLiveLink > 0 ? (
            <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs" onClick={() => { void sendAll(); }} disabled={busy}>
              Create a link for every family without one
            </Button>
          ) : null}
          <p className="text-[11px] leading-snug text-muted-foreground">
            A family who already holds a working link keeps it: this creates addresses only for the ones
            with none, and no family is ever given two live links at once.
          </p>
          {unscoped.length > 0 ? (
            <p className="text-[11px] leading-snug text-warning">
              {unscoped.map(row => row.displayName).join(', ')} {unscoped.length === 1 ? 'is' : 'are'}{' '}
              invited to no event. Their page will open and read fine, but has nothing to answer —
              choose their events below.
            </p>
          ) : null}
        </div>
      ) : null}

      {links.length > 0 ? (
        <ul className="space-y-2">
          {links.map(link => (
            <li key={`${link.householdId}-${link.url}`} className="space-y-2 rounded-lg border border-gold/50 bg-paper p-3">
              <p className="text-xs font-medium">{link.displayName}&apos;s invitation link. It is shown once.</p>
              <p className="break-all font-mono text-xs">{link.url}</p>
              <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs" onClick={() => { void copy(link); }}>
                Copy
              </Button>
              <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
                {copiedId === link.householdId
                  ? 'Copied to the clipboard.'
                  : 'Nothing has been sent to anyone. Copy it, or hand the link over yourself.'}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {rows !== null && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No families listed yet. Add one above, then choose which ceremonies to invite them to.
        </p>
      ) : null}

      {rows !== null ? (
        <ul className="space-y-3">
          {rows.map(row => {
            const household = households.find(item => item.id === row.householdId) ?? null;
            const live = row.linkState === 'live';
            const deletable = row.linkState === 'never_issued' && row.replyCount === 0;
            return (
              <li key={row.householdId} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-xs font-medium">{row.displayName}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{linkWords(row.linkState)}</span>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {answerWords(row)}
                  {row.expectedPartySize === null
                    ? ' · you set no number, so they may answer any headcount up to the page&apos;s own bound'
                    : ` · you expect ${row.expectedPartySize}`}
                  {row.linkExpiresAt !== null ? ` · link runs to ${dayOf(row.linkExpiresAt) ?? row.linkExpiresAt}` : ''}
                  {row.linkLastUsedAt !== null ? ` · opened on ${dayOf(row.linkLastUsedAt) ?? row.linkLastUsedAt}` : ''}
                </p>

                <div className="flex flex-wrap gap-2">
                  {live ? (
                    <>
                      <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs" onClick={() => { void rotate(row.householdId); }} disabled={busy}>
                        New link for them
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs text-destructive" onClick={() => { void withdraw(row.householdId); }} disabled={busy}>
                        Withdraw link
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs" onClick={() => { void send(row.householdId); }} disabled={busy || row.scopedEventCount === 0}>
                      Create their link
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="h-11 rounded-lg text-xs" onClick={() => setScopeFor(current => (current === row.householdId ? null : row.householdId))} disabled={busy}>
                    {scopeFor === row.householdId ? 'Close their events' : 'Their events'}
                  </Button>
                  {household ? (
                    <Button type="button" size="sm" variant="ghost" className="h-11 rounded-lg text-xs" onClick={() => startEdit(household)} disabled={busy}>
                      {editingId === row.householdId ? 'Close edit' : 'Edit details'}
                    </Button>
                  ) : null}
                  {deletable ? (
                    <Button type="button" size="sm" variant="ghost" className="h-11 rounded-lg text-xs text-destructive" onClick={() => { void remove(row); }} disabled={busy}>
                      Remove from list
                    </Button>
                  ) : null}
                </div>

                {!deletable ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {row.replyCount > 0
                      ? `${row.displayName} has ${repliesWord(row.replyCount)} recorded, so their row stays — delete ${row.replyCount === 1 ? 'that reply' : 'those replies'} first if you mean to start that family over.`
                      : `Their link was sent once, so their row stays as the record that it was. Withdrawing it is how you take the address away.`}
                  </p>
                ) : null}

                {scopeFor === row.householdId ? (
                  <ScopeEditor
                    weddingId={weddingId}
                    householdId={row.householdId}
                    displayName={row.displayName}
                    ceremonies={ceremonies}
                    busy={busy}
                    onSaved={text => { setMessage(text); void load(); }}
                    onRefused={text => setError(text)}
                    onClosed={() => setScopeFor(null)}
                  />
                ) : null}

                {editingId === row.householdId && household !== null ? (
                  <HouseForm
                    idPrefix={`guest-edit-${row.householdId}`}
                    draft={editDraft}
                    busy={busy}
                    heading={`Edit ${household.displayName}`}
                    onChange={setEditDraft}
                    onSubmit={() => { void saveEdit(row.householdId); }}
                    submitLabel="Save their details"
                    onCancel={() => setEditingId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {busy ? (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Working…</p>
      ) : null}
      {message !== null ? (
        <p role="status" aria-live="polite" className="text-xs text-success">{message}</p>
      ) : null}
      {error !== null ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
};

export default GuestInvitationPanel;
