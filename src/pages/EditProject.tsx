// The host's workbench: their words, their styling, and the two steps that turn a saved
// draft into an address a guest can open.
//
// Three rules shaped this page:
//
//   * The canvas is the guest's renderer (§U), not a picture of one. `api.preview_invitation`
//     runs the same snapshot builder and the same projection a guest's resolve call runs, so
//     the host is looking at the document their guests would receive — and a preview that
//     flattered them would be a lie told right before they share a link.
//   * Typing is local until Save. The composed object below is the server's projection with
//     the editor's style and the four prose slots re-applied, which is exactly what
//     "unsaved changes shown" means; everything else (title, language, names, ceremonies)
//     is what is already in the rows. Freezing a version reads the rows, so unsaved typing
//     is not in it — the panel says so before the button is pressed rather than after.
//   * Nothing here decides who the caller is. The RPCs take a wedding id and nothing else;
//     the database derives the host from the JWT and refuses a wedding that is not theirs
//     with one generic phrase, so this page cannot ask about someone else's invitation.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  EMPTY_DRAFT_CONTENT,
  getDraftContent,
  getWeddingDesign,
  listInvitationVersions,
  updateDraftContent,
  updateStyleSettings,
  type InvitationDraftContent,
  type QueryResult,
  type StoredInvitationVersion,
  type WeddingDesign,
} from '@/integrations/supabase/weddings';
import {
  createInvitationVersion,
  getPublicationState,
  previewInvitation,
  publishInvitation,
  revokeInvitationPublication,
  rotateInvitationLink,
  type PublicationState,
} from '@/integrations/supabase/publication';
import type { PublicInvitation } from '@/lib/publicInvitation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Save } from 'lucide-react';
import { sanitizeSvg } from '@/lib/sanitizeSvg';
import InvitationRenderer from '@/components/invitation/InvitationRenderer';
import DraftTextEditor from '@/components/invitation/DraftTextEditor';
import PublicationPanel from '@/components/invitation/PublicationPanel';

interface EditorState {
  font: string;
  fontSize: string;
  color: string;
  alignment: 'left' | 'center' | 'right';
  foilEnabled: boolean;
}

const DEFAULT_EDITOR: EditorState = {
  font: 'Playfair Display',
  fontSize: '24',
  color: '#6b1e2a',
  alignment: 'center',
  foilEnabled: false,
};

const PRESET_COLORS = [
  { name: 'Gold', value: '#c9972f' },
  { name: 'Maroon', value: '#6b1e2a' },
  { name: 'Deep Green', value: '#1f6f52' },
  { name: 'Cream', value: '#fbf6f0' },
  { name: 'Off-white', value: '#fff8f3' },
  { name: 'Black', value: '#1a1a1a' },
];

const FONT_FAMILIES = [
  'Playfair Display',
  'DM Sans',
  'Noto Sans Tamil',
  'Noto Sans Telugu',
  'Noto Sans Kannada',
  'Noto Sans Malayalam',
];

const ALIGNMENTS = ['left', 'center', 'right'] as const;

const isAlignment = (value: unknown): value is EditorState['alignment'] =>
  value === 'left' || value === 'center' || value === 'right';

const oneOf = (value: unknown, choices: readonly string[], fallback: string) =>
  typeof value === 'string' && choices.includes(value) ? value : fallback;

const matching = (value: unknown, pattern: RegExp, fallback: string) =>
  typeof value === 'string' && pattern.test(value) ? value : fallback;

// `style_settings` is a jsonb column: the shape is ours by convention, not by constraint,
// and a migrated row can hold anything its old editor wrote. Each setting therefore falls
// back to the default the UI would have offered, rather than reaching the canvas
// unvalidated — an unusable saved value should degrade the preview, not break it.
const editorFrom = (settings: Record<string, unknown>): EditorState => ({
  font: oneOf(settings.font, FONT_FAMILIES, DEFAULT_EDITOR.font),
  fontSize: matching(settings.fontSize, /^\d{1,3}$/, DEFAULT_EDITOR.fontSize),
  color: matching(settings.color, /^#[0-9a-fA-F]{6}$/, DEFAULT_EDITOR.color),
  alignment: isAlignment(settings.alignment) ? settings.alignment : DEFAULT_EDITOR.alignment,
  foilEnabled: typeof settings.foilEnabled === 'boolean' ? settings.foilEnabled : false,
});

/** The five fields Save writes, as one string. Compared rather than flagged by handlers
 *  so a host who types and then undoes the typing is not nagged about unsaved changes. */
const editKey = (editor: EditorState, draft: InvitationDraftContent): string =>
  JSON.stringify([editor.font, editor.fontSize, editor.color, editor.alignment, draft]);

const EMPTY_BASE: PublicInvitation = {
  title: '',
  language: { primary: null, additional: [] },
  style: { font: null, fontSize: null, color: null, alignment: null },
  designTemplate: null,
  traditionPack: null,
  people: [],
  events: [],
  welcome: null,
  familyIntroduction: null,
  eventNotes: null,
  closing: null,
};

/**
 * What the canvas draws. The server's projection is the document; the only things replaced
 * with local values are the style and the four prose slots, because those are what this
 * page edits. If the preview call failed there is no projection to draw on, so a bare page
 * carries the host's words alone — a title and paragraphs they typed is still a readable
 * draft, and inventing an empty state that hid them would be the worse lie.
 */
const composedInvitation = (
  base: PublicInvitation | null,
  design: WeddingDesign,
  editor: EditorState,
  draft: InvitationDraftContent,
): PublicInvitation => {
  const source =
    base ??
    ({
      ...EMPTY_BASE,
      title: design.title,
      language: { primary: design.primaryLanguage, additional: [] },
    } satisfies PublicInvitation);
  return {
    ...source,
    style: { font: editor.font, fontSize: editor.fontSize, color: editor.color, alignment: editor.alignment },
    welcome: draft.welcome,
    familyIntroduction: draft.familyIntroduction,
    eventNotes: draft.eventNotes,
    closing: draft.closing,
  };
};

const FieldLabel = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <p id={id} className="text-xs font-medium text-foreground">
    {children}
  </p>
);

type SaveState = 'saved' | 'saving' | 'failed';

const SaveStatus = ({ state, dirty }: { state: SaveState; dirty: boolean }) => {
  if (state === 'saving') return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Saving…</p>;
  if (state === 'failed') {
    return <p role="status" aria-live="polite" className="text-xs text-destructive">Could not save. Your text is still here — try again.</p>;
  }
  if (dirty) return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Unsaved changes</p>;
  if (state === 'saved') return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Saved</p>;
  return null;
};

const EditProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [design, setDesign] = useState<WeddingDesign | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editor, setEditor] = useState<EditorState>(DEFAULT_EDITOR);
  const [draft, setDraft] = useState<InvitationDraftContent>(EMPTY_DRAFT_CONTENT);
  const [serverPreview, setServerPreview] = useState<PublicInvitation | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  /** `editKey` of the values the rows actually hold. Compared with the current key, so a
   *  host who types and then undoes it is not told they have unsaved changes. */
  const [baseline, setBaseline] = useState('');
  const [versions, setVersions] = useState<StoredInvitationVersion[]>([]);
  const [pubState, setPubState] = useState<PublicationState | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = design !== null && editKey(editor, draft) !== baseline;
  const absolutePath = (path: string) => `${window.location.origin}${path}`;

  useEffect(() => {
    if (!id || !user) return;
    let live = true;
    void Promise.all([
      getWeddingDesign(user.id, id),
      getDraftContent(id),
      listInvitationVersions(id),
      getPublicationState(id),
      previewInvitation(id),
    ]).then(([designResult, draftResult, versionResult, stateResult, previewResult]) => {
      if (!live) return;
      if (designResult.error || designResult.data === null) {
        setLoadFailed(true);
        return;
      }
      const loadedEditor = editorFrom(designResult.data.styleSettings);
      const loadedDraft = draftResult.data ?? EMPTY_DRAFT_CONTENT;
      setDesign(designResult.data);
      setEditor(loadedEditor);
      setDraft(loadedDraft);
      setBaseline(editKey(loadedEditor, loadedDraft));
      if (versionResult.data) setVersions(versionResult.data);
      if (stateResult.data) setPubState(stateResult.data);
      if (previewResult.data) setServerPreview(previewResult.data);
      setSaveState('saved');
    });
    return () => {
      live = false;
    };
  }, [id, user]);

  const handleSave = async () => {
    if (!id || !user) return;
    setSaveState('saving');
    const saved = editKey(editor, draft);
    const styleResult = await updateStyleSettings(user.id, id, { ...editor });
    const draftResult = await updateDraftContent(id, draft);
    if (styleResult.error || draftResult.error) {
      setSaveState('failed');
      return;
    }
    // The key the rows now answer to is the one this call sent, even if the host kept
    // typing while it was in flight — anything after it is unsaved again, correctly.
    setBaseline(saved);
    setSaveState('saved');
    // Re-read the projection so the canvas is the server's document rather than the local
    // overlay; a failed refresh leaves the overlay in place, which shows the same words.
    const refreshed = await previewInvitation(id);
    if (refreshed.data) setServerPreview(refreshed.data);
  };

  const runPublication = async <T,>(
    call: Promise<QueryResult<T>>,
    after: (data: T) => void,
  ): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setMessage(null);
    const result = await call;
    setBusy(false);
    if (result.error !== null) {
      setNotice(result.error);
      return;
    }
    after(result.data);
  };

  const refreshState = async () => {
    if (!id) return;
    const result = await getPublicationState(id);
    // A successful read of "nothing is published" is still a read. Skipping falsy answers
    // left the previous state on screen after a takedown, so the panel went on claiming a
    // live link to a host whose guests were already being refused.
    if (result.error === null) setPubState(result.data);
  };

  const refreshVersions = async () => {
    if (!id) return;
    const result = await listInvitationVersions(id);
    if (result.data) setVersions(result.data);
  };

  const handleCreateVersion = () => {
    if (!id) return;
    if (dirty) {
      setNotice('You have unsaved changes. Save them first — a version freezes what is saved, not what is on screen.');
      return;
    }
    void runPublication(createInvitationVersion(id), version => {
      void refreshVersions();
      setMessage(`Version ${version.versionNumber} is frozen. It cannot be edited.`);
    });
  };

  const handlePublish = (versionId: string) => {
    if (!id) return;
    void runPublication(publishInvitation(id, versionId), outcome => {
      if (outcome.path !== null) {
        // The raw credential exists in this response and nowhere else — the database keeps
        // only its digest — so this is the one moment the address can be shown.
        setShareUrl(absolutePath(outcome.path));
        setMessage('The link is live. Copy the address now — it is shown once.');
      } else {
        setShareUrl(null);
        setMessage(outcome.linkReused
          ? 'Your existing address now shows this version. Nothing new was created.'
          : 'This version is published.');
      }
      void refreshState();
    });
  };

  const handleRotate = () => {
    if (!id) return;
    void runPublication(rotateInvitationLink(id), rotated => {
      setShareUrl(absolutePath(rotated.path));
      setMessage('A new address was created and the old one was retired. Copy it now.');
      void refreshState();
    });
  };

  const handleRevoke = () => {
    if (!id) return;
    void runPublication(revokeInvitationPublication(id), outcome => {
      setShareUrl(null);
      setMessage(
        outcome.tokensRevoked > 0
          ? 'The link is taken down. Guests who try it are told the invitation is not available.'
          : 'There was no live link to take down.',
      );
      void refreshState();
    });
  };

  if (loadFailed) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container py-16 text-center">
          <h1 className="font-display text-xl font-semibold mb-2">This invitation draft could not be opened</h1>
          <p className="text-muted-foreground">It may have been deleted, or the connection dropped.</p>
          <Button asChild variant="outline" className="mt-4 rounded-xl">
            <Link to="/dashboard">Back to My Invitations</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (!design) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container py-16 text-center" role="status">
          <p className="animate-pulse text-muted-foreground">Loading your invitation draft…</p>
        </main>
      </div>
    );
  }

  const invitation = composedInvitation(serverPreview, design, editor, draft);
  const artwork = design.previewSvg === null ? null : sanitizeSvg(design.previewSvg);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <h1 className="sr-only">Invitation draft: {design.title}</h1>

      <div className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild aria-label="Back to invitation draft">
            <Link to={`/project/${id}/configure`}><ArrowLeft className="w-4 h-4" aria-hidden="true" /></Link>
          </Button>
          <span className="font-display font-semibold text-sm truncate">{design.title}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <SaveStatus state={saveState} dirty={dirty} />
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => { void handleSave(); }}
            disabled={busy || saveState === 'saving'}
          >
            <Save className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {saveState === 'saving' ? 'Saving…' : 'Save Draft'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row">
        <section
          className="flex-1 p-4 md:p-8 bg-muted/30"
          aria-labelledby="preview-heading"
        >
          <h2 id="preview-heading" className="sr-only">Preview</h2>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-card px-3 py-1 text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
              Draft preview{dirty ? ' — unsaved changes shown' : ''}
            </p>
            <InvitationRenderer invitation={invitation} />
            <p className="text-xs leading-snug text-muted-foreground">
              This is the layout your guests get, drawn by the same code that renders their
              page. Your words and styling change as you type; the names, ceremonies and
              venues shown here are what is already saved, and this build has no editor for
              them yet.
            </p>
          </div>
        </section>

        <aside className="lg:w-96 bg-card border-l border-border p-4 space-y-6 overflow-y-auto lg:max-h-[calc(100vh-3.5rem)]">
          <section className="space-y-3" aria-labelledby="words-heading">
            <h2 id="words-heading" className="font-display font-semibold text-sm">
              Your words
            </h2>
            <DraftTextEditor value={draft} onChange={setDraft} disabled={saveState === 'saving'} />
          </section>

          <Separator />

          <section className="space-y-5" aria-labelledby="styling-heading">
            <h2 id="styling-heading" className="font-display font-semibold text-sm">
              Invitation styling
            </h2>

            <div className="space-y-1.5">
              <FieldLabel id="font-label">Font</FieldLabel>
              <Select value={editor.font} onValueChange={v => setEditor(e => ({ ...e, font: v }))}>
                <SelectTrigger className="h-9 text-xs" aria-labelledby="font-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_FAMILIES.map(f => (
                    <SelectItem key={f} value={f} className="text-xs">
                      <span style={{ fontFamily: f }}>{f}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="font-size">Font size (px)</Label>
              <Input
                id="font-size"
                type="number"
                min={8}
                max={120}
                value={editor.fontSize}
                onChange={e => setEditor(p => ({ ...p, fontSize: e.target.value }))}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <FieldLabel id="colour-label">Colour</FieldLabel>
              <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="colour-label">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setEditor(p => ({ ...p, color: c.value }))}
                    aria-label={`Use ${c.name}`}
                    aria-pressed={editor.color === c.value}
                    className={`h-9 w-9 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      editor.color === c.value ? 'border-primary scale-110' : 'border-border'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
              <Input
                type="color"
                value={editor.color}
                onChange={e => setEditor(p => ({ ...p, color: e.target.value }))}
                aria-label="Custom colour"
                className="h-9 w-full cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <FieldLabel id="alignment-label">Alignment</FieldLabel>
              <div className="flex gap-1" role="group" aria-labelledby="alignment-label">
                {ALIGNMENTS.map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setEditor(p => ({ ...p, alignment: a }))}
                    aria-label={`Align text ${a}`}
                    aria-pressed={editor.alignment === a}
                    className={`flex-1 py-2 text-xs border rounded capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                      editor.alignment === a ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={editor.foilEnabled}
                  onChange={e => setEditor(p => ({ ...p, foilEnabled: e.target.checked }))}
                />
                <span>
                  <span className="text-xs font-medium">Foil effect (simulated)</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    A screen-only sheen over the catalogue artwork below. It changes nothing
                    a guest sees — it is not in their document — and nothing prints from this
                    preview.
                  </span>
                </span>
              </label>
            </div>

            {artwork !== null ? (
              <figure className="space-y-1.5">
                <figcaption className="text-[11px] leading-snug text-muted-foreground">
                  Catalogue artwork — guests do not see this. Your invitation is the page on
                  the left.
                </figcaption>
                <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg border border-border bg-card">
                  <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: artwork }} />
                  {editor.foilEnabled ? (
                    <div
                      className="pointer-events-none absolute inset-0 bg-gradient-to-br from-secondary/20 via-transparent to-secondary/30"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              </figure>
            ) : null}
          </section>

          <Separator />

          <PublicationPanel
            shareUrl={shareUrl}
            state={pubState}
            versions={versions}
            message={message}
            notice={notice}
            languageChosen={design.primaryLanguage !== null}
            busy={busy}
            onCreateVersion={handleCreateVersion}
            onPublish={handlePublish}
            onRotate={handleRotate}
            onRevoke={handleRevoke}
          />
        </aside>
      </div>
    </div>
  );
};

export default EditProject;
