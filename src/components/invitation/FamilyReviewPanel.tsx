// Asking a relative to read the invitation before the guests do, and reading back what they said.
//
// This panel is the host's half of Stage 7, and it is deliberately shaped by three facts the
// database already forces:
//
//   * The ask names one *frozen* version. `internal_api.request_family_review` refuses a version
//     that is not this wedding's, and `approval_requests.version_id` pins the ask to it, so a host
//     cannot ask a relative to approve a draft that is still moving under them. The select below
//     lists the versions this page already holds — read by `listInvitationVersions` in
//     `src/integrations/supabase/weddings.ts`, an RLS-governed select on `invitation_versions` and
//     not an RPC — rather than re-reading them: same screen, same read, no second opinion about
//     what exists.
//   * The link is shown once. `private.access_tokens` stores only the SHA-256 digest, so the raw
//     credential exists in exactly one HTTP response: the ask that minted it (`:127-149` of the
//     Stage 7 migration). After a reload the queue can report the link's *state* and never its
//     address, and the honest sentence is "copy it now, or withdraw and ask again" — the same rule
//     `PublicationPanel` lives by for guest links. The token is never written to storage, never
//     logged, and never appears in a `href` the host did not paste.
//   * An answer cannot be unwritten. `approval_feedback` is append-only, and withdrawing a link
//     leaves a recorded decision exactly where it is (`:195-205`). So "withdraw" is described as
//     what it does — it stops the link, and it invalidates an ask nobody has answered yet — rather
//     than as undoing what a relative said.
//
// Nothing here claims a reviewer's identity was verified. `reviewer_display_name` is a word the
// host types and `author_label` is a word the reviewer types; the product's honesty about that is
// directive-level, and the queue prints both as the labels they are.
//
// Two vocabularies are printed, not interpreted: the ask's `status` (what the workflow recorded)
// and its `link_state` (what the credential can still do). They are genuinely independent — an
// answered ask whose link is still live is measured at Q-03 of the Stage 7 HTTP battery — so they
// sit side by side rather than one standing in for the other. A word this build has no label for
// is shown as an unknown word, because inventing a label for it would be a guess about tomorrow's
// migration rendered as today's fact.
//
// The section a note is pinned to is a platform slot key on the wire. `SECTION_LABELS` is this
// product's own word for each slot — the same list the editor prints — so a host reads "A
// blessing" rather than `blessing`, and a key from a newer release reads as the neutral phrase
// rather than as a column name.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getApprovalRequests,
  requestFamilyReview,
  revokeFamilyReview,
} from '@/integrations/supabase/familyReview';
import {
  familyReviewLinkPath,
  type ApprovalHistoryEntry,
  type ApprovalRequestRow,
} from '@/lib/familyReview';
import { SECTION_LABELS } from '@/lib/invitationAuthoring';
import { PACK_SECTION_KEYS, type PackSectionKey } from '@/lib/traditionPackContract';
import type { StoredInvitationVersion } from '@/integrations/supabase/weddings';

const REVIEWER_NAME_MAX = 120;

/** The link's lifetime the database gives an ask when no expiry is offered (`:116`). Stated here
 *  because the host is being asked to copy an address and hand it to a relative; a link that stops
 *  working silently is a worse surprise than one that says when. */
const DEFAULT_LIFETIME = 'two weeks';

const STATUS_WORDS: Record<string, string> = {
  pending: 'Waiting for their answer',
  approved: 'Approved',
  changes_requested: 'Asked for changes',
  invalidated: 'Withdrawn before an answer',
};

/** What one recorded note is. A `decision` row carries `approved` or `changes_requested` and the
 *  panel reads that word first; `comment` is the schema's other kind, and the Stage 7 workflow
 *  writes only decisions today — so the word is here to print honestly if a later read ever does. */
const KIND_WORDS: Record<string, string> = {
  decision: 'An answer',
  comment: 'A comment',
};

const LINK_STATE_WORDS: Record<string, string> = {
  never_issued: 'No link was ever issued',
  live: 'Link still works',
  expired: 'Link has run out',
  revoked: 'Link withdrawn',
};

const statusWords = (status: string): string =>
  STATUS_WORDS[status] ?? `This build has no word for “${status}” yet`;

const kindWords = (kind: string): string =>
  KIND_WORDS[kind] ?? `This build has no word for “${kind}” yet`;

const linkWords = (linkState: string): string =>
  LINK_STATE_WORDS[linkState] ?? `This build has no word for “${linkState}” yet`;

const slotWords = (sectionKey: string | null): string => {
  if (sectionKey === null) return 'not about one particular part';
  if (!PACK_SECTION_KEYS.includes(sectionKey as PackSectionKey)) return 'about a part of the invitation';
  return `about ${SECTION_LABELS[sectionKey as PackSectionKey].toLowerCase()}`;
};

const formatDay = (iso: string | null): string | null => {
  if (iso === null) return null;
  // The server's own calendar day, read off the front of its timestamp rather than parsed into
  // the host's timezone: this column says when a record was written, and a host comparing it to
  // the version list beside it is comparing two of the same stamps.
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

export interface FamilyReviewPanelProps {
  weddingId: string;
  /** The versions this page already lists, newest first. An ask must name one, so an empty list
   *  is a disabled button with a reason rather than an empty select. */
  versions: StoredInvitationVersion[];
}

/** The first word on a recorded note. A decision row leads with its decision — the same two words
 *  the ask's own status prints, because that answer is what moved the ask. A row with no decision
 *  is the schema's other kind, and is named by kind. An unfamiliar word is shown as itself, for
 *  the same reason the statuses are: guessing a label for a future migration's vocabulary would
 *  put it on screen as this build's fact. */
const headWords = (entry: ApprovalHistoryEntry): string => {
  if (entry.decision === null) return kindWords(entry.kind);
  if (entry.decision === 'approved') return 'Approved';
  if (entry.decision === 'changes_requested') return 'Asked for changes';
  return `A decision this build has no word for (“${entry.decision}”)`;
};

const HistoryList = ({ row }: { row: ApprovalRequestRow }) => {
  if (row.history.length === 0) {
    return <p className="text-[11px] text-muted-foreground">Nothing recorded yet.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {row.history.map(entry => (
        <li key={entry.id} className="rounded-md border border-border px-2 py-1.5">
          <p className="text-[11px] leading-snug">
            <span className="font-medium">
              {headWords(entry)}
            </span>
            {' · '}{slotWords(entry.sectionKey)}
            {entry.createdAt !== null ? ` · ${formatDay(entry.createdAt) ?? entry.createdAt}` : ''}
          </p>
          {entry.message !== null ? (
            <p className="mt-1 whitespace-pre-line break-words text-[11px] leading-snug text-muted-foreground">
              {entry.message}
            </p>
          ) : null}
          {entry.authorLabel !== null ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Signed as {entry.authorLabel}.</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

const FamilyReviewPanel = ({ weddingId, versions }: FamilyReviewPanelProps) => {
  const [rows, setRows] = useState<ApprovalRequestRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [versionId, setVersionId] = useState<string | null>(null);
  /** The one link this session has ever been handed. Held in state, never in storage: a reload
   *  cannot get it back, which is the point. */
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = versionId ?? versions[0]?.id ?? null;

  /** Same ticket discipline as the asset panel: the mount read, the retry and the re-read after
   *  every write all answer into `rows`, and a late queue from before a withdrawal must not put
   *  a withdrawn link back on screen as live. */
  const readTicket = useRef(0);

  const load = useCallback(async () => {
    readTicket.current += 1;
    const ticket = readTicket.current;
    const result = await getApprovalRequests(weddingId);
    if (ticket !== readTicket.current) return;
    if (result.error !== null || result.data === null) {
      setLoadError(result.error ?? 'the review queue could not be read');
      return;
    }
    setRows(result.data);
    setLoadError(null);
  }, [weddingId]);

  useEffect(() => {
    setRows(null);
    setLoadError(null);
    void load();
  }, [load]);

  const ask = async () => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await requestFamilyReview(weddingId, selected, reviewerName.trim());
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setError(result.error ?? 'the review request could not be made');
      return;
    }
    const link = familyReviewLinkPath(result.data.token);
    if (link === null) {
      // The adapter shape-tests the credential, so this cannot be a mistyped token; it is the
      // resolver having handed back something this build does not recognise, and the honest
      // answer is that no address was formed rather than a partial one.
      setError('a review link could not be formed from that answer. Nothing was sent.');
      return;
    }
    setReviewUrl(`${window.location.origin}${link.path}`);
    setReviewerName('');
    setMessage('Their link is ready. Copy it now — it cannot be shown again.');
    await load();
  };

  const withdraw = async (row: ApprovalRequestRow) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await revokeFamilyReview(row.requestId);
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setError(result.error ?? 'that review link could not be withdrawn');
      await load();
      return;
    }
    const outcome = result.data;
    setMessage(
      outcome.wasPending
        ? 'That ask is withdrawn and its link no longer opens anything.'
        : outcome.credentialRevoked
          ? 'Their link is withdrawn. The answer they already gave stands as recorded.'
          : 'That ask had no live link left to withdraw.',
    );
    await load();
  };

  const copy = async () => {
    if (reviewUrl === null) return;
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
    } catch {
      // The address is on screen as text, so a browser that refuses the clipboard has cost the
      // host a click and nothing else.
      setCopied(false);
    }
  };

  const row = (request: ApprovalRequestRow) => (
    <li key={request.requestId} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs">
          <span className="font-medium">{request.reviewerDisplayName}</span>
          {` · version ${request.versionNumber}`}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 shrink-0 rounded-lg text-xs text-muted-foreground"
          onClick={() => { void withdraw(request); }}
          disabled={busy}
        >
          Withdraw link
        </Button>
      </div>
      <p className="text-[11px] leading-snug">
        {statusWords(request.status)} · {linkWords(request.linkState)}
        {request.requestedAt !== null ? ` · asked ${formatDay(request.requestedAt) ?? request.requestedAt}` : ''}
        {request.respondedAt !== null ? ` · answered ${formatDay(request.respondedAt) ?? request.respondedAt}` : ''}
      </p>
      <HistoryList row={request} />
    </li>
  );

  return (
    <section className="space-y-3" aria-labelledby="family-review-heading">
      <h2 id="family-review-heading" className="font-display font-semibold text-sm">
        Family approval
      </h2>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Send one frozen version to one relative for a look. They open it on their phone with no
        account, and their answer comes back to you here.
      </p>

      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label htmlFor="review-version" className="text-[11px] font-medium">
            Which version should they read?
          </Label>
          {versions.length > 0 ? (
            <select
              id="review-version"
              value={selected ?? ''}
              onChange={event => setVersionId(event.target.value)}
              disabled={busy}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-xs"
            >
              {versions.map(version => (
                <option key={version.id} value={version.id}>
                  {`Version ${version.versionNumber}${formatDay(version.createdAt) ? ` · ${formatDay(version.createdAt)}` : ''}`}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Nothing to send yet — freeze a version under <em>Share with guests</em> first. A
              review is always about one frozen version, never about a draft still changing.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="reviewer-name" className="text-[11px] font-medium">
            Who are you asking?
          </Label>
          <Input
            id="reviewer-name"
            value={reviewerName}
            onChange={event => setReviewerName(event.target.value)}
            maxLength={REVIEWER_NAME_MAX}
            disabled={busy || versions.length === 0}
            className="h-11 text-xs"
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Their name as you want it to appear on your page. This product does not check who
            opens the link — it only lets the family send it to somebody they trust.
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 rounded-lg text-xs"
          onClick={() => { void ask(); }}
          disabled={busy || versions.length === 0 || reviewerName.trim() === ''}
        >
          Ask them to review it
        </Button>

        <p className="text-[11px] leading-snug text-muted-foreground">
          The link they get works for {DEFAULT_LIFETIME}, or until you withdraw it, and it opens
          that one version for reading and one answer only.
        </p>
      </div>

      {reviewUrl !== null ? (
        <div className="space-y-2 rounded-lg border border-gold/50 bg-paper p-3">
          <p className="text-xs font-medium">This is their review link. It is shown once.</p>
          <p className="break-all font-mono text-xs">{reviewUrl}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 rounded-lg text-xs"
            onClick={() => { void copy(); }}
          >
            Copy
          </Button>
          <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
            {copied
              ? 'Copied to the clipboard.'
              : 'Nothing has been sent to anyone. Copy it, or hand the link over yourself.'}
          </p>
        </div>
      ) : null}

      {rows === null && loadError === null ? (
        <p className="animate-pulse text-xs text-muted-foreground">Loading your review queue…</p>
      ) : null}

      {loadError !== null ? (
        <>
          <p role="alert" className="text-xs text-destructive">{loadError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 rounded-lg text-xs"
            onClick={() => { void load(); }}
          >
            Try again
          </Button>
        </>
      ) : null}

      {rows !== null ? (
        rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            You have not asked anyone to review this invitation yet.
          </p>
        ) : (
          <ul className="space-y-2">{rows.map(row)}</ul>
        )
      ) : null}

      {busy ? (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          Working…
        </p>
      ) : null}

      {message !== null ? (
        <p role="status" aria-live="polite" className="text-xs text-success">{message}</p>
      ) : null}

      {error !== null ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
};

export default FamilyReviewPanel;
