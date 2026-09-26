// The app's only door onto the canonical database.
//
// Stage 2 replaced the scaffold tables (`projects`, `templates`, `guests`, `orders`)
// with the VivaahVarnam domain: a wedding is a `weddings` row and a design is a
// `design_templates` row. Pages read and write through the functions below instead of
// naming tables, so a later stage can change a column without touching seven files —
// and so `grep -rn "\\.from(" src` has exactly one answer to inspect.
//
// What this layer deliberately does not do:
//   * It does not widen what RLS allows. Every call runs as the signed-in user, and a
//     row that is not theirs reads as absent rather than as an error to explain.
//   * It does not carry legacy fields. There is no `paid_status`, no
//     `selected_features` catch-all and no `guest_count`; a value with no canonical
//     column has no canonical meaning, and inventing one here would be the same
//     mistake the migration was written to refuse.
//   * It does not reach into `private` or `legacy`. Those schemas are not in the
//     generated types either, which is checked by `npm run dbtypes:check`.
//
// Routes and page copy still say "project" (`/project/:id/configure`). That is the
// compatibility name the product still shows customers; it is not a database term, and
// `scripts/check-product-contract.mjs` keeps it that way.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import type { Database, Json } from './types';

type WeddingRow = Database['public']['Tables']['weddings']['Row'];
type DesignTemplateRow = Database['public']['Tables']['design_templates']['Row'];

/** The columns `WEDDING_COLUMNS` actually projects. Every read in this adapter asks for
 *  that subset, so it — not the full row — is the shape callers see. */
type WeddingProjection = Pick<
  WeddingRow,
  'id' | 'title' | 'primary_language' | 'estimated_guest_count' | 'design_template_id' | 'created_at'
>;

/** The catalogue subset `listDesignOptions` projects. */
type DesignProjection = Pick<DesignTemplateRow, 'id' | 'display_name' | 'preview_svg'>;

/** A design the customer may choose. `status` is not exposed: it is a review verdict
 *  the catalogue policy has already applied before this function returns. */
export interface DesignOption {
  id: string;
  displayName: string;
  previewSvg: string | null;
}

/** A wedding as the dashboard and configure screens use it. */
export interface WeddingSummary {
  id: string;
  title: string;
  primaryLanguage: string | null;
  estimatedGuestCount: number;
  designTemplateId: string | null;
  createdAt: string;
}

/** The design preview's whole working set: what to draw on, and how it is styled.
 *  `styleSettings` is the visual editor object, not a general-purpose bag — the
 *  canonical column exists for these settings and nothing else. */
export interface WeddingDesign extends WeddingSummary {
  styleSettings: Record<string, Json>;
  previewSvg: string | null;
}

export interface NewWedding {
  title: string;
  primaryLanguage: string | null;
  designTemplateId: string | null;
}

/** `{ data, error }` mirrors what the pages used to branch on directly. `error` is a
 *  log-safe phrase, never a database message: the raw text can name a table, a policy
 *  or a column, and none of those are the customer's to read. What the server did say is
 *  logged beside it through `describe()`, which keeps only the error's code. */
export type QueryResult<T> = { data: T; error: null } | { data: null; error: string };

const WEDDING_COLUMNS =
  'id, title, primary_language, estimated_guest_count, design_template_id, created_at';

/** Catalogue statuses a signed-in customer may see. `deprecated` rows exist for
 *  weddings that were built on them and are hidden from new choices. */
const VISIBLE_DESIGNS = ['draft', 'approved'];

const toSummary = (row: WeddingProjection): WeddingSummary => ({
  id: row.id,
  title: row.title,
  primaryLanguage: row.primary_language,
  estimatedGuestCount: row.estimated_guest_count,
  designTemplateId: row.design_template_id,
  createdAt: row.created_at,
});

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe('weddings', context, error));
  return { data: null, error: context };
};

export async function listDesignOptions(): Promise<QueryResult<DesignOption[]>> {
  const { data, error } = await supabase
    .from('design_templates')
    .select('id, display_name, preview_svg')
    .in('status', VISIBLE_DESIGNS)
    .order('display_name');
  if (error) return fail('design list could not be loaded', error);
  return {
    data: (data ?? []).map((row: DesignProjection) => ({
      id: row.id,
      displayName: row.display_name,
      previewSvg: row.preview_svg,
    })),
    error: null,
  };
}

export async function listWeddings(userId: string): Promise<QueryResult<WeddingSummary[]>> {
  const { data, error } = await supabase
    .from('weddings')
    .select(WEDDING_COLUMNS)
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return fail('invitations could not be loaded', error);
  return { data: (data ?? []).map(toSummary), error: null };
}

export async function getWedding(
  userId: string,
  weddingId: string,
): Promise<QueryResult<WeddingSummary | null>> {
  const { data, error } = await supabase
    .from('weddings')
    .select(WEDDING_COLUMNS)
    .eq('id', weddingId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (error) return fail('this invitation could not be opened', error);
  return { data: data ? toSummary(data) : null, error: null };
}

/**
 * The design preview's read. The template's artwork is fetched separately rather than
 * embedded, so a wedding built on a retired design still opens: it loses its artwork
 * and keeps its text, which is what the customer can still act on.
 */
export async function getWeddingDesign(
  userId: string,
  weddingId: string,
): Promise<QueryResult<WeddingDesign | null>> {
  const { data: row, error } = await supabase
    .from('weddings')
    .select(`${WEDDING_COLUMNS}, style_settings`)
    .eq('id', weddingId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (error) return fail('this invitation could not be opened', error);
  if (!row) return { data: null, error: null };

  let previewSvg: string | null = null;
  if (row.design_template_id) {
    const { data: artwork, error: artworkError } = await supabase
      .from('design_templates')
      .select('preview_svg')
      .eq('id', row.design_template_id)
      .in('status', VISIBLE_DESIGNS)
      .maybeSingle();
    if (artworkError) console.warn('[weddings] design artwork unavailable');
    previewSvg = artwork?.preview_svg ?? null;
  }

  return {
    data: {
      ...toSummary(row),
      // `style_settings` is jsonb NOT NULL with a `jsonb_typeof(...) = 'object'` CHECK,
      // so an object is the only shape the client can ever receive; the generated `Json`
      // union cannot express that, so the narrowing belongs here rather than in pages.
      styleSettings: row.style_settings as Record<string, Json>,
      previewSvg,
    },
    error: null,
  };
}

export async function createWedding(
  userId: string,
  input: NewWedding,
): Promise<QueryResult<Pick<WeddingSummary, 'id'>>> {
  const { data, error } = await supabase
    .from('weddings')
    .insert({
      owner_user_id: userId,
      title: input.title,
      primary_language: input.primaryLanguage,
      design_template_id: input.designTemplateId,
    })
    .select('id')
    .single();
  if (error) return fail('the draft could not be created', error);
  return { data: { id: data.id }, error: null };
}

export async function updatePlanningDetails(
  userId: string,
  weddingId: string,
  changes: { title?: string; primaryLanguage?: string | null; estimatedGuestCount?: number },
): Promise<QueryResult<null>> {
  const patch: Database['public']['Tables']['weddings']['Update'] = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.primaryLanguage !== undefined) patch.primary_language = changes.primaryLanguage;
  if (changes.estimatedGuestCount !== undefined)
    patch.estimated_guest_count = changes.estimatedGuestCount;
  if (Object.keys(patch).length === 0) return { data: null, error: null };

  const { error } = await supabase
    .from('weddings')
    .update(patch)
    .eq('id', weddingId)
    .eq('owner_user_id', userId);
  if (error) return fail('the changes could not be saved', error);
  return { data: null, error: null };
}

/**
 * Replaces the wedding's style settings. `weddings.style_settings` is one jsonb value,
 * so callers pass the complete editor object — the merge that used to happen inside
 * the `selected_features.editor` key is now just what this column holds.
 */
export async function updateStyleSettings(
  userId: string,
  weddingId: string,
  styleSettings: Record<string, Json>,
): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from('weddings')
    .update({ style_settings: styleSettings })
    .eq('id', weddingId)
    .eq('owner_user_id', userId);
  if (error) return fail('the design could not be saved', error);
  return { data: null, error: null };
}

/**
 * The four paragraphs the host writes. `invitation_drafts.content` is one jsonb object
 * and this editor is its only author, so a save replaces it with these four keys —
 * blanks included. That is the same decision `style_settings` makes: the column exists
 * for the document and for nothing else, so there is no stray key for a later stage to
 * mistake for a feature.
 *
 * The draft row itself is created and destroyed by the database beside its wedding
 * (`20260926140000_stage3_close_draft_invariant.sql` revoked INSERT and DELETE for
 * browser roles), so nothing here can add or remove a draft.
 */
export interface InvitationDraftContent {
  welcome: string | null;
  familyIntroduction: string | null;
  eventNotes: string | null;
  closing: string | null;
}

/** A draft with nothing written in it — the state of a wedding whose draft row the
 *  database created beside it. Lives here rather than in the editor component so the
 *  component exports only components. */
export const EMPTY_DRAFT_CONTENT: InvitationDraftContent = {
  welcome: null,
  familyIntroduction: null,
  eventNotes: null,
  closing: null,
};

const DRAFT_KEYS: Record<keyof InvitationDraftContent, string> = {
  welcome: 'welcome',
  familyIntroduction: 'family_introduction',
  eventNotes: 'event_notes',
  closing: 'closing',
};

/** An object whose slots are text or absent; anything else is read as empty rather than
 *  shown, because a number in a prose slot is a bug in a row, not a paragraph. */
const draftFrom = (content: unknown): InvitationDraftContent => {
  const raw = typeof content === 'object' && content !== null && !Array.isArray(content)
    ? content as Record<string, unknown>
    : {};
  const slot = (key: keyof InvitationDraftContent): string | null =>
    typeof raw[DRAFT_KEYS[key]] === 'string' ? raw[DRAFT_KEYS[key]] as string : null;
  return {
    welcome: slot('welcome'),
    familyIntroduction: slot('familyIntroduction'),
    eventNotes: slot('eventNotes'),
    closing: slot('closing'),
  };
};

export async function getDraftContent(
  weddingId: string,
): Promise<QueryResult<InvitationDraftContent | null>> {
  const { data, error } = await supabase
    .from('invitation_drafts')
    .select('content')
    .eq('wedding_id', weddingId)
    .maybeSingle();
  if (error) return fail('the invitation text could not be loaded', error);
  return { data: data ? draftFrom(data.content) : null, error: null };
}

/**
 * Saves the host's text. There is no owner argument to filter on, because
 * `invitation_drafts` has no owner column: ownership is proved by
 * `owners_update_own_draft`, which simply does not match a foreign row. Reading the
 * affected row back is what turns "RLS decided you are nobody here" into a phrase the
 * host can act on, instead of a silent success.
 */
export async function updateDraftContent(
  weddingId: string,
  content: InvitationDraftContent,
): Promise<QueryResult<null>> {
  const payload = {
    [DRAFT_KEYS.welcome]: content.welcome,
    [DRAFT_KEYS.familyIntroduction]: content.familyIntroduction,
    [DRAFT_KEYS.eventNotes]: content.eventNotes,
    [DRAFT_KEYS.closing]: content.closing,
  };
  const { data, error } = await supabase
    .from('invitation_drafts')
    .update({ content: payload })
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the invitation text could not be saved', error);
  if (!data || data.length === 0) return fail('the invitation text could not be saved', null);
  return { data: null, error: null };
}

/** One frozen version, as the host's publication panel lists them. The snapshot is not
 *  selected: the panel needs a number and a date, and the internal shape of someone's
 *  invitation has no reason to reach a browser. */
export interface StoredInvitationVersion {
  id: string;
  versionNumber: number;
  createdAt: string;
}

/** The columns `listInvitationVersions` projects, named on the row so a column that
 *  stops existing is a type error rather than `undefined`. */
type VersionProjection = Pick<
  Database['public']['Tables']['invitation_versions']['Row'],
  'id' | 'version_number' | 'created_at'
>;

export async function listInvitationVersions(
  weddingId: string,
): Promise<QueryResult<StoredInvitationVersion[]>> {
  const { data, error } = await supabase
    .from('invitation_versions')
    .select('id, version_number, created_at')
    .eq('wedding_id', weddingId)
    .order('version_number', { ascending: false });
  if (error) return fail('the version history could not be loaded', error);
  return {
    data: (data ?? []).map((row: VersionProjection) => ({
      id: row.id,
      versionNumber: row.version_number,
      createdAt: row.created_at,
    })),
    error: null,
  };
}
