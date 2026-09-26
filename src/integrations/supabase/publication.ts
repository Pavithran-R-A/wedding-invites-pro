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
