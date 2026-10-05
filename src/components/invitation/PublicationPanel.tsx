// Turning a saved draft into something a guest can open.
//
// The order of the buttons is the order of the guarantees behind them. A version is
// frozen first (`api.create_invitation_version` copies the snapshot; nothing later edits
// it), and only then does a publication point the live link at that exact version
// (`api.publish_invitation_version`). The host is never offered "publish my draft",
// because there is no such operation: publishing an invitation that is still moving
// would make the link's content depend on when the guest clicked it.
//
// What this panel cannot do, and says so instead of working around it:
//   * Show a live link's address again. The database stores only its SHA-256 digest, so
//     the raw credential exists in exactly one HTTP response — the call that minted it.
//     After a reload the honest answer is "copy it from where you shared it, or make a
//     new link", and rotation is offered as that new link.
//   * Claim anything was sent. There is no message, no invite, no delivery read; the
//     buttons hand the host a URL and a chat app takes it from there.
//   * Bring a taken-down link back. Revocation is permanent by design; only a new
//     publication of a new version can produce a working address.
//   * Offer a freeze while the wedding stands on a release the platform has retired. Publishing
//     a version frozen earlier is still offered — a retired release must keep serving every
//     document already frozen from it — and the notice that explains the missing freeze says so,
//     because a host who is told their pack is out of date will otherwise assume the page their
//     guests are reading is about to change under them.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type {
  PublicationState,
  SelectedReleaseSummary,
} from '@/integrations/supabase/publication';
import type { StoredInvitationVersion } from '@/integrations/supabase/weddings';
import { retiredReleaseNotice } from '@/lib/invitationAuthoring';

export interface PublicationPanelProps {
  /** The address this session was handed, or null when none was minted. */
  shareUrl: string | null;
  state: PublicationState | null;
  versions: StoredInvitationVersion[];
  /** `api.create_invitation_version` refuses a wedding with no language, and a guest
   *  reading text in an unknown language is not a thing to discover after the freeze.
   *  The plan is shown as a precondition, not inferred from a failure. */
  languageChosen: boolean;
  /** A blocking finding from `api.preview_invitation_document`. The button goes quiet while the
   *  server says a version cannot be made, because pressing it would only earn the host a
   *  refusal — but this is a courtesy, not the rule: the freeze call re-checks the same records,
   *  and a host on an older bundle whose server result we have not read still reaches the
   *  button and still gets the truth from the database. */
  serverBlocking: boolean;
  /** The release this wedding points at, when it points at one and that release has been
   *  retired since. A separate prop rather than one more entry in `serverBlocking`, because no
   *  `issues` record says it: the refusal is `versions_pack_release_gate` at the version INSERT,
   *  and §21 requires that a host be told it in words that also promise their *existing* versions
   *  and live link do not change — a promise that belongs beside the buttons those versions are
   *  published with. The summary is passed rather than a boolean because naming the release is
   *  itself something §21 asks the host to be able to inspect. Same courtesy, same
   *  non-enforcement: the freeze call checks the release again on the server. */
  retiredRelease: SelectedReleaseSummary | null;
  busy: boolean;
  /** What just happened, in the page's words: a version froze, a link went live. */
  message: string | null;
  /** Why something did not happen. The adapter's phrase, never the database's. */
  notice: string | null;
  onCreateVersion: () => void;
  onPublish: (versionId: string) => void;
  onRotate: () => void;
  onRevoke: () => void;
}

const formatDate = (iso: string | null): string | null => {
  if (iso === null) return null;
  // `2026-11-14T09:12:00.123456+00:00` — the first ten characters are the calendar day
  // the server wrote. Read, not parsed: this is a stamp about when a record was made, and
  // moving it into the visitor's timezone would describe a different day.
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

const StatusLine = ({ state }: { state: PublicationState | null }) => {
  if (state === null) {
    return <p className="text-sm text-muted-foreground">This invitation has not been published yet.</p>;
  }
  if (state.linkActive) {
    const day = formatDate(state.publishedAt);
    return (
      <p className="text-sm">
        <span className="font-medium text-success">A link is live</span>
        {state.versionNumber !== null ? <> showing version {state.versionNumber}</> : null}
        {day !== null ? <> since {day}</> : null}.
      </p>
    );
  }
  const expired = state.linkExpiresAt !== null && Date.parse(state.linkExpiresAt) < Date.now();
  return (
    <p className="text-sm">
      <span className="font-medium text-warning">
        {expired ? 'The link has expired' : 'The link was taken down'}
      </span>
      . Guests who try it are told the invitation is not available.
    </p>
  );
};

const PublicationPanel = ({
  shareUrl,
  state,
  versions,
  languageChosen,
  serverBlocking,
  retiredRelease,
  busy,
  message,
  notice,
  onCreateVersion,
  onPublish,
  onRotate,
  onRevoke,
}: PublicationPanelProps) => {
  const [versionId, setVersionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const selected = versionId ?? versions[0]?.id ?? null;
  const latest = versions[0] ?? null;

  const copy = async () => {
    if (shareUrl === null) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      // The address is already on screen as text, so a browser that refuses the
      // clipboard has lost nothing except the button's convenience.
      setCopied(false);
    }
  };

  const share = async () => {
    if (shareUrl === null || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: 'Wedding invitation', url: shareUrl });
    } catch {
      // A dismissed share sheet is not a failure to report. The address stays on screen.
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="publication-heading">
      <h2 id="publication-heading" className="font-display text-sm font-semibold">
        Share with guests
      </h2>

      <StatusLine state={state} />

      {retiredRelease !== null ? (
        // Outside the numbered steps, because it is a fact about the invitation rather than a
        // step's precondition, and because the sentence has to be readable while the host is
        // deciding whether to touch the two buttons below it: publishing an already frozen
        // version from a retired release is allowed, and freezing a new one is not.
        <p className="text-[11px] leading-snug text-warning">
          {retiredReleaseNotice(retiredRelease.displayName, retiredRelease.releaseNumber)}
        </p>
      ) : null}

      <ol className="space-y-3 text-sm">
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-0.5 text-muted-foreground">1</span>
          <span className="flex-1">
            <Button type="button" size="sm" variant="outline" className="rounded-lg h-11"
              onClick={onCreateVersion}
              disabled={busy || !languageChosen || serverBlocking || retiredRelease !== null}>
              Freeze this draft as a version
            </Button>
            {!languageChosen ? (
              <span className="block text-[11px] text-muted-foreground">
                Choose the invitation language on the planning page first — a version
                states the language its guests are reading in.
              </span>
            ) : serverBlocking ? (
              // Named in italics rather than in quotation marks, because this screen's contract
              // with the host is sentences the app wrote: a quote character here would read like
              // a machine's field name. The heading it names is `AuthoritativeIssues`' own.
              <span className="block text-[11px] text-muted-foreground">
                Waiting on the checks under{' '}
                <em>What the server says stands between this and a version</em>. Fixing one is
                enough to re-run them; the freeze call makes the same checks again whichever way
                this button is showing.
              </span>
            ) : retiredRelease !== null ? (
              <span className="block text-[11px] text-muted-foreground">
                Not while your invitation stands on that older release — choose another pack, or
                write it yourself, and this button is offered again. The freeze call refuses it on
                the server whichever way this button is showing.
              </span>
            ) : null}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-0.5 text-muted-foreground">2</span>
          <span className="flex-1">
            {versions.length > 0 ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium">Version to publish</span>
                <select
                  value={selected ?? ''}
                  onChange={e => setVersionId(e.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>
                      {`Version ${v.versionNumber}${formatDate(v.createdAt) ? ` · ${formatDate(v.createdAt)}` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Nothing to publish yet — freeze a version in step 1.
              </p>
            )}
            <Button type="button" size="sm" className="mt-2 rounded-lg h-11"
              onClick={() => { if (selected !== null) onPublish(selected); }}
              disabled={busy || selected === null}>
              Publish
            </Button>
            {state?.linkActive && latest !== null ? (
              <span className="block text-[11px] text-muted-foreground">
                Republishing points your existing address at the version you pick. It does
                not create a second link.
              </span>
            ) : null}
          </span>
        </li>
      </ol>

      {shareUrl !== null ? (
        <div className="space-y-2 rounded-lg border border-gold/50 bg-paper p-3">
          <p className="text-xs font-medium">This is the address. It is shown once.</p>
          <p className="break-all font-mono text-xs">{shareUrl}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="rounded-lg h-11"
              onClick={() => { void copy(); }}>
              Copy
            </Button>
            {typeof navigator.share === 'function' ? (
              <Button type="button" size="sm" variant="outline" className="rounded-lg h-11"
                onClick={() => { void share(); }}>
                Share
              </Button>
            ) : null}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open in WhatsApp
            </a>
          </div>
          <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
            {copied ? 'Copied to the clipboard.' : 'Nothing has been sent. Copy it, or hand the link to a chat app yourself.'}
          </p>
        </div>
      ) : state?.linkActive ? (
        <p className="text-[11px] text-muted-foreground">
          A live address cannot be shown again — only the call that created it ever
          carried it. Copy it from where you shared it, or make a new link below.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" className="rounded-lg h-11"
          onClick={onRotate} disabled={busy || !state?.linkActive}>
          New link, same version
        </Button>
        <Button type="button" size="sm" variant="outline" className="rounded-lg h-11 text-destructive"
          onClick={onRevoke} disabled={busy || !state?.linkActive}>
          Take the link down
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        A new link retires the old one; guests holding it will be told the invitation is
        not available. A link taken down cannot be reactivated.
      </p>

      {message !== null ? (
        <p role="status" aria-live="polite" className="text-sm text-foreground">{message}</p>
      ) : null}

      {notice !== null ? (
        <p role="status" aria-live="polite" className="text-sm text-destructive">{notice}</p>
      ) : null}
    </section>
  );
};

export default PublicationPanel;
