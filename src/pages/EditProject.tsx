// The host's workbench: their words, their styling, and the two steps that turn a saved
// draft into an address a guest can open.
//
// Four rules shaped this page:
//
//   * One server read is authoritative for three things. `api.preview_invitation_document`
//     answers the guest's document, the release's section-by-section authoring declaration, and
//     the server's own findings about whether a version could be frozen — all from the same
//     snapshot and the same definition read that `api.create_invitation_version` runs again. So
//     the canvas is the document a guest would receive, the outline below is laid out in the
//     order the chosen release put it in, and the blocking list is the server's verdict rather
//     than this file's guess about it. A preview that flattered the host would be a lie told
//     right before they share a link.
//   * Typing is local until Save. The composed object below is the server's projection with
//     the editor's style and the host's prose slots re-applied, which is exactly what
//     "unsaved changes shown" means; everything else (title, language, names, ceremonies)
//     is what is already in the rows. Freezing a version reads the rows, so unsaved typing
//     is not in it — the panel says so before the button is pressed rather than after. A
//     section the release will not take a replacement for is left exactly as the projection
//     answered it, because drawing the host's unused line on the canvas would credit the
//     preview with words the document does not carry.
//   * The list under the canvas is not the freeze check. `normalizeInvitationSections` runs the
//     guest renderer's own placement rules over the composed document to say what this build
//     could not draw; it is a note about this browser's limits, and it is labelled as one. The
//     findings that hold a freeze back are the server's, printed once, in their own panel.
//   * Nothing here decides who the caller is. The RPCs take a wedding id and nothing else;
//     the database derives the host from the JWT and refuses a wedding that is not theirs
//     with one generic phrase, so this page cannot ask about someone else's invitation.

import { useCallback, useEffect, useRef, useState } from 'react';
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
  previewInvitationDocument,
  publishInvitation,
  revokeInvitationPublication,
  rotateInvitationLink,
  type AuthoringSection,
  type InvitationIssue,
  type PublicationState,
  type SelectedReleaseSummary,
} from '@/integrations/supabase/publication';
import type { PublicInvitation } from '@/lib/publicInvitation';
import type { PackHostField } from '@/lib/traditionPackContract';
import { PACK_HOST_FIELDS } from '@/lib/traditionPackContract';
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
import { normalizeInvitationSections } from '@/lib/invitationSections';
import { DRAFT_SLOT_LABELS, HOST_FIELD_OF_SLOT } from '@/lib/invitationDraftSlots';
import {
  BUILT_IN_AUTHORING,
  hasBlockingIssue,
  isHostEditable,
  usesRetiredRelease,
} from '@/lib/invitationAuthoring';
import InvitationRenderer from '@/components/invitation/InvitationRenderer';
import AuthoringOutline from '@/components/invitation/AuthoringOutline';
import AuthoritativeIssues from '@/components/invitation/AuthoritativeIssues';
import { ContentNotice, useWeddingContentRows } from '@/components/invitation/ContentEditor';
import TraditionPackPanel from '@/components/invitation/TraditionPackPanel';
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
  sections: null,
  people: [],
  events: [],
  welcome: null,
  familyIntroduction: null,
  eventNotes: null,
  closing: null,
};

/**
 * Put the host's unsaved words where the canvas will draw them.
 *
 * The server's projection resolves sections from the *saved* draft row, so a section whose body
 * is the host's carries the text as it was last saved. The canvas shows what is on the screen
 * instead, and §13 moved the prose into the section list: a section that reads one of the host
 * fields is rewritten here, in the one place that knows what the host has typed and not yet
 * saved.
 *
 * The rewrite mirrors `private.resolve_invitation_sections`
 * (`supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql:913-933`) rather
 * than inventing a rule of its own, because a preview that disagreed with the next save would
 * be a lie told right before the host shares a link:
 *
 *   * Typed text wins — but only where the release's own `override_rule` allows a replacement.
 *     A `pack_only` section is left exactly as the projection answered it, because the server
 *     has already said it is not reading that draft slot; drawing the host's unused line over
 *     the reviewed one would put words on the canvas that no guest document would carry.
 *     `AuthoringOutline` shows the stored line beside the field instead, with the notice that
 *     says it is stored and not used.
 *   * Winning over wording the release supplied is exactly what `overrode_pack_text` records. A
 *     section the projection returned as `reviewed_pack` therefore becomes `host` the moment the
 *     host types over it — never "reviewed_pack, but the host edited it", which §12 refuses
 *     because it would credit a review with words no reviewer saw. A body the projection left
 *     empty is written one, which is what saving typed text does: with the words invisible until
 *     Save, a host who chose "no tradition pack" would watch this canvas refuse to show anything
 *     they typed into a blank field.
 *   * `language` and `fallback_used` go null on a host body, as the projection nulls them: the
 *     platform does not know what language a person typed in.
 *   * Cleared text drops the body. The release's line would resolve again server-side, and a
 *     host body never carried that wording across the wire, so the honest answer on screen is
 *     "nothing here yet" — and the panel beside the field says what Save brings back.
 */
const withLocalProse = (
  invitation: PublicInvitation,
  draft: InvitationDraftContent,
  fixedFields: Set<PackHostField>,
): PublicInvitation => {
  const flat = {
    welcome: draft.welcome,
    familyIntroduction: draft.familyIntroduction,
    eventNotes: draft.eventNotes,
    closing: draft.closing,
  };
  if (invitation.sections === null) return { ...invitation, ...flat };

  const items = invitation.sections.items.map((item) => {
    const field = item.hostField;
    // A field name this build has no editor for is left exactly as the projection wrote it:
    // inventing a mapping would draw the wrong paragraph under someone's heading.
    if (field === null || !PACK_HOST_FIELDS.includes(field as PackHostField)) return item;
    if (fixedFields.has(field as PackHostField)) return item;
    const value = draft[HOST_FIELD_OF_SLOT[field as PackHostField]];
    const typed = value !== null && value.trim() !== '' ? value : null;
    if (typed === null) {
      // Only a body that *was* the host's has anything to remove; wording the host never
      // overwrote stays exactly as the release supplied it.
      if (item.body === null || item.body.source !== 'host') return item;
      return { ...item, body: null };
    }
    const overrodePackText =
      item.body === null ? false
        : item.body.source === 'reviewed_pack' ? true
          : item.body.overrodePackText === true;
    return {
      ...item,
      body: { source: 'host', text: typed, language: null, fallbackUsed: null, overrodePackText },
    };
  });

  return { ...invitation, ...flat, sections: { ...invitation.sections, items } };
};

/** The host fields the chosen release will not take a replacement for, read off the server's
 *  declaration rather than from the wording on screen: a section can be `pack_only` and still
 *  carry an empty body today, and the rule is what decides whether typing over it is allowed. */
const notOverridableFields = (authoring: AuthoringSection[]): Set<PackHostField> => {
  const fields = new Set<PackHostField>();
  for (const section of authoring) {
    if (section.hostField === null || isHostEditable(section)) continue;
    fields.add(section.hostField);
  }
  return fields;
};

/** The lines the chosen release is currently supplying wording for, named in the host's own
 *  field labels. Read off the server's projection rather than re-resolved from the pinned
 *  definition here, so the panel can only name wording the document actually carries — and
 *  once the host has replaced a line with their own, that line leaves the list.
 *
 *  A section whose rule refuses a replacement is left out even when it does carry pack wording:
 *  the sentence this list feeds tells the host to type over these fields, and offering that on a
 *  field this release will not read would be an instruction the server contradicts. Those lines
 *  are named where the host can see them, beside the field that holds their own stored wording. */
const suppliedSlotLabels = (projection: PublicInvitation | null, fixedFields: Set<PackHostField>): string[] => {
  const items = projection?.sections?.items;
  if (items === undefined) return [];
  const labels: string[] = [];
  for (const item of items) {
    const field = item.hostField;
    if (item.body === null || item.body.source !== 'reviewed_pack' || field === null) continue;
    if (!PACK_HOST_FIELDS.includes(field as PackHostField)) continue;
    if (fixedFields.has(field as PackHostField)) continue;
    labels.push(DRAFT_SLOT_LABELS[HOST_FIELD_OF_SLOT[field as PackHostField]]);
  }
  return labels;
};

/**
 * What the canvas draws. The server's projection is the document; the only things replaced
 * with local values are the style and the prose slots this page edits, and only where the
 * release accepts a replacement. If the document read failed there is no projection to draw
 * on, so a bare page carries the host's words alone — a title and paragraphs they typed is
 * still a readable draft, and inventing an empty state that hid them would be the worse lie.
 */
const composedInvitation = (
  base: PublicInvitation | null,
  design: WeddingDesign,
  editor: EditorState,
  draft: InvitationDraftContent,
  fixedFields: Set<PackHostField>,
): PublicInvitation => {
  const source =
    base ??
    ({
      ...EMPTY_BASE,
      title: design.title,
      language: { primary: design.primaryLanguage, additional: [] },
    } satisfies PublicInvitation);
  return withLocalProse(
    {
      ...source,
      style: { font: editor.font, fontSize: editor.fontSize, color: editor.color, alignment: editor.alignment },
    },
    draft,
    fixedFields,
  );
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

/**
 * What one call to `api.preview_invitation_document` answers, kept as one value.
 *
 * The document, its findings, the section declaration and the release it stands on arrive from
 * the same resolution, so they are stored together: four separate states would let the outline
 * build controls from one read while the finding list below it still answered another, which is
 * the exact disagreement this endpoint exists to make impossible.
 */
type PreviewDocument = {
  invitation: PublicInvitation;
  issues: InvitationIssue[];
  authoring: AuthoringSection[];
  selectedRelease: SelectedReleaseSummary | null;
};

interface AuthoringRegionProps {
  weddingId: string;
  authoring: AuthoringSection[];
  invitation: PublicInvitation;
  draft: InvitationDraftContent;
  onDraftChange: (value: InvitationDraftContent) => void;
  onContentChanged: () => void;
  disabled: boolean;
}

/**
 * The prose and the rows, in the order the release declares, over one copy of the row state.
 *
 * This exists as its own component because the row lists are mounted wherever the declaration
 * puts a list section (§19), and the hook that owns their state has to be called once, above
 * that outline — not inside it, where each section would get its own copy of the same three
 * lists. The page cannot call it itself and stay a page that renders a loading state before
 * the wedding id is known, so the hook lives one level down, in the component that only ever
 * mounts with an id in hand.
 */
const AuthoringRegion = ({
  weddingId,
  authoring,
  invitation,
  draft,
  onDraftChange,
  onContentChanged,
  disabled,
}: AuthoringRegionProps) => {
  const rows = useWeddingContentRows({ weddingId, onContentChanged });
  return (
    <section className="space-y-3" aria-labelledby="authoring-heading">
      <h2 id="authoring-heading" className="font-display font-semibold text-sm">
        Your invitation, section by section
      </h2>
      <p className="text-[11px] leading-snug text-muted-foreground">
        These are the parts your invitation is built from, in the order it uses them. The page
        on the left is what your guests would read.
      </p>
      <ContentNotice notice={rows.notice} />
      <AuthoringOutline
        authoring={authoring}
        invitation={invitation}
        draft={draft}
        onDraftChange={onDraftChange}
        rows={rows}
        disabled={disabled}
      />
    </section>
  );
};

const EditProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [design, setDesign] = useState<WeddingDesign | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editor, setEditor] = useState<EditorState>(DEFAULT_EDITOR);
  const [draft, setDraft] = useState<InvitationDraftContent>(EMPTY_DRAFT_CONTENT);
  const [doc, setDoc] = useState<PreviewDocument | null>(null);
  /** True when the last document read did not answer. Its own state rather than `doc === null`,
   *  because a failed refresh must not clear the document on screen — and a note that says the
   *  checks are unavailable must not appear while the first read is still in flight. */
  const [checksUnavailable, setChecksUnavailable] = useState(false);
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

  /** Which document read is still the current question. A save, a row write and a pack choice
   *  each ask for a fresh read, the responses arrive in an order this page does not control,
   *  and a late answer to an earlier question would otherwise overwrite a newer document with a
   *  stale one — including its issues, which is the list a host decides a freeze from. */
  const previewTicket = useRef(0);

  const applyPreview = useCallback(
    (ticket: number, result: QueryResult<PreviewDocument>) => {
      if (ticket !== previewTicket.current) return;
      if (result.error !== null || result.data === null) {
        // The last good document stays on screen: a refresh that failed says something about
        // the refresh, not that the host's invitation disappeared.
        setChecksUnavailable(true);
        return;
      }
      setDoc(result.data);
      setChecksUnavailable(false);
    },
    [],
  );

  useEffect(() => {
    if (!id || !user) return;
    let live = true;
    previewTicket.current += 1;
    const ticket = previewTicket.current;
    void Promise.all([
      getWeddingDesign(user.id, id),
      getDraftContent(id),
      listInvitationVersions(id),
      getPublicationState(id),
      previewInvitationDocument(id),
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
      applyPreview(ticket, previewResult);
      setSaveState('saved');
    });
    return () => {
      live = false;
    };
  }, [id, user, applyPreview]);

  /** Re-read the document, its findings and its declaration as the one resolution they came
   *  from, so the canvas, the outline and the blocking list always answer for the same read. */
  const refreshPreview = useCallback(
    async (weddingId: string) => {
      previewTicket.current += 1;
      const ticket = previewTicket.current;
      applyPreview(ticket, await previewInvitationDocument(weddingId));
    },
    [applyPreview],
  );

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
    await refreshPreview(id);
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

  if (!design || !id) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container py-16 text-center" role="status">
          <p className="animate-pulse text-muted-foreground">Loading your invitation draft…</p>
        </main>
      </div>
    );
  }

  // The declaration is the server's whenever it has answered. `BUILT_IN_AUTHORING` is used only
  // while no document has ever been read, which is the shape the manual editor has always had —
  // not a guess about a pack, and it disappears as soon as a read succeeds.
  const authoring = doc?.authoring ?? BUILT_IN_AUTHORING;
  const issues = doc?.issues ?? [];
  const fixedFields = notOverridableFields(authoring);
  const invitation = composedInvitation(doc?.invitation ?? null, design, editor, draft, fixedFields);
  const artwork = design.previewSvg === null ? null : sanitizeSvg(design.previewSvg);
  // The same normalizer the guest's renderer runs, on the same composed document, so what is
  // listed below the canvas is exactly what the canvas could not place — not a second opinion
  // computed from a different reading of the page. It is a note about *this build*, and it is
  // labelled as one: the findings that hold a freeze back are the server's, listed on their own.
  const previewIssues = normalizeInvitationSections(invitation).issues;
  const suppliedLabels = suppliedSlotLabels(doc?.invitation ?? null, fixedFields);
  const serverBlocking = hasBlockingIssue(issues);
  /** The retired release this wedding stands on, when there is one. From the same document read
   *  as the findings, so the freeze button's two reasons — the server's list and the release's
   *  lifecycle — are answers about one snapshot rather than two guesses about the page. */
  const selectedRelease = doc?.selectedRelease ?? null;
  const retiredRelease = usesRetiredRelease(selectedRelease) ? selectedRelease : null;
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <h1 className="sr-only">Invitation draft: {design.title}</h1>

      <div className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild className="h-11 w-11 shrink-0" aria-label="Back to invitation draft">
            <Link to={`/project/${id}/configure`}><ArrowLeft className="w-4 h-4" aria-hidden="true" /></Link>
          </Button>
          <span className="font-display font-semibold text-sm truncate">{design.title}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <SaveStatus state={saveState} dirty={dirty} />
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg h-11"
            onClick={() => { void handleSave(); }}
            disabled={busy || saveState === 'saving'}
          >
            <Save className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {saveState === 'saving' ? 'Saving…' : 'Save Draft'}
          </Button>
        </div>
      </div>

      {/* The page a host works on. The error and loading branches above already name their region
          as `main`; this one has to, or the screen a keyboard user spends their time on has no
          landmark to jump to. */}
      <main className="flex-1 flex flex-col lg:flex-row">
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
            {previewIssues.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-warning/60 bg-card p-3">
                <h3 id="preview-issues-heading" className="text-xs font-semibold">
                  What this preview could not draw
                </h3>
                <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-muted-foreground">
                  {previewIssues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.path}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  A note for you, the host, about what this build can draw. Your guests see none
                  of this list — the sections it names are simply absent from their page, which is
                  why they are named here rather than drawn as empty boxes. It is not the freeze
                  check: whether a version can be made is the server&apos;s answer, printed in the
                  panel headed{' '}
                  <em>What the server says stands between this and a version</em>.
                </p>
              </div>
            ) : null}
            <p className="text-xs leading-snug text-muted-foreground">
              This is the layout your guests get, drawn by the same code that renders their
              page. Your words and styling change as you type and reach the document when you
              press Save Draft; the people, venues and ceremonies below are saved row by row,
              because they are rows rather than draft text.
            </p>
          </div>
        </section>

        <aside className="lg:w-96 bg-card border-l border-border p-4 space-y-6 overflow-y-auto lg:max-h-[calc(100vh-3.5rem)]">
          {user !== null ? (
            <>
              <TraditionPackPanel
                userId={user.id}
                weddingId={id}
                suppliedSlotLabels={suppliedLabels}
                onSelectionChanged={() => { void refreshPreview(id); }}
              />

              <Separator />
            </>
          ) : null}

          {checksUnavailable ? (
            <p role="status" aria-live="polite" className="text-[11px] leading-snug text-muted-foreground">
              The server&apos;s checks could not be re-read just now. What this page shows is
              therefore from the last read that answered, or the plain manual layout if none has.
              Saving re-reads them, and freezing a version runs every check again on the server,
              so nothing can freeze on the strength of an old list.
            </p>
          ) : null}

          <AuthoritativeIssues
            issues={issues}
            authoring={authoring}
            invitation={invitation}
            weddingId={id}
          />

          <AuthoringRegion
            weddingId={id}
            authoring={authoring}
            invitation={invitation}
            draft={draft}
            onDraftChange={setDraft}
            onContentChanged={() => {
              void refreshPreview(id);
            }}
            disabled={saveState === 'saving'}
          />

          <Separator />

          <section className="space-y-5" aria-labelledby="styling-heading">
            <h2 id="styling-heading" className="font-display font-semibold text-sm">
              Invitation styling
            </h2>

            <div className="space-y-1.5">
              <FieldLabel id="font-label">Font</FieldLabel>
              <Select value={editor.font} onValueChange={v => setEditor(e => ({ ...e, font: v }))}>
                <SelectTrigger className="h-11 text-xs" aria-labelledby="font-label">
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
                className="h-11 text-xs"
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
                    className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${
                        editor.color === c.value ? 'border-primary scale-110' : 'border-border'
                      }`}
                      style={{ backgroundColor: c.value }}
                    />
                  </button>
                ))}
              </div>
              <Input
                type="color"
                value={editor.color}
                onChange={e => setEditor(p => ({ ...p, color: e.target.value }))}
                aria-label="Custom colour"
                className="h-11 w-full cursor-pointer"
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
                    className={`flex h-11 flex-1 items-center justify-center text-xs border rounded capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
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
            serverBlocking={serverBlocking}
            retiredRelease={retiredRelease}
            busy={busy}
            onCreateVersion={handleCreateVersion}
            onPublish={handlePublish}
            onRotate={handleRotate}
            onRevoke={handleRevoke}
          />
        </aside>
      </main>
    </div>
  );
};

export default EditProject;
