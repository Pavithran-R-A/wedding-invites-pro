// Host-uploaded wedding assets: the registry row and the bytes it points at, kept in step.
//
// `wedding_assets` rows and `storage.objects` rows are two records of one fact, and the whole
// point of Stage 6 is that neither is allowed to claim the other's. That splits this layer into
// two kinds of calls: writes to the registry table, which go through PostgREST and are governed
// by `wedding_assets_mint_object_key` / `guard_wedding_asset_update` / `guard_wedding_asset_delete`
// in `supabase/migrations/20261006120000_stage6_wedding_asset_storage.sql`; and writes to Storage,
// which go through the Storage client and are governed by the three policies on `storage.objects`
// in the same file. Every exported function below sequences those two so a caller cannot get the
// order wrong, because the order is the product rule (§5.3: object-then-row on creation,
// tombstone-then-bytes-then-row on removal).
//
// What this layer deliberately does not do:
//   * It sends no `object_key`. The database mints `weddings/<wedding>/<kind>/<row id>` and refuses
//     a presented key with 42501, so a browser cannot name a path — which also means no template,
//     no prefix constant and no filename survives into `dist/`. The key the adapter uses is always
//     read back from the row it just inserted.
//   * It never calls `upsert`. `storage.objects` has no UPDATE policy, so an overwrite is refused by
//     the database; "replace" is therefore two already-proven flows (new pair, then retire the old)
//     rather than a third one with a different failure mode.
//   * It writes no guest-visible state. A signed URL is returned to the caller for a preview and is
//     never stored, never put in a snapshot, and never rendered on the guest route (§7 rules guest
//     asset delivery out of this stage; nothing here is reachable from `publicInvitation.ts`).
//   * It uses no privileged key. The only client this file imports is `client.ts`, whose session is
//     the publishable anon one, so invariant I10 holds by inspection — and deliberately nothing in
//     this comment names the privileged role, because a credential sweep of `src/` would otherwise
//     have to explain this file to itself.
//   * It validates three things and nothing more. Two of them restate what the bucket itself
//     enforces — the allowed MIME set and the 5 MiB ceiling — because the bucket's refusal arrives
//     as a storage error the host cannot read. The third is the file's own signature bytes, which
//     the server cannot check at all (see `contentRefusal`). Everything else, `asset_kind` and the
//     non-blank name included, stays the database's: an unknown kind is answered by its CHECK, and
//     no copy of that list is kept here to rot. `WeddingAssetsPanel.tsx` offers four kinds to click,
//     which is a presentation list and not a second rule — `generated_output` is absent because it
//     names a derivative the platform would produce rather than a file a host uploads, and any kind
//     the table does not know is still answered by the CHECK rather than by that list.
//
// WHERE THIS FILE HAS BEEN MEASURED. Two tiers call these functions. The unit tier is
// `src/test/weddingAssetUploadRules.test.ts`: every exported function against a recording stand-in, the
// refusals, the payload shapes and the call order, and three mutations of this file (a widened MIME set,
// a `>=` ceiling, an `upsert: true`) each break the case that should notice, so the suite is not passing
// by ignoring the code. The browser tier is `scripts/stage6-browser-assets.mjs`
// (`q6-logs/s6-browser-run-03.log`: 138 checks, 0 findings), which drives this module from the production
// bundle against the real local stack with real `File` objects — there each of the five refusals is
// proved by the request count *not moving*, and the accepted path by the minted key, the `ready` edge and
// the bytes behind a signed URL. Audit §37 records both. What has still not happened is a call from this
// module against a *hosted* stack, and the Stage 6 HTTP battery speaks REST and Storage directly rather
// than through these functions. Every statement above about what the database does was read off the
// migration, the Stage 6 SQL battery and the HTTP battery's `UPL-07` case — the last of those is where
// the confirmation edge was put markup bytes behind an allowed declaration and answered that the object
// was stored as declared.

import { supabase } from './client';
import { describe, codeOf } from '@/lib/safeError';
import type { QueryResult } from './weddings';
import type { Database } from './types';

type AssetRow = Database['public']['Tables']['wedding_assets']['Row'];
type AssetInsert = Database['public']['Tables']['wedding_assets']['Insert'];
type AssetUpdate = Database['public']['Tables']['wedding_assets']['Update'];
type AssetProjection = Pick<
  AssetRow,
  'id' | 'wedding_id' | 'asset_kind' | 'label' | 'object_key' | 'mime_type' | 'size_bytes' | 'upload_status'
>;

const ASSET_COLUMNS =
  'id, wedding_id, asset_kind, label, object_key, mime_type, size_bytes, upload_status';

/** The one bucket this product writes to, spelled here and nowhere else: the policies pin
   `bucket_id` to it, so a second occurrence in the codebase would be a second source of truth. */
const BUCKET = 'wedding-assets';

/** `storage.buckets.file_size_limit` for this bucket, measured from the row the Stage 6 migration
 *  writes. Checked here first because the bucket's own refusal is a storage-service error with no
 *  sentence a host can act on. */
const MAX_BYTES = 5242880;

/** `storage.buckets.allowed_mime_types` for the same row, and deliberately no SVG, HTML or PDF:
 *  the blueprint's "no user-supplied SVG or HTML" rule is enforced before a sanitiser is ever in
 *  the loop. The set is the bucket's, so an addition must be made in both places on purpose. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg'] as const;

/** Signed URLs are for a preview the host is looking at now. 60 seconds is short enough that a
 *  copied link stops working before it becomes a sharing mechanism. */
const PREVIEW_TTL_SECONDS = 60;

const TOO_LARGE = `the file is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB this invitation allows`;
const UNSUPPORTED_TYPE = 'the file is not one of the accepted types: a JPEG, PNG or WebP image, or an MP3';
const EMPTY_FILE = 'the file has no bytes in it';
const KIND_NEEDED = 'choose what kind of asset this is before uploading';
const NOT_THOSE_BYTES =
  'the file does not hold the bytes of the type it says it is, so nothing was uploaded';
/** 42501 on the confirmation edge means the row's claim about the bytes did not match the object
 *  found at the minted key — the one refusal where "upload it again" is the host's next move. */
const PERMISSION_REFUSED = '42501';

export type AssetStatus = 'staged' | 'ready' | 'tombstoned';

export interface AssetEntry {
  id: string;
  weddingId: string;
  assetKind: string;
  label: string | null;
  objectKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadStatus: AssetStatus;
}

/** A host's own words about the file, as the form holds them. The size and type are what the row
 *  will *claim*. The confirmation edge tests the size claim against the object's measured length,
 *  which is content-derived; it tests the type claim against the MIME the service recorded from the
 *  uploader's own header, so `contentRefusal` is what makes this draft's type mean something. */
export interface AssetDraft {
  assetKind: string;
  label: string;
  mimeType: string;
  sizeBytes: number;
}

const blank = (value: string): boolean => value.trim() === '';
const textOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe('weddingAssets', context, error));
  return { data: null, error: context };
};

const refused = (error: string): { data: null; error: string } => ({ data: null, error });

const toAsset = (row: AssetProjection): AssetEntry => ({
  id: row.id,
  weddingId: row.wedding_id,
  assetKind: row.asset_kind,
  label: row.label,
  objectKey: row.object_key,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  uploadStatus: row.upload_status as AssetStatus,
});

/** The read-back after a write is what makes an RLS no-op visible here as everywhere else: a policy
 *  that does not match the caller returns nothing rather than an error, and "no rows" is not a
 *  stored asset. */
const firstRow = <T extends object>(data: T[] | null | undefined): T | null =>
  Array.isArray(data) && data.length > 0 ? data[0] : null;

/** Checked before the register step, so a file that cannot be accepted never costs a row that would
 *  have to be cleaned up afterwards. */
const fileRefusal = (draft: AssetDraft, file: File): string | null => {
  if (blank(draft.assetKind)) return KIND_NEEDED;
  if (file.size === 0) return EMPTY_FILE;
  if (!ALLOWED_MIME.includes(draft.mimeType as (typeof ALLOWED_MIME)[number])) return UNSUPPORTED_TYPE;
  if (file.size > MAX_BYTES) return TOO_LARGE;
  return null;
};

/** The head length the signatures below need. WebP is the longest: `RIFF` at byte 0 and `WEBP` at
 *  byte 8, so 12 bytes; 16 leaves room for a type whose marker sits further in. */
const SIGNATURE_BYTES = 16;

const asciiRun = (head: Uint8Array, from: number, to: number): string =>
  head.length >= to ? String.fromCharCode(...head.subarray(from, to)) : '';

/** Does the file's own first bytes belong to the type it declares? Each accepted type is named by a
 *  marker that no other accepted type can produce: PNG's eight-byte signature, JPEG's `FF D8 FF`
 *  start-of-image, WebP's `RIFF`...`WEBP` pair, and an MP3's `ID3` tag or a frame sync (`FF` followed
 *  by 111xx — `D8`, the JPEG second byte, fails the `E0` mask, so the two sets do not overlap). */
const matchesSignature = (head: Uint8Array, mimeType: string): boolean => {
  switch (mimeType) {
    case 'image/png':
      return head.length >= 8
        && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte);
    case 'image/jpeg':
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/webp':
      return asciiRun(head, 0, 4) === 'RIFF' && asciiRun(head, 8, 12) === 'WEBP';
    case 'audio/mpeg':
      return asciiRun(head, 0, 3) === 'ID3' || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    default:
      return false;
  }
};

/** Why the bytes are checked here rather than by the database. Measured on this stack (HTTP battery
 *  case `UPL-07`, capture `s6-api-run-03.log`): markup PUT with an allowed declaration was stored,
 *  `storage.objects.metadata->>'mimetype'` came back equal to the declaration the same client sent,
 *  and the confirmation edge accepted the row's matching claim — because `storage.objects` has no
 *  byte column in this build (`STORAGE_BACKEND=FILE`), so a trigger here can only compare claims to
 *  metadata, never to content. The size half of that edge *is* content-derived and stays; the type
 *  half only holds where the bytes are, which is this side of the wire. */
const contentRefusal = async (draft: AssetDraft, file: File): Promise<string | null> => {
  const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  return matchesSignature(head, draft.mimeType) ? null : NOT_THOSE_BYTES;
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every row the wedding's owner can see, including `staged` and `tombstoned` ones: a half-finished
 *  upload is a fact the host is entitled to see, and §5.2 names the two orphan classes rather than
 *  hiding them behind a filter. */
export async function listAssets(weddingId: string): Promise<QueryResult<AssetEntry[]>> {
  const { data, error } = await supabase
    .from('wedding_assets')
    .select(ASSET_COLUMNS)
    .eq('wedding_id', weddingId)
    .order('created_at')
    .order('id');
  if (error) return fail('the uploads could not be loaded', error);
  return { data: (data ?? []).map((row: AssetProjection) => toAsset(row)), error: null };
}

/** A time-limited link for a preview only. Nothing here caches it, and nothing writes it to a row:
 *  the row's own `object_key` is the durable identifier. */
export async function previewAsset(objectKey: string): Promise<QueryResult<string>> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectKey, PREVIEW_TTL_SECONDS);
  if (error) return fail('this upload could not be previewed', error);
  if (!data?.signedUrl) return fail('this upload could not be previewed', null);
  return { data: data.signedUrl, error: null };
}

// ---------------------------------------------------------------------------
// The three steps one upload is made of
// ---------------------------------------------------------------------------

/**
 * Steps 1-3 of §5.3, as one call: check the bytes, register (no key supplied), upload the bytes to
 * the key the database minted, then confirm — where the trigger re-reads `storage.objects` and
 * refuses if the row's claimed size is not the object's measured length, or its claimed type is not
 * the MIME the service recorded for that object. The recorded type is the uploader's own declaration
 * (see `contentRefusal`), which is why the markup check happens here rather than there.
 *
 * A failure at the upload or confirmation step rolls the row back rather than leaving it behind:
 * `staged` with no object is orphan class O2, and the honest way to avoid it is to remove the row
 * while its bytes are absent, which is exactly the state the delete guard accepts. If that cleanup
 * itself fails, the row id is in the log line so the host can still delete it through `removeAsset`.
 */
export async function uploadAsset(
  weddingId: string,
  draft: AssetDraft,
  file: File,
): Promise<QueryResult<AssetEntry>> {
  const refusal = fileRefusal(draft, file);
  if (refusal !== null) return refused(refusal);
  const byteRefusal = await contentRefusal(draft, file);
  if (byteRefusal !== null) return refused(byteRefusal);
  const bytesRefusal = await contentRefusal(draft, file);
  if (bytesRefusal !== null) return refused(bytesRefusal);

  const registered = await registerAsset(weddingId, draft);
  if (registered.error !== null) return { data: null, error: registered.error };
  const row = registered.data;
  if (row === null) return refused('the upload could not be started');

  const uploaded = await putObject(row.objectKey, file, draft.mimeType);
  if (uploaded.error !== null) {
    // A failed upload leaves no bytes at the key, which is exactly the state the delete guard lets
    // a row leave from — so the staged row can go directly. Whether a *refused* upload can leave a
    // partial object is one of the things the Stage 6 HTTP battery has to answer, and if it can,
    // this call is answered by the guard's "still in storage" refusal rather than by a silent pass.
    const discarded = await deleteRow(weddingId, row.id);
    if (discarded.error !== null) return { data: null, error: discarded.error };
    return { data: null, error: uploaded.error };
  }

  const confirmed = await confirmAsset(weddingId, row.id, draft);
  if (confirmed.error !== null) {
    // The bytes exist and the row will not claim them, so the pair is retired in the order the
    // guards accept: tombstone the row, collect the bytes, then delete the row.
    const retired = await retirePair(weddingId, row.id, row.objectKey);
    if (retired.error !== null) return { data: null, error: retired.error };
    return { data: null, error: confirmed.error };
  }
  if (confirmed.data === null) return fail('the upload could not be read back after it was confirmed', null);
  return { data: confirmed.data, error: null };
}

/** Step 1. The payload below has no `object_key` because the database mints one and refuses a
 *  presented key; the generated Insert type cannot see that a BEFORE trigger supplies the value, so
 *  the cast is the one place in this file that crosses that documented gap. The read-back is not a
 *  convenience: §4's "no user-controlled path" invariant only holds if the browser learns the key
 *  from the row it just inserted, so nothing here can build a key from a template. */
async function registerAsset(
  weddingId: string,
  draft: AssetDraft,
): Promise<QueryResult<{ id: string; objectKey: string }>> {
  const payload = {
    wedding_id: weddingId,
    asset_kind: draft.assetKind.trim(),
    label: textOrNull(draft.label),
    mime_type: draft.mimeType,
    size_bytes: draft.sizeBytes,
  } as AssetInsert;
  const { data, error } = await supabase
    .from('wedding_assets')
    .insert(payload)
    .select('id, object_key');
  if (error) return fail('the upload could not be registered', error);
  const row = firstRow(data);
  if (row === null) return fail('the upload could not be registered', null);
  return { data: { id: row.id, objectKey: row.object_key }, error: null };
}

/** Step 2. `upsert` is left at its default `false` and said out loud, because the only way to ask
 *  for an overwrite would be to reach for `upsert: true` — which this stack's database refuses,
 *  since there is no UPDATE policy on `storage.objects`. */
async function putObject(objectKey: string, file: File, contentType: string): Promise<QueryResult<null>> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectKey, file, { contentType, upsert: false });
  if (error) {
    console.warn(describe('weddingAssets', 'the bytes were not stored', error));
    return { data: null, error: 'the file could not be stored' };
  }
  return { data: null, error: null };
}

/** Step 3. The claims sent here are the ones the row was registered with, and the trigger compares
 *  them against what the object's own record says — its measured length, and the MIME the service
 *  stored for it. A row that cannot match its object stays `staged` rather than becoming a false
 *  `ready`; the type half of that match is only as independent as the upload's declaration was,
 *  which is why `contentRefusal` ran before step 1. */
async function confirmAsset(
  weddingId: string,
  assetId: string,
  draft: AssetDraft,
): Promise<QueryResult<AssetEntry>> {
  const patch: AssetUpdate = {
    upload_status: 'ready',
    mime_type: draft.mimeType,
    size_bytes: draft.sizeBytes,
  };
  const { data, error } = await supabase
    .from('wedding_assets')
    .update(patch)
    .eq('id', assetId)
    .eq('wedding_id', weddingId)
    .select(ASSET_COLUMNS);
  if (error) {
    if (codeOf(error) === PERMISSION_REFUSED) {
      return refused('the stored file did not match what this upload claimed, so it was not marked ready');
    }
    return fail('the upload could not be confirmed', error);
  }
  const row = firstRow(data);
  if (row === null) return fail('the upload could not be confirmed', null);
  return { data: toAsset(row), error: null };
}

// ---------------------------------------------------------------------------
// Replace, and the two ways a row goes away
// ---------------------------------------------------------------------------

/**
 * Step 5 of §5.3: the new pair is fully confirmed *before* the old one is touched, so a failure in
 * the new upload leaves the invitation exactly as it was rather than holding a retired row and no
 * replacement. The old row then follows step 6.
 */
export async function replaceAsset(
  weddingId: string,
  previous: AssetEntry,
  draft: AssetDraft,
  file: File,
): Promise<QueryResult<AssetEntry>> {
  const fresh = await uploadAsset(weddingId, draft, file);
  if (fresh.error !== null) return fresh;
  const removed = await removeAsset(previous);
  if (removed.error !== null) {
    // Both the new and the old asset now exist, which is the safe direction: nothing the host
    // published points at bytes that have been collected. This shape says only "it failed", so
    // the host finds the new row by re-listing — which is where the panel reads it from anyway.
    // No third result type is invented to carry "uploaded but not retired", because nothing
    // outside this module has to act on that distinction beyond showing the sentence.
    return { data: null, error: removed.error };
  }
  return fresh;
}

/**
 * Step 6 of §5.3: tombstone, remove the bytes, delete the row — in that order, each step separately
 * observable. Tombstoning first is what makes the object removable at all (the DELETE policy on
 * `storage.objects` only matches a tombstoned row), and the row is only deletable once the object is
 * gone (the delete guard refuses while it resolves). A crash between the two leaves a named orphan
 * class rather than a state with no name.
 */
export async function removeAsset(asset: AssetEntry): Promise<QueryResult<null>> {
  if (asset.uploadStatus === 'tombstoned') {
    // Removal already began; the row is the pointer and the bytes are still there, so finish the
    // two steps that remain rather than re-tombstoning a state the guard treats as terminal.
    const cleared = await removeStoredBytes(asset.objectKey);
    if (cleared.error !== null) return { data: null, error: cleared.error };
    return deleteRow(asset.weddingId, asset.id);
  }
  return retirePair(asset.weddingId, asset.id, asset.objectKey);
}

/** The three steps, in the only order the two guards allow. Exposed as the end of both the
 *  host's "delete" and a failed confirmation, because a pair that half-exists must be retired by
 *  the same route rather than by a second sequence that can disagree with the first. */
async function retirePair(
  weddingId: string,
  assetId: string,
  objectKey: string,
): Promise<QueryResult<null>> {
  const tombstoned = await tombstoneRow(weddingId, assetId);
  if (tombstoned.error !== null) return { data: null, error: tombstoned.error };

  const cleared = await removeStoredBytes(objectKey);
  if (cleared.error !== null) return { data: null, error: cleared.error };

  return deleteRow(weddingId, assetId);
}

async function tombstoneRow(weddingId: string, assetId: string): Promise<QueryResult<null>> {
  const patch: AssetUpdate = { upload_status: 'tombstoned' };
  const { data, error } = await supabase
    .from('wedding_assets')
    .update(patch)
    .eq('id', assetId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the asset could not be marked for removal', error);
  if (firstRow(data) === null) return fail('the asset could not be marked for removal', null);
  return { data: null, error: null };
}

/** Bytes may only be collected while the row at that key is `tombstoned`, so this is never called
 *  on a live asset — the storage DELETE policy would refuse it and the host would be told about a
 *  permission problem instead of about their own click order. */
async function removeStoredBytes(objectKey: string): Promise<QueryResult<null>> {
  const { error } = await supabase.storage.from(BUCKET).remove([objectKey]);
  if (error) {
    console.warn(describe('weddingAssets', 'the stored bytes were not removed', error));
    return { data: null, error: 'the stored file could not be removed, so this asset is still listed' };
  }
  return { data: null, error: null };
}

async function deleteRow(weddingId: string, assetId: string): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('wedding_assets')
    .delete()
    .eq('id', assetId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the asset record could not be removed', error);
  if (firstRow(data) === null) return fail('the asset record could not be removed', null);
  return { data: null, error: null };
}
