// What was rendered for this wedding, and how a host gets the bytes.
//
// This is the host's half of Stage 9: one list of artefacts, one way to open each of them, and the
// reprint sentences §9.2 requires. Its shape is decided by four facts the substrate already forces.
//
//   * **Nothing here makes a file.** The bytes are drawn by the locally operated Chromium worker, which
//     is the only thing with a privileged write path to the manifest; a browser session cannot insert
//     a row at all (`invitation_outputs_no_client_write`, and no INSERT grant to any client role). So
//     the empty state names the worker rather than offering a "render this" button that would promise
//     an operation the product does not have, and the Refresh button re-reads rather than re-renders.
//   * **A `ready` row is the only one with bytes behind it.** `registered` and `uploading` are a queue,
//     `failed` is a queue that gave up and keeps the sentence why, and `invalidated` is §8's lifetime
//     rule: the object was removed with the row's retirement. A download affordance on any of those
//     four would be a button that returns nothing, so each gets its own words instead.
//   * **Delivery is a 60-second signed URL, minted on the host's press.** §8 gives the private bucket
//     exactly one read path — the host's own session — and Stage 6 measured that shape. The link is
//     asked for when it is needed and held in component state, never printed as text and never kept
//     across a refresh, so a copied address dies on its own.
//   * **The panel cannot tell a live QR plate from a stale-but-unreplaced one.** The projection carries
//     no `target_url_digest` (`:550-554` of the migration) and no raw address exists to compare with,
//     so the reprint notices below are derived from rows that *were* retired, plus one sentence that
//     states the limit. A panel that claimed a printed plate was verified current would be inventing a
//     fact the privacy boundary removed from reach.
//
// Unfamiliar vocabulary is printed as what it is: `this build has no word for the kind "…"`, by way of
// `src/lib/invitationOutputs.ts`, the same posture Stages 7 and 8 took at their own boundaries.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  listInvitationOutputs,
  signedOutputUrl,
  OUTPUT_LINK_SECONDS,
} from '@/integrations/supabase/invitationOutputs';
import type { InvitationOutput } from '@/lib/invitationOutputs';
import {
  dayOf,
  isDeliverable,
  outputDeliveryPath,
  outputSummary,
  reasonWords,
  reprintWarnings,
  statusWords,
} from '@/lib/invitationOutputs';

export interface InvitationOutputsPanelProps {
  /** The wedding whose manifest to read. The delivery address is composed from it, which is why the
   *  panel needs the id rather than only the rows. */
  weddingId: string;
  /** Bumped by the page after it publishes, rotates or takes the link down. Those three acts are the
   *  moments at which this list stops describing the invitation the guest is reading, so the panel
   *  re-reads rather than showing a manifest gathered before them. The re-read reports whatever the
   *  worker has since recorded — retirement is the worker's privileged write, not something a token
   *  turnover does by itself — which is exactly why the panel asks again instead of reasoning about
   *  what it expects to find. */
  refreshKey: number;
}

const KIND_ORDER = ['og_image', 'share_image', 'pdf', 'qr'] as const;

/** Rows in the server's own grouping, with any kind this build does not know kept last rather than
 *  dropped — an artefact from a future migration should still be listed. */
const groupsOf = (outputs: InvitationOutput[]): { kind: string; rows: InvitationOutput[] }[] => {
  const byKind = new Map<string, InvitationOutput[]>();
  for (const row of outputs) {
    const bucket = byKind.get(row.kind);
    if (bucket === undefined) byKind.set(row.kind, [row]);
    else bucket.push(row);
  }
  const known = KIND_ORDER.filter(kind => byKind.has(kind));
  const rest = [...byKind.keys()].filter(kind => !(KIND_ORDER as readonly string[]).includes(kind));
  return [...known, ...rest].map(kind => ({ kind, rows: byKind.get(kind) ?? [] }));
};

const fileWords = (output: InvitationOutput): string => {
  if (output.status === 'ready') return 'Ready to open.';
  if (output.status === 'invalidated') {
    // Stated as a fact about the row rather than about the bucket: §8 makes the object's removal part
    // of retirement, but this read cannot see Storage, and a panel that reported a deleted file would
    // be reporting something it had not measured. What it has measured is that the row is retired and
    // therefore offers no way to open it.
    return output.invalidationReason === null
      ? 'Retired, so this row no longer offers a file to open.'
      : `Retired — ${reasonWords(output.invalidationReason)} — so this row no longer offers a file to open.`;
  }
  if (output.status === 'failed') {
    return `Failed after ${output.attemptCount} ${output.attemptCount === 1 ? 'attempt' : 'attempts'}.`
      + (output.lastError === null ? '' : ` The worker said: ${output.lastError}`);
  }
  if (output.status === 'uploading') return 'Being drawn now.';
  if (output.status === 'registered') return 'Queued for the worker.';
  return statusWords(output.status);
};

/** The heading for a group, in the same words the rows use. Kept apart from `kindWords` so the
 *  heading can be a sentence fragment a host reads as a section, not a product name. */
const statusKindHeading = (kind: string): string =>
  kind === 'og_image' ? 'Link preview'
    : kind === 'share_image' ? 'Share images'
      : kind === 'pdf' ? 'Print-ready PDF'
        : kind === 'qr' ? 'QR plates'
          : `this build has no word for the kind “${kind}”`;

const InvitationOutputsPanel = ({ weddingId, refreshKey }: InvitationOutputsPanelProps) => {
  const [outputs, setOutputs] = useState<InvitationOutput[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** One row id to one live address. Held here so it is dropped on every re-read and never written
   *  anywhere a later page could pick it up. */
  const [links, setLinks] = useState<Record<string, string>>({});
  /** Which `load` is still the current question, for the reason the asset panel gives: a re-read
   *  started by a refresh and a slow first read can answer in either order. */
  const ticket = useRef(0);

  const load = useCallback(async () => {
    ticket.current += 1;
    const mine = ticket.current;
    setBusy(true);
    const result = await listInvitationOutputs(weddingId);
    if (mine !== ticket.current) return;
    setBusy(false);
    if (result.error !== null || result.data === null) {
      // A failed read keeps the last list on screen: it says something about the read, not about the
      // wedding's files.
      setLoadError(result.error ?? 'the list of files could not be read');
      return;
    }
    setOutputs(result.data);
    setLinks({});
    setLoadError(null);
  }, [weddingId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const openLink = async (output: InvitationOutput) => {
    setBusy(true);
    const result = await signedOutputUrl(weddingId, output);
    setBusy(false);
    if (result.error !== null || result.data === null) {
      setMessage(result.error ?? 'the file could not be opened');
      return;
    }
    setLinks(current => ({ ...current, [output.id]: result.data }));
    setMessage(null);
  };

  const groups = outputs === null ? [] : groupsOf(outputs);
  const notices = outputs === null ? [] : reprintWarnings(outputs);
  const readyCount = outputs === null ? 0 : outputs.filter(isDeliverable).length;

  return (
    <section className="space-y-4" aria-labelledby="outputs-heading">
      <div className="flex items-start justify-between gap-2">
        <h2 id="outputs-heading" className="font-display text-sm font-semibold">
          Files made from your invitation
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-lg h-11"
          onClick={() => { void load(); }}
          disabled={busy}
        >
          Refresh
        </Button>
      </div>

      {outputs === null && loadError === null ? (
        <p className="text-sm text-muted-foreground">Loading your files…</p>
      ) : null}

      {loadError !== null ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg h-11"
            onClick={() => { void load(); }}
            disabled={busy}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {outputs !== null && outputs.length === 0 ? (
        <p className="text-sm leading-snug text-muted-foreground">
          Nothing has been rendered for this invitation yet. These files — a link preview image,
          share images, a print-ready PDF and QR plates — are drawn by the render worker on the
          machine that runs it, from one frozen version. This page lists what that worker has made; it
          cannot start a render. Publish a version, run the worker against it, and press Refresh.
        </p>
      ) : null}

      {notices.length > 0 ? (
        <ul className="space-y-2" role="status" aria-live="polite">
          {notices.map(notice => (
            <li
              key={notice}
              className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-snug text-warning"
            >
              {notice}
            </li>
          ))}
        </ul>
      ) : null}

      {outputs !== null && outputs.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            {outputs.length} {outputs.length === 1 ? 'file is' : 'files are'} recorded for this
            wedding, {readyCount} of {readyCount === 1 ? 'it openable' : 'them openable'} right now.
            Every one of them was drawn from a frozen version, so its wording cannot have moved since.
          </p>

          {groups.map(group => (
            <div key={group.kind} className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{statusKindHeading(group.kind)}</h3>
              <ul className="space-y-3">
                {group.rows.map(output => (
                  <li key={output.id} className="space-y-1 rounded-lg border border-border/60 bg-paper p-3">
                    <p className="text-xs font-medium">{outputSummary(output)}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{fileWords(output)}</p>
                    {output.contentDigest !== null ? (
                      <p className="text-[11px] text-muted-foreground">
                        File fingerprint{' '}
                        <span className="font-mono">{output.contentDigest.slice(0, 12)}</span>
                        {' '}— the first twelve characters of the SHA-256 of the bytes that were checked
                        back in.
                      </p>
                    ) : null}
                    {output.status === 'ready' ? (
                      <p className="text-[11px] text-muted-foreground">
                        Made {dayOf(output.readyAt) ?? 'when this build lost track'}.
                      </p>
                    ) : null}

                    {isDeliverable(output) ? (
                      // The affordance appears only where pressing it can work: `outputDeliveryPath`
                      // answers null for a published-preview row and for any row carrying a kind or
                      // size this build does not know, and a button that returns a refusal sentence is
                      // the control Stage 8's panel refused to build. The reason is printed in words
                      // instead, so the row is never a silent absence.
                      outputDeliveryPath(weddingId, output) === null ? (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          {output.storageDomain === 'published_preview'
                            ? 'This one is the published preview: a crawler or a chat app fetches it by its own '
                              + 'address, and no link is minted for it from this page.'
                            : 'This build cannot work out where this file is kept, so it offers nothing to press. '
                              + 'A row like this comes from a version of the manifest this page does not recognise.'}
                        </p>
                      ) : links[output.id] === undefined ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-lg h-11"
                          onClick={() => { void openLink(output); }}
                          disabled={busy}
                        >
                          Get a temporary link
                        </Button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={links[output.id]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-11 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Open the file
                          </a>
                          <span className="text-[11px] text-muted-foreground">
                            Works for {OUTPUT_LINK_SECONDS} seconds. Save it from the tab it opens.
                          </span>
                        </div>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : null}

      {message !== null ? (
        <p role="status" aria-live="polite" className="text-sm text-destructive">{message}</p>
      ) : null}
    </section>
  );
};

export default InvitationOutputsPanel;
