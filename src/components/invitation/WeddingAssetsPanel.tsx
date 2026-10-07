// The files a host keeps with this wedding — uploaded, listed, previewed, replaced and removed
// from the editor, and shown to nobody else.
//
// Three rules decided the shape of this panel.
//
//   * It talks to Storage only through `weddingAssets.ts`. There is no `object_key` field, no file
//     name that becomes a path and no bucket name here, because the database mints the key in a
//     BEFORE trigger and answers a presented one with a refusal — the adapter reads the key back
//     from the row it inserted and this file only ever passes that value straight through to a
//     preview. A host cannot name where their bytes land, and neither can this panel.
//   * A signed URL is rendered as media and never as text. `previewAsset` answers with a link that
//     expires in about a minute; putting it in a field, a `href` or a toast would turn a preview
//     into something copyable, which is the failure the short TTL exists to make uninteresting.
//   * It claims no guest. §7 of `docs/audits/stage-6-storage-assets.md` rules guest-facing asset
//     delivery out of this stage, and the published snapshot is asserted (B28) to carry no
//     `object_key`. So the panel says plainly that guests do not see these files rather than
//     implying an invitation that this build does not draw.
//
// The kind choices below are a presentation list, not a validation list: `asset_kind` is enforced
// by the table's CHECK, the accepted types and the size ceiling by the bucket, and both answer
// through the adapter's own sentence, which is printed verbatim below. `generated_output` is
// deliberately absent — it names a derivative the platform would produce, not a file a host uploads.
//
// NOT YET QUALIFIED. No browser journey has driven this panel and no HTTP battery has run against
// the adapter it calls, because the local Docker engine stopped answering during this stage (see
// audit §18). What follows is written for review; nothing here may be reported as verified until
// the Stage 6 browser tier has run at the SHA that carries it.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listAssets,
  previewAsset,
  removeAsset,
  replaceAsset,
  uploadAsset,
  type AssetDraft,
  type AssetEntry,
} from '@/integrations/supabase/weddingAssets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const KIND_CHOICES = [
  { value: 'photo', label: 'A photograph' },
  { value: 'monogram', label: 'A monogram or emblem' },
  { value: 'decorative', label: 'A decorative image' },
  { value: 'audio', label: 'A music clip' },
];

const kindLabel = (value: string): string =>
  KIND_CHOICES.find((choice) => choice.value === value)?.label ?? value;

/** What a row's `upload_status` means in the words a host can act on. `staged` and `tombstoned` are
 *  shown rather than filtered out: the audit §5.2 names both orphan classes as facts the host is
 *  entitled to see, and hiding a half-finished upload would leave "the file isn't there" with no
 *  explanation and no route out. */
const statusSentence = (asset: AssetEntry): string => {
  if (asset.uploadStatus === 'ready') return 'Stored.';
  if (asset.uploadStatus === 'tombstoned') return 'Being removed.';
  return 'Not finished — this record exists but its file does not. Removing it clears the record.';
};

const sizeSentence = (bytes: number | null): string => {
  if (bytes === null) return 'size not recorded';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const inlineMedia = (mimeType: string | null): 'image' | 'audio' | null => {
  if (mimeType === null) return null;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'audio/mpeg') return 'audio';
  return null;
};

type Busy = null | 'upload' | 'replace' | 'remove' | 'preview';

export interface WeddingAssetsPanelProps {
  weddingId: string;
}

const WeddingAssetsPanel = ({ weddingId }: WeddingAssetsPanelProps) => {
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState(KIND_CHOICES[0].value);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which row's preview is on screen, and with what URL. Held here rather than in a row component
   *  because only one preview can be meaningful at a time: each link expires on its own, and two
   *  open previews would leave the host unable to tell which one is about to stop working. */
  const [preview, setPreview] = useState<{ assetId: string; url: string } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  /** The same ticket discipline the tradition panel uses: the mount load, the retry and the
   *  re-read after every write answer into these states, and a late answer to an older question
   *  must not put a list back to what it was before the host's click. */
  const readTicket = useRef(0);

  const load = useCallback(async () => {
    readTicket.current += 1;
    const ticket = readTicket.current;
    const result = await listAssets(weddingId);
    if (ticket !== readTicket.current) return;
    if (result.error !== null) {
      setLoadError(result.error);
      return;
    }
    setAssets(result.data ?? []);
    setLoaded(true);
  }, [weddingId]);

  useEffect(() => {
    setLoaded(false);
    setLoadError(null);
    void load();
  }, [load]);

  const clearFile = () => {
    setFile(null);
    if (fileInput.current !== null) fileInput.current.value = '';
  };

  const draft = (): AssetDraft | null => {
    if (file === null) return null;
    return { assetKind: kind, label: name, mimeType: file.type, sizeBytes: file.size };
  };

  /** After any write, drop the preview and the chosen file and re-read. The file goes because the
   *  row that now holds its bytes has a minted key the panel never saw; keeping the picker showing
   *  its name would suggest the next upload replaces it again. */
  const afterWrite = async (phrase: string) => {
    clearFile();
    setPreview(null);
    setMessage(phrase);
    await load();
  };

  const add = async () => {
    const next = draft();
    if (next === null || file === null) {
      setError('choose a file first');
      return;
    }
    setBusy('upload');
    setError(null);
    setMessage(null);
    const result = await uploadAsset(weddingId, next, file);
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    await afterWrite('Your file is uploaded.');
  };

  const swap = async () => {
    const previous = assets.find((asset) => asset.id === targetId);
    const next = draft();
    if (previous === undefined || next === null || file === null) {
      setError(previous === undefined ? 'choose which stored file to replace' : 'choose a file first');
      return;
    }
    setBusy('replace');
    setError(null);
    setMessage(null);
    const result = await replaceAsset(weddingId, previous, next, file);
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      // The adapter's own words say what happened: a failed *replacement* upload leaves the old
      // file exactly where it was, and a replacement that uploaded but could not retire the old
      // row leaves both. Either way the re-read below is what tells the host which they have.
      await load();
      return;
    }
    await afterWrite('The file was replaced. The one it was standing in for has been removed.');
  };

  const discard = async (asset: AssetEntry) => {
    setBusy('remove');
    setError(null);
    setMessage(null);
    const result = await removeAsset(asset);
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      await load();
      return;
    }
    if (preview?.assetId === asset.id) setPreview(null);
    setMessage('That file is removed.');
    await load();
  };

  const show = async (asset: AssetEntry) => {
    setBusy('preview');
    setError(null);
    const result = await previewAsset(asset.objectKey);
    setBusy(null);
    if (result.error !== null || result.data === null) {
      setError(result.error ?? 'this upload could not be previewed');
      return;
    }
    setPreview({ assetId: asset.id, url: result.data });
  };

  const target = assets.find((asset) => asset.id === targetId);

  const row = (asset: AssetEntry) => (
    <li key={asset.id} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-xs font-medium">{kindLabel(asset.assetKind)}</span>
          <span className="block text-[11px] leading-snug text-muted-foreground">
            {asset.label === null ? 'No name given' : asset.label} · {sizeSentence(asset.sizeBytes)}
            {asset.mimeType === null ? '' : ` · ${asset.mimeType}`}
          </span>
          <span className="block text-[11px] leading-snug text-muted-foreground">
            {statusSentence(asset)}
          </span>
        </span>
        {/* A radio rather than a button: "which stored file does this new one stand in for" is a
            choose-one question among rows, and a button made it look like a second action.
            The wrapper is not decoration. A radio is 16 CSS px at `h-4 w-4` under this project's
            `html { font-size: 1rem }`, and the accessibility instrument sizes a press area from the
            control's own `<label>` — unwrapped, that is a 16x16 target against the 24px floor and the
            44px host-workbench figure in `docs/product/design-principles.md`. `p-3.5` makes the label
            44x44; the matching negative margin keeps the row's geometry as drawn. */}
        <label className="-m-3.5 shrink-0 cursor-pointer p-3.5">
          <input
            type="radio"
            name="asset-replace-target"
            checked={asset.id === targetId}
            onChange={() => { setTargetId(asset.id); }}
            disabled={busy !== null || asset.uploadStatus !== 'ready'}
            aria-label={`Replace this file: ${kindLabel(asset.assetKind)}`}
            className="mt-0.5 block h-4 w-4 accent-primary"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {inlineMedia(asset.mimeType) !== null && asset.uploadStatus === 'ready' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 rounded-lg text-xs"
            onClick={() => { void show(asset); }}
            disabled={busy !== null}
          >
            Preview
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 rounded-lg text-xs text-muted-foreground"
          onClick={() => { void discard(asset); }}
          disabled={busy !== null}
        >
          Remove
        </Button>
      </div>

      {preview?.assetId === asset.id ? (
        <div className="space-y-1.5">
          {inlineMedia(asset.mimeType) === 'image' ? (
            <img
              src={preview.url}
              alt={`${kindLabel(asset.assetKind)}${asset.label === null ? '' : `: ${asset.label}`}`}
              className="max-h-48 w-full rounded-lg border border-border object-contain"
            />
          ) : (
            <audio src={preview.url} controls className="w-full" />
          )}
          <p className="text-[11px] leading-snug text-muted-foreground">
            A short-lived link, for you alone. It is not stored, and it stops working within a
            minute.
          </p>
        </div>
      ) : null}
    </li>
  );

  return (
    <section className="space-y-3" aria-labelledby="assets-heading">
      <h2 id="assets-heading" className="font-display font-semibold text-sm">
        Your files
      </h2>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Files you keep with this invitation, for yourself. Your guests do not see them in this
        build: the page they open is drawn from your words and rows, not from uploaded files.
      </p>

      {!loaded && loadError === null ? (
        <p className="animate-pulse text-xs text-muted-foreground">Loading your files…</p>
      ) : null}

      {loadError !== null ? (
        <>
          <p role="alert" className="text-xs text-destructive">{loadError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 rounded-lg text-xs"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            Try again
          </Button>
        </>
      ) : null}

      {loaded ? (
        <>
          {assets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              You have not uploaded a file to this invitation yet.
            </p>
          ) : (
            <ul className="space-y-2">{assets.map(row)}</ul>
          )}

          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="space-y-1">
              <Label htmlFor="asset-kind" className="text-[11px] font-medium">
                What is this file for?
              </Label>
              <select
                id="asset-kind"
                value={kind}
                onChange={(event) => { setKind(event.target.value); }}
                disabled={busy !== null}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                {KIND_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="asset-name" className="text-[11px] font-medium">
                Name this file
              </Label>
              <Input
                id="asset-name"
                value={name}
                onChange={(event) => { setName(event.target.value); }}
                disabled={busy !== null}
                className="h-11 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="asset-file" className="text-[11px] font-medium">
                Choose a file
              </Label>
              <Input
                id="asset-file"
                type="file"
                ref={fileInput}
                onChange={(event) => { setFile(event.target.files?.[0] ?? null); }}
                disabled={busy !== null}
                className="h-11 text-xs"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                The types and size this invitation accepts are checked when you upload, and a file
                it refuses is described in the message below.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg h-11 text-xs"
                onClick={() => { void add(); }}
                disabled={busy !== null || file === null}
              >
                Upload file
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg h-11 text-xs"
                onClick={() => { void swap(); }}
                disabled={busy !== null || file === null || target === undefined}
              >
                Replace the chosen file
              </Button>
            </div>
            {target === undefined ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Replace needs a stored file to stand in for: choose one with the round button on its
                row above.
              </p>
            ) : (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {`Replacing ${kindLabel(target.assetKind)} — the new file is stored first, and the old one is only removed once it is.`}
              </p>
            )}
          </div>
        </>
      ) : null}

      {busy !== null ? (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {busy === 'upload'
            ? 'Uploading your file…'
            : busy === 'replace'
              ? 'Uploading the replacement…'
              : busy === 'remove'
                ? 'Removing that file…'
                : 'Opening the preview…'}
        </p>
      ) : null}

      {message !== null ? (
        <p role="status" aria-live="polite" className="text-xs text-success">
          {message}
        </p>
      ) : null}

      {error !== null ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
};

export default WeddingAssetsPanel;
