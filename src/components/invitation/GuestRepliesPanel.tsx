// What the families actually said, and the host's own hand-written entries beside them.
//
// This panel reads `rsvp_responses` through the owner policies Stage 2 wrote for it
// (`20260925120500_stage2_rls_and_grants.sql:270-299`) rather than through a seventh `api` verb,
// because §8 of `docs/architecture/guest-rsvp-security.md` sorts capabilities by one test: secrets and
// cross-row computations go behind `api` wrappers, host-owned content moves through table grants. A
// reply row is host-owned content, and the row list, the manual entry and the delete are three plain
// reads and writes.
//
// Four rules from §7 decide what is on screen:
//
//   * Two sources, never merged. `response_source` is `'guest'` only when the anonymous door wrote it
//     and `'host_manual'` only when this screen did, a distinction the INSERT and UPDATE policies
//     enforce in their WITH CHECK arms (`20260925120500…:278-294`) and that this panel prints as words
//     beside every row. So the honest answer to "the family phoned to change what they sent online" is
//     the two actions §7 rules in and this screen states in those words — delete their reply, then
//     record what they told you. There is deliberately no edit control on a guest's row: a host may not
//     save an edit that presents their own number as the family's, and a silent overwrite is exactly
//     what the policy exists to refuse.
//   * A household answers per event, not per wedding, so the list is one row per (family, ceremony) and
//     the count a host wants is per family — printed here as rows, not as an attendance total, because
//     summing households is the arithmetic the guest door is built to make impossible.
//   * The manual party size is *not* capped. `expected_party_size` is the host's expectation and it
//     bounds only the guest's own answer; when a family phones to say three more are coming, the host is
//     stating a fact (§7's asymmetry), so the number field here asks for a whole number and nothing else.
//   * A manual answer can only be recorded for an event the family is invited to, which the composite
//     key from `rsvp_responses` onto `household_event_scopes`
//     (`20260925120300_stage2_guests_approvals_rsvp.sql:93-94`) enforces as a `23503`. The event list
//     below is filtered to that household's scopes so the form cannot offer a choice the database will
//     refuse; the refusal is still handled, because a scope can be taken away in another tab.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  listGuestReplies,
  recordManualReply,
  removeGuestReply,
  listGuestHouseholds,
  listHouseholdEventScopes,
  type GuestReply,
  type GuestHousehold,
  type AttendanceChoice,
} from '@/integrations/supabase/guestInvitations';
import { listCeremonies, type CeremonyEntry } from '@/integrations/supabase/weddingContent';
// The same two words the guest door's form is built from (`src/lib/guestInvitation.ts:46`), so the host's
// transcription and the family's own answer are typed by one vocabulary rather than two that can drift.
import { ATTENDANCE_LABELS } from '@/lib/guestInvitation';

const SOURCE_WORDS: Record<string, string> = {
  guest: 'they sent it themselves',
  host_manual: 'you recorded it',
};

const sourceWords = (source: string): string =>
  SOURCE_WORDS[source] ?? `recorded by a route this build has no word for (“${source}”)`;

/** The two answer words the column's CHECK admits
 *  (`20260925120300_stage2_guests_approvals_rsvp.sql:78`). An unfamiliar word is the family's own
 *  recorded answer and is printed as itself rather than mapped onto a radio, for the same reason
 *  Stage 7's queue prints an unknown status: guessing at tomorrow's vocabulary would render it as
 *  today's fact. */
const answerWords = (attending: string, partySize: number): string => {
  const guests = `${partySize} ${partySize === 1 ? 'guest' : 'guests'}`;
  if (attending === 'attending') return `coming · ${guests}`;
  if (attending === 'declined') return 'not coming';
  return `recorded as “${attending}” · ${partySize}`;
};

const stampOf = (iso: string): string => {
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : iso;
};

interface ManualDraft {
  householdId: string;
  eventId: string;
  attending: AttendanceChoice | null;
  partySize: string;
}

const EMPTY_DRAFT: ManualDraft = { householdId: '', eventId: '', attending: null, partySize: '' };

export interface GuestRepliesPanelProps {
  weddingId: string;
}

const GuestRepliesPanel = ({ weddingId }: GuestRepliesPanelProps) => {
  const [replies, setReplies] = useState<GuestReply[] | null>(null);
  const [households, setHouseholds] = useState<GuestHousehold[]>([]);
  const [ceremonies, setCeremonies] = useState<CeremonyEntry[]>([]);
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_DRAFT);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readTicket = useRef(0);

  const load = useCallback(async () => {
    readTicket.current += 1;
    const ticket = readTicket.current;
    const [list, people, events] = await Promise.all([
      listGuestReplies(weddingId),
      listGuestHouseholds(weddingId),
      listCeremonies(weddingId),
    ]);
    if (ticket !== readTicket.current) return;
    if (list.data === null) {
      setLoadError(list.error ?? 'the replies could not be loaded');
      return;
    }
    setReplies(list.data);
    setHouseholds(people.data ?? []);
    setCeremonies(events.data ?? []);
    setLoadError(null);
  }, [weddingId]);

  useEffect(() => {
    setReplies(null);
    setLoadError(null);
    void load();
  }, [load]);

  /** The chosen family's scopes, read on demand: the manual form may only offer events they are invited
   *  to, and that is a fact about their rows rather than something to infer from the wedding's list. */
  useEffect(() => {
    if (draft.householdId === '') {
      setScopes(null);
      return;
    }
    let live = true;
    void listHouseholdEventScopes(weddingId, draft.householdId).then(result => {
      if (!live) return;
      setScopes(result.data ?? []);
    });
    return () => {
      live = false;
    };
  }, [weddingId, draft.householdId]);

  const householdName = (householdId: string): string =>
    households.find(household => household.id === householdId)?.displayName ?? 'a family';

  const eventName = (eventId: string): string =>
    ceremonies.find(event => event.id === eventId)?.displayName ?? 'an event';

  const scopedEvents = ceremonies.filter(ceremony => scopes?.includes(ceremony.id) ?? false);

  const record = async () => {
    if (draft.householdId === '' || draft.eventId === '' || draft.attending === null) return;
    const size = Number(draft.partySize.trim());
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await recordManualReply(weddingId, {
      householdId: draft.householdId,
      eventId: draft.eventId,
      attending: draft.attending,
      // A decline answers with 0, which is the arithmetic the guest door writes too
      // (`src/pages/GuestDoor.tsx`'s submit path) — not a headcount nobody typed.
      partySize: draft.attending === 'declined' ? 0 : size,
    });
    setBusy(false);
    if (result.data === null) {
      setError(result.error ?? 'the replies could not be saved');
      await load();
      return;
    }
    setDraft(EMPTY_DRAFT);
    // `recordManualReply` answers with only the new row's id
    // (`src/integrations/supabase/guestInvitations.ts:439-463`), and the draft this call was made from is
    // still in this closure, so the family is named from it rather than from a ternary on an id the
    // screen never reads.
    setMessage(`Recorded for ${householdName(draft.householdId)}.`);
    await load();
  };

  const erase = async (reply: GuestReply) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await removeGuestReply(weddingId, reply.id);
    setBusy(false);
    // `removeGuestReply` answers with `QueryResult<null>`, so its data half is empty on the success
    // path too — the error is the only thing that tells the two apart. Reading `data === null` here
    // would print "could not be saved" over a row the database has already deleted, which is the
    // worse direction for a host to be wrong in: they would click Delete a second time.
    if (result.error !== null) {
      setError(result.error);
      await load();
      return;
    }
    setMessage(
      reply.responseSource === 'guest'
        ? `Deleted what ${householdName(reply.householdId)} sent for ${eventName(reply.eventId)}. Their link still works, so they can answer again — and if they told you something else by phone, record that now.`
        : `Deleted your own entry for ${householdName(reply.householdId)} at ${eventName(reply.eventId)}.`,
    );
    await load();
  };

  const canRecord =
    draft.householdId !== '' && draft.eventId !== '' && draft.attending !== null
    && (draft.attending === 'declined' || /^\d+$/.test(draft.partySize.trim()));

  return (
    <section className="space-y-3" aria-labelledby="guest-replies-heading">
      <h2 id="guest-replies-heading" className="font-display font-semibold text-sm">
        Replies
      </h2>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Every answer this wedding holds, one line per family per event, with who wrote it: them or you.
        Only you and the families of this wedding can see this list.
      </p>

      {loadError !== null ? (
        <>
          <p role="alert" className="text-xs text-destructive">{loadError}</p>
          <Button type="button" size="sm" variant="outline" className="h-11 rounded-lg text-xs" onClick={() => { void load(); }}>
            Try again
          </Button>
        </>
      ) : null}

      {replies === null && loadError === null ? (
        <p className="animate-pulse text-xs text-muted-foreground">Loading replies…</p>
      ) : null}

      {replies !== null && replies.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody has answered yet. When a family replies on their own link it appears here, and you can
          write an answer they gave you by phone in the same list.
        </p>
      ) : null}

      {replies !== null && replies.length > 0 ? (
        <ul className="space-y-2">
          {replies.map(reply => (
            <li key={reply.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-3">
              <p className="min-w-0 text-xs leading-snug">
                <span className="font-medium">{householdName(reply.householdId)}</span>
                {` · ${eventName(reply.eventId)}`}
                <span className="block text-[11px] text-muted-foreground">
                  {answerWords(reply.attending, reply.partySize)}
                  {` · ${sourceWords(reply.responseSource)} · ${stampOf(reply.respondedAt)}`}
                </span>
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 shrink-0 rounded-lg text-xs text-destructive"
                onClick={() => { void erase(reply); }}
                disabled={busy}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <fieldset className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
        <legend className="px-1 text-[11px] font-medium">Write in an answer they gave you</legend>

        <div className="space-y-1">
          <Label htmlFor="reply-household" className="text-[11px] font-medium">Which family?</Label>
          <select
            id="reply-household"
            value={draft.householdId}
            disabled={busy || households.length === 0}
            onChange={event => setDraft({ ...EMPTY_DRAFT, householdId: event.target.value })}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-xs"
          >
            <option value="">Choose a family</option>
            {households.map(household => (
              <option key={household.id} value={household.id}>{household.displayName}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="reply-event" className="text-[11px] font-medium">Which event of theirs?</Label>
          {draft.householdId === '' ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Choose the family first — you can only record an answer for an event they were invited to.
            </p>
          ) : scopes === null ? (
            <p className="animate-pulse text-[11px] text-muted-foreground">Loading their events…</p>
          ) : scopedEvents.length === 0 ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              That family is invited to no event, so there is nothing to record. Set their events under{' '}
              <em>Guest invitations</em> first.
            </p>
          ) : (
            <select
              id="reply-event"
              value={draft.eventId}
              disabled={busy}
              onChange={event => setDraft({ ...draft, eventId: event.target.value })}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="">Choose an event</option>
              {scopedEvents.map(event => (
                <option key={event.id} value={event.id}>{event.displayName}</option>
              ))}
            </select>
          )}
        </div>

        <fieldset className="space-y-1">
          <legend className="text-[11px] font-medium">What did they say?</legend>
          {ATTENDANCE_LABELS.map(choice => {
            const boxId = `reply-${choice}`;
            return (
              <label key={choice} htmlFor={boxId} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  id={boxId}
                  type="radio"
                  name="reply-attending"
                  checked={draft.attending === choice}
                  disabled={busy}
                  className="h-5 w-5 shrink-0 accent-primary"
                  onChange={() => setDraft({ ...draft, attending: choice })}
                />
                <span className="text-xs">{choice === 'attending' ? 'They are coming' : 'They are not coming'}</span>
              </label>
            );
          })}
        </fieldset>

        {draft.attending === 'attending' ? (
          <div className="space-y-1">
            <Label htmlFor="reply-size" className="text-[11px] font-medium">How many, as they told you?</Label>
            <Input
              id="reply-size"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.partySize}
              disabled={busy}
              onChange={event => setDraft({ ...draft, partySize: event.target.value })}
              className="h-11 text-xs"
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Write the number they actually gave you. This field is not held to what you expected of
              them — the expected number bounds only the reply they send on their own link.
            </p>
          </div>
        ) : null}

        <p className="text-[11px] leading-snug text-muted-foreground">
          If a family already answered on their link and told you something different by phone, delete
          their reply above and record this one. Their answer stays marked as theirs, or yours, and never
          both.
        </p>

        <Button type="button" size="sm" className="h-11 rounded-lg text-xs" onClick={() => { void record(); }} disabled={busy || !canRecord}>
          Record their answer
        </Button>
      </fieldset>

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

export default GuestRepliesPanel;
