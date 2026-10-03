// The host's side of publication: version, publish, share, rotate, take down.
//
// Everything here is an `api` RPC, called as the signed-in user. That is a deliberate
// shape, not a style preference: the database derives the caller's identity from the JWT
// and proves ownership of the wedding server-side, so there is no `userId` argument to
// pass. A client-supplied owner would be a value the function had to distrust anyway,
// and `api.create_invitation_version(p_wedding_id, p_owner_user_id)` would read as though
// the host could choose whose wedding to publish.
//
// No raw token is ever held here beyond the response that mints it, and nothing writes to
// `private`: `private.access_tokens` has no HTTP surface by design, which is why
// `rotate` and `revoke` are RPCs rather than an UPDATE the app could have written.
//
// Errors follow the Stage 2 rule, in one place: the returned `error` is a fixed phrase
// chosen by this file, and the only thing taken from the server is its error *code*,
// logged through `describe()`. A Postgres message can name a table, a policy or another
// owner's row, and none of those are the customer's to read.

import { supabase } from './client';
import { asObject, isBooleanValue, isNumberValue, isText, booleanValue, numberValue, text } from '@/lib/jsonShape';
import { describe } from '@/lib/safeError';
import { parsePublicInvitation, type PublicInvitation } from '@/lib/publicInvitation';
import {
  PACK_HOST_FIELDS,
  PACK_OVERRIDE_RULES,
  PACK_SECTION_KEYS,
  PACK_SECTION_KINDS,
  type PackHostField,
  type PackOverrideRule,
  type PackSectionKey,
  type PackSectionKind,
} from '@/lib/traditionPackContract';
import type { QueryResult } from './weddings';

/** A frozen version, as the host is told about it. The snapshot itself is not carried:
 *  it is the internal shape, and `preview_invitation` is the sanctioned read of it. */
export interface InvitationVersion {
  id: string;
  versionNumber: number;
}

/** What publishing answered. `path` is null when the wedding already had a live link and
 *  the host is being told, honestly, that the address they already shared now shows this
 *  version — `linkReused` is that sentence as a boolean. */
export interface PublicationOutcome {
  path: string | null;
  linkReused: boolean;
}

/** A rotated link always has a new address; that is the whole request. */
export interface RotatedLink {
  path: string;
  previousRevokedAt: string | null;
}

export interface RevocationOutcome {
  revoked: boolean;
  tokensRevoked: number;
}

/** The live publication, or `null` when this wedding has never been published. */
export interface PublicationState {
  versionNumber: number | null;
  publishedAt: string | null;
  linkActive: boolean;
  linkExpiresAt: string | null;
}

const MODULE = 'publication';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

/** `api.*` returns `jsonb`, which arrives as `Json`. Every response is read field by
 *  field so a changed RPC is a refusal here, not a `undefined` reaching the UI. */
const parseVersion = (value: unknown): InvitationVersion | null => {
  const raw = asObject(value);
  if (!raw || typeof raw.version_id !== 'string') return null;
  if (!isNumberValue(raw.version_number)) return null;
  const versionNumber = numberValue(raw.version_number);
  if (versionNumber === null) return null;
  return { id: raw.version_id, versionNumber };
};

const parsePath = (value: unknown): string | null => {
  const path = text(value);
  // The database writes `/i/` plus a 43-character credential. Anything else is not a
  // link, and building an anchor out of a surprising string is not worth the risk.
  return path !== null && /^\/i\/[A-Za-z0-9_-]{43}$/.test(path) ? path : null;
};

const parsePublication = (value: unknown): PublicationOutcome | null => {
  const raw = asObject(value);
  if (!raw || !isBooleanValue(raw.link_reused)) return null;
  if (!isText(raw.path) && raw.path !== undefined) return null;
  return { path: parsePath(raw.path), linkReused: booleanValue(raw.link_reused) ?? false };
};

const parseRotation = (value: unknown): RotatedLink | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.previous_revoked_at)) return null;
  const path = parsePath(raw.path);
  if (path === null) return null;
  return { path, previousRevokedAt: text(raw.previous_revoked_at) };
};

const parseRevocation = (value: unknown): RevocationOutcome | null => {
  const raw = asObject(value);
  if (!raw || !isBooleanValue(raw.revoked) || !isNumberValue(raw.tokens_revoked)) return null;
  return { revoked: booleanValue(raw.revoked) ?? false, tokensRevoked: numberValue(raw.tokens_revoked) ?? 0 };
};

const parseState = (value: unknown): PublicationState | null | undefined => {
  const raw = asObject(value);
  // `undefined` means "this response is not a publication state"; `null` means the
  // wedding has one and it is not published yet, which the host is told differently.
  if (!raw) return undefined;
  if (raw.publication_id === null || raw.publication_id === undefined) return null;
  if (!isNumberValue(raw.version_number) || !isText(raw.published_at) || !isText(raw.link_expires_at)) return null;
  if (!isBooleanValue(raw.link_active)) return null;
  return {
    versionNumber: numberValue(raw.version_number),
    publishedAt: text(raw.published_at),
    linkActive: booleanValue(raw.link_active) ?? false,
    linkExpiresAt: text(raw.link_expires_at),
  };
};

/** The host's preview: the same projection a guest is answered with, from live rows. */
export async function previewInvitation(weddingId: string): Promise<QueryResult<PublicInvitation | null>> {
  const { data, error } = await supabase.schema('api').rpc('preview_invitation', { p_wedding_id: weddingId });
  if (error) return fail('the preview could not be drawn', error);
  const invitation = parsePublicInvitation({ available: true, invitation: data });
  if (invitation === null) return fail('the preview could not be drawn', null);
  return { data: invitation, error: null };
}

/** One way the live document falls short, as the server computed it. */
export interface InvitationIssue {
  code: string;
  /** The stable name this build's own copy is keyed on. `code` and `messageKey` are the same
   *  string today; keeping both read means a server that starts to separate them cannot make
   *  the editor print the wrong sentence, because the lookup uses only the key. */
  messageKey: string;
  sectionKey: string | null;
  field: string | null;
  blocking: boolean;
  params: Record<string, unknown>;
}

/**
 * What one section of this wedding's release asks the host to do, in the release's own order.
 *
 * This is the AUTHORING DECLARATION, and it is the reason the editor never reads a pack
 * definition: the server has already applied its own defaults (`required` false,
 * `override_rule` `host_may_replace`, `requires_venue` false), so a v1 release or a wedding with
 * no pack arrives as a declaration that asks for nothing beyond what the manual editor always
 * showed. `kind` says which control belongs here and `hostField` says which of the four draft
 * slots it writes; the reviewed wording itself is not repeated, because it is already on the
 * document as a section body with its provenance.
 */
export interface AuthoringSection {
  sectionKey: PackSectionKey;
  kind: PackSectionKind;
  position: number;
  required: boolean;
  hostField: PackHostField | null;
  /** null on a structured section, which has no wording to override. */
  overrideRule: PackOverrideRule | null;
  /** null on anything but an event list. */
  requiresVenue: boolean | null;
}

/** The release behind a live document, in the only form a host needs. */
export interface SelectedReleaseSummary {
  packKey: string;
  displayName: string;
  releaseNumber: number;
  definitionSchemaVersion: number;
  /** False when the release has been retired since — the fact a "this invitation uses an
   *  older release" notice is built from, and not the word `deprecated`. */
  isCurrent: boolean;
}

/**
 * The document, the server's verdict on it, the rules behind it, and what it stands on — from
 * one resolution.
 *
 * This is Stage 5's answer to the preview/freeze parity requirement, and the shape is the
 * point: the document, its issues and its authoring declaration arrive in the same round trip,
 * from the same snapshot and the same definition read, so what an editor refuses the button for
 * is the list the server produced about the bytes on screen, and the control that holds a
 * required line is the one the release says is required. `previewInvitation` above stays the
 * guest-projection read; this is the one a host's editor should use, and the freeze below still
 * recomputes everything, because a client that was told the truth at 14:00 can edit at 14:01.
 */
export async function previewInvitationDocument(
  weddingId: string,
): Promise<QueryResult<{
  invitation: PublicInvitation;
  issues: InvitationIssue[];
  authoring: AuthoringSection[];
  selectedRelease: SelectedReleaseSummary | null;
}>> {
  const { data, error } = await supabase.schema('api').rpc('preview_invitation_document', {
    p_wedding_id: weddingId,
  });
  if (error) return fail('the preview could not be drawn', error);
  const raw = asObject(data);
  const invitation = raw
    ? parsePublicInvitation({ available: true, invitation: raw.invitation })
    : null;
  if (!raw || invitation === null) return fail('the preview could not be drawn', null);
  if (!Array.isArray(raw.issues)) return fail('the preview could not be drawn', null);
  // A missing `authoring` array is a server that is not answering this shape, and an editor
  // that fell back to its own guess about the sections would be the thing §19 forbids. The
  // page keeps the last declaration it was given and reports the failure instead.
  if (!Array.isArray(raw.authoring)) return fail('the preview could not be drawn', null);
  return {
    data: {
      invitation,
      issues: raw.issues.map(parseIssue).filter((i): i is InvitationIssue => i !== null),
      authoring: raw.authoring.map(parseAuthoring).filter((s): s is AuthoringSection => s !== null),
      selectedRelease: parseSelectedRelease(raw.selected_release),
    },
    error: null,
  };
}

const parseIssue = (value: unknown): InvitationIssue | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.code) || !isBooleanValue(raw.blocking)) return null;
  if (!isText(raw.message_key)) return null;
  const params = asObject(raw.params);
  return {
    code: text(raw.code),
    messageKey: text(raw.message_key),
    sectionKey: text(presentValue(raw.section_key)),
    field: text(presentValue(raw.field)),
    blocking: booleanValue(raw.blocking) ?? false,
    params: params ?? {},
  };
};

/** One entry of the server's authoring declaration. A value outside this build's vocabulary is
 *  a rule the editor has no control for, so the whole entry is refused rather than drawn with
 *  the surprising field replaced by a guess — the server's issue list is what tells the host
 *  about a release this build cannot fully honour, and it does so by code, not by a control
 *  this file invented. */
const parseAuthoring = (value: unknown): AuthoringSection | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const sectionKey = text(presentValue(raw.section_key));
  const kind = text(presentValue(raw.kind));
  const position = numberValue(raw.position);
  if (sectionKey === null || !PACK_SECTION_KEYS.includes(sectionKey as PackSectionKey)) return null;
  if (kind === null || !PACK_SECTION_KINDS.includes(kind as PackSectionKind)) return null;
  if (position === null) return null;
  if (!isBooleanValue(raw.required)) return null;

  const hostField = text(presentValue(raw.host_field));
  if (hostField !== null && !PACK_HOST_FIELDS.includes(hostField as PackHostField)) return null;

  const rule = text(presentValue(raw.override_rule));
  if (rule !== null && !PACK_OVERRIDE_RULES.includes(rule as PackOverrideRule)) return null;

  if (raw.requires_venue !== undefined && !isBooleanValue(raw.requires_venue)) return null;
  return {
    sectionKey: sectionKey as PackSectionKey,
    kind: kind as PackSectionKind,
    position,
    required: booleanValue(raw.required) ?? false,
    hostField: hostField as PackHostField | null,
    overrideRule: rule as PackOverrideRule | null,
    requiresVenue: raw.requires_venue === undefined ? null : (booleanValue(raw.requires_venue) ?? false),
  };
};

const parseSelectedRelease = (value: unknown): SelectedReleaseSummary | null => {
  const raw = asObject(value);
  // `null` here is the no-tradition-pack state rather than a broken response, so the two are
  // told apart by the caller looking at the whole document, not by this parser guessing.
  if (!raw) return null;
  const packKey = text(raw.pack_key);
  const displayName = text(raw.display_name);
  const releaseNumber = numberValue(raw.release_number);
  const schemaVersion = numberValue(raw.definition_schema_version);
  if (packKey === null || displayName === null || releaseNumber === null) return null;
  if (!isBooleanValue(raw.status_is_current)) return null;
  return {
    packKey,
    displayName,
    releaseNumber,
    definitionSchemaVersion: schemaVersion ?? 0,
    isCurrent: booleanValue(raw.status_is_current) ?? false,
  };
};

const presentValue = (value: unknown): unknown => (value === undefined ? null : value);

export async function createInvitationVersion(
  weddingId: string,
): Promise<QueryResult<InvitationVersion>> {
  const { data, error } = await supabase
    .schema('api')
    .rpc('create_invitation_version', { p_wedding_id: weddingId });
  if (error) return fail('a version could not be created', error);
  const version = parseVersion(data);
  if (version === null) return fail('a version could not be created', null);
  return { data: version, error: null };
}

/**
 * Makes an existing version what the public link shows. `expiresAt` is an ISO timestamp
 * or absent; the database refuses one in the past, and that refusal reaches the host as
 * the same phrase as any other failure, because the reason is a rule about links rather
 * than something the visitor can act on.
 */
export async function publishInvitation(
  weddingId: string,
  versionId: string,
  expiresAt?: string,
): Promise<QueryResult<PublicationOutcome>> {
  const { data, error } = await supabase.schema('api').rpc('publish_invitation_version', {
    p_wedding_id: weddingId,
    p_version_id: versionId,
    p_expires_at: expiresAt ?? null,
  });
  if (error) return fail('the invitation could not be published', error);
  const outcome = parsePublication(data);
  if (outcome === null) return fail('the invitation could not be published', null);
  return { data: outcome, error: null };
}

export async function rotateInvitationLink(weddingId: string): Promise<QueryResult<RotatedLink>> {
  const { data, error } = await supabase.schema('api').rpc('rotate_invitation_token', {
    p_wedding_id: weddingId,
  });
  if (error) return fail('a new link could not be created', error);
  const rotated = parseRotation(data);
  if (rotated === null) return fail('a new link could not be created', null);
  return { data: rotated, error: null };
}

export async function revokeInvitationPublication(
  weddingId: string,
): Promise<QueryResult<RevocationOutcome>> {
  const { data, error } = await supabase.schema('api').rpc('revoke_invitation_publication', {
    p_wedding_id: weddingId,
  });
  if (error) return fail('the link could not be taken down', error);
  const outcome = parseRevocation(data);
  if (outcome === null) return fail('the link could not be taken down', null);
  return { data: outcome, error: null };
}

export async function getPublicationState(
  weddingId: string,
): Promise<QueryResult<PublicationState | null>> {
  const { data, error } = await supabase.schema('api').rpc('get_invitation_publication_state', {
    p_wedding_id: weddingId,
  });
  if (error) return fail('the link status could not be read', error);
  const state = parseState(data);
  if (state === undefined) return fail('the link status could not be read', null);
  return { data: state, error: null };
}
