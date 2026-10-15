// The render manifest, read as data rather than as rows.
//
// `api.list_invitation_outputs` answers a `jsonb` array (`internal_api.list_invitation_outputs`'s own
// `jsonb_agg`, one element per artefact) and this module is the only place that array is interpreted.
// Three jobs live here, none of which needs a network:
//
//   1. **A shape test, not a cast.** A row whose structural fields are the wrong kind is a manifest
//      from a build whose projection changed, and the whole read is refused rather than the odd row
//      dropped — a list that silently loses an artefact would tell a host they have nothing to print
//      when the truth is that this build cannot read their files.
//   2. **Words for the two vocabularies the database owns.** `output_kind`, `variant`, `format`,
//      `status` and `invalidation_reason` are CHECK-bounded in
//      `supabase/migrations/20261013120000_stage9_render_outputs.sql`, and the sets are repeated here
//      only as far as a label needs them. A value outside a set is printed as
//      "this build has no word for …" — Stage 8's posture — because inventing a label for tomorrow's
//      migration would put it on screen as today's fact. Nothing here re-enforces the ceiling on
//      `attempt_count` or the date ordering of `invalidated_at`; the database already does.
//   3. **The delivery address.** The manifest deliberately carries no object key: the RPC's own
//      comment says a path is not a delivery mechanism. Storage however signs an *object*, so the
//      adapter needs one, and the address is composed here from fields the row already returned —
//      `outputs/<wedding id>/<kind>/<variant>/<row id>`, the spelling
//      `private.mint_invitation_output_key()` writes at `:258-259` of that migration. Two things make
//      this safe rather than a second source of truth: every segment is validated against the
//      database's own vocabulary before it is used (an unknown kind or a malformed id yields no path,
//      and a path is never built from a string this module does not recognise), and authorisation does
//      not depend on it — `wedding_members_read_output_objects` (`:468-477`) signs nothing unless a row
//      of *this caller's* wedding carries that exact key. Getting the spelling wrong therefore costs a
//      failed download, never access to somebody else's file. `invitationOutputs.test.ts` pins the
//      spelling and the refusals, and the Stage 9 browser tier opens a real signed URL for a real
//      artefact, which is where a drifted template would be caught.
//
// `published_preview` rows get no address at all. That bucket is reachable only by an opaque key held
// by whoever already has it (§8), it has no read policy in this build, and the consent that would
// publish an image is an open product decision (§10.3) — so the host panel cannot and must not offer
// to sign one.

/** The four deliverables, spelled as the column's CHECK spells them. */
export const OUTPUT_KINDS = ['og_image', 'share_image', 'pdf', 'qr'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** The ten boxes the renderer offers (`variant`'s CHECK): one teaser, four share heights, two
 *  papers, three print plates. A page of a PDF shares its variant with page two, so `page_number`
 *  is the only thing that tells those rows apart. */
export const OUTPUT_VARIANTS = [
  '1200x630', '1080x1350', '1080x1620', '1080x1800', '1080x2160',
  'a4', 'letter', '25mm', '40mm', '60mm',
] as const;
export type OutputVariant = (typeof OUTPUT_VARIANTS)[number];

export const OUTPUT_FORMATS = ['png', 'webp', 'pdf'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** The five lifecycle states. `ready` is the only one with bytes behind it, and `invalidated` is the
 *  only one whose bytes are deliberately gone. */
export const OUTPUT_STATUSES = ['registered', 'uploading', 'ready', 'failed', 'invalidated'] as const;
export type OutputStatus = (typeof OUTPUT_STATUSES)[number];

/** The four reasons an artefact was retired, again the column's own vocabulary. */
export const INVALIDATION_REASONS = [
  'superseded', 'token_rotated', 'publication_revoked', 'asset_deleted',
] as const;
export type InvalidationReason = (typeof INVALIDATION_REASONS)[number];

export const OUTPUT_STORAGE_DOMAINS = ['host_private', 'published_preview'] as const;
export type OutputStorageDomain = (typeof OUTPUT_STORAGE_DOMAINS)[number];

/** One artefact, in the host's vocabulary. Field order follows the RPC's element, not the table. */
export interface InvitationOutput {
  id: string;
  versionId: string;
  kind: string;
  variant: string;
  format: string;
  pageNumber: number;
  status: string;
  contentDigest: string | null;
  renderConfigHash: string;
  storageDomain: string;
  readyAt: string | null;
  invalidationReason: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;

const isText = (value: unknown): value is string => typeof value === 'string';
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isNullish = (value: unknown): boolean => value === null || value === undefined;

/** `kind`, not `output_kind`: the host's screen never sees a column name, and a row's own words are
 *  what makes an unfamiliar value visible in the "no word for" branch below. */
const one = (raw: Record<string, unknown>, key: string): string | null => {
  const value = raw[key];
  return isText(value) && value !== '' ? value : null;
};

/** One element of the array, or null when it is not an artefact this build can describe. */
const parseOutput = (value: unknown): InvitationOutput | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const id = one(raw, 'id');
  const versionId = one(raw, 'version_id');
  const kind = one(raw, 'output_kind');
  const variant = one(raw, 'variant');
  const format = one(raw, 'format');
  const status = one(raw, 'status');
  const domain = one(raw, 'storage_domain');
  const config = one(raw, 'render_config_hash');
  const createdAt = one(raw, 'created_at');
  if (id === null || versionId === null || kind === null || variant === null || format === null) return null;
  if (status === null || domain === null || createdAt === null) return null;
  if (config === null || !DIGEST.test(config)) return null;
  if (!UUID.test(id) || !UUID.test(versionId)) return null;
  if (!isInt(raw.page_number) || raw.page_number < 1) return null;
  if (!isInt(raw.attempt_count) || raw.attempt_count < 0) return null;

  // The four nullable fields are read as "absent or the shape the CHECK demands", never as free
  // text: a `content_digest` that is not 64 hex is a projection change, and printing half of it as
  // though it were an identity would misdescribe the file behind it.
  const digest = raw.content_digest;
  if (!isNullish(digest) && !(isText(digest) && DIGEST.test(digest))) return null;
  const readyAt = raw.ready_at;
  if (!isNullish(readyAt) && !isText(readyAt)) return null;
  const reason = raw.invalidation_reason;
  if (!isNullish(reason) && !isText(reason)) return null;
  const lastError = raw.last_error;
  if (!isNullish(lastError) && !isText(lastError)) return null;

  return {
    id,
    versionId,
    kind,
    variant,
    format,
    pageNumber: raw.page_number as number,
    status,
    contentDigest: isText(digest) ? digest : null,
    renderConfigHash: config,
    storageDomain: domain,
    readyAt: isText(readyAt) ? readyAt : null,
    invalidationReason: isText(reason) ? reason : null,
    attemptCount: raw.attempt_count as number,
    lastError: isText(lastError) ? lastError : null,
    createdAt,
  };
};

/**
 * The manifest, or null.
 *
 * null means "this response is not a manifest" — a non-array, an empty-shaped object, or any element
 * that failed its own shape test. The caller turns that into one sentence; nothing here partially
 * succeeds.
 */
export const parseInvitationOutputs = (value: unknown): InvitationOutput[] | null => {
  if (!Array.isArray(value)) return null;
  const rows = value.map(parseOutput);
  return rows.some(row => row === null) ? null : (rows as InvitationOutput[]);
};

/**
 * The object this artefact lives at inside `invitation-outputs`, or null when there is none.
 *
 * Null is a real answer for three cases and the panel says why for each: the row is in the published
 * domain (no key is signable there by this client), one of its segments is a value this build does not
 * know (so it is not a box the renderer offers), or the wedding id handed in is not the uuid shape the
 * route should have supplied.
 */
export const outputDeliveryPath = (
  weddingId: string,
  output: InvitationOutput,
): string | null => {
  if (!UUID.test(weddingId)) return null;
  if (output.storageDomain !== 'host_private') return null;
  if (!(OUTPUT_KINDS as readonly string[]).includes(output.kind)) return null;
  if (!(OUTPUT_VARIANTS as readonly string[]).includes(output.variant)) return null;
  if (!UUID.test(output.id)) return null;
  return `outputs/${weddingId}/${output.kind}/${output.variant}/${output.id}`;
};

/** Only `ready` has bytes; `invalidated` had them and had them deleted with the row's retirement
 *  (§8's lifetime rule), so offering either a link would be a button that promises nothing. */
export const isDeliverable = (output: InvitationOutput): boolean => output.status === 'ready';

const KIND_WORDS: Record<OutputKind, string> = {
  og_image: 'Link preview image',
  share_image: 'Share image',
  pdf: 'Print-ready PDF',
  qr: 'QR plate',
};

const VARIANT_WORDS: Record<OutputVariant, string> = {
  '1200x630': '1200 × 630 teaser',
  '1080x1350': '1080 × 1350 portrait',
  '1080x1620': '1080 × 1620 story',
  '1080x1800': '1080 × 1800 square',
  '1080x2160': '1080 × 2160 tall',
  a4: 'A4 paper',
  letter: 'US Letter paper',
  '25mm': '25 mm plate',
  '40mm': '40 mm plate',
  '60mm': '60 mm plate',
};

const STATUS_WORDS: Record<OutputStatus, string> = {
  registered: 'Queued, nothing drawn yet',
  uploading: 'Being drawn now',
  ready: 'Ready',
  failed: 'Failed',
  invalidated: 'Retired',
};

const REASON_WORDS: Record<InvalidationReason, string> = {
  superseded: 'a newer version took its place',
  token_rotated: 'the address it points at was rotated away',
  publication_revoked: 'the publication was taken down',
  asset_deleted: 'a file it was built from was removed',
};

/** Unfamiliar value, printed as one. A label invented for a future migration would read as a fact
 *  about today's artefact, so the sentence names its own limit instead. */
const words = <T extends string>(table: Record<T, string>, value: string, kind: string): string =>
  Object.prototype.hasOwnProperty.call(table, value)
    ? table[value as T]
    : `this build has no word for the ${kind} “${value}”`;

export const kindWords = (kind: string): string => words(KIND_WORDS, kind, 'kind');
export const variantWords = (variant: string): string => words(VARIANT_WORDS, variant, 'size');
export const statusWords = (status: string): string => words(STATUS_WORDS, status, 'state');
export const reasonWords = (reason: string): string => words(REASON_WORDS, reason, 'reason');

/** `2026-11-14T09:12:00.123456+00:00` → the calendar day the server wrote. Read, not parsed: this is
 *  a stamp about when a file was made, and moving it into a viewer's timezone can describe a
 *  different day. */
export const dayOf = (iso: string | null): string | null => {
  if (iso === null) return null;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

/** What a row is, in one line, for the state that has no better sentence. */
export const outputSummary = (output: InvitationOutput): string => {
  const page = output.kind === 'pdf' && output.pageNumber > 1
    ? ` · page ${output.pageNumber}`
    : '';
  return `${kindWords(output.kind)} · ${variantWords(output.variant)} · ${output.format.toUpperCase()}${page}`;
};

/**
 * The reprint warnings, derived from the manifest rather than from a guess about the paper.
 *
 * §9.2 makes rotation and revocation the two moments a host must be told in plain words that a
 * printed plate is now dead, and the manifest is where the evidence of those moments lives: a `qr`
 * row invalidated with `token_rotated` is a plate that was retired because its address went away. The
 * sentences below name the artefacts they actually describe — one per reason present, counted — and
 * nothing here claims a *live* plate still matches the current address, because the read deliberately
 * carries no `target_url_digest` to compare against. That limitation is the last sentence rather
 * than an omission, so the host is not left believing a printed square is verified when it is only
 * unreplaced.
 *
 * What no sentence here says is that a rotation retires these rows. Nothing in this build does:
 * §9.2 gives every manifest write, `invalidated` included, to the render worker's privileged path, and
 * no token turnover triggers it. A notice below is therefore evidence the worker recorded, and the
 * general paragraph is the host's protection for the case the manifest cannot show — a plate printed
 * before a rotation whose retirement the worker has not written yet.
 */
export const reprintWarnings = (outputs: InvitationOutput[]): string[] => {
  const notices: string[] = [];
  const retiredBy = (reason: InvalidationReason): number =>
    outputs.filter(o => o.invalidationReason === reason).length;

  const rotated = retiredBy('token_rotated');
  if (rotated > 0) {
    notices.push(
      `${rotated} QR ${rotated === 1 ? 'plate was' : 'plates were'} retired when the address was `
      + 'rotated. Any printed copy of them now leads guests to a dead page — print fresh plates from '
      + 'the new address.',
    );
  }

  const revoked = retiredBy('publication_revoked');
  if (revoked > 0) {
    notices.push(
      `${revoked} ${revoked === 1 ? 'file was' : 'files were'} retired when the invitation was `
      + 'taken down. Nothing printed from them should be handed out while the link is down.',
    );
  }

  const superseded = retiredBy('superseded');
  if (superseded > 0) {
    notices.push(
      `${superseded} ${superseded === 1 ? 'file shows' : 'files show'} an older version of this `
      + 'invitation than the one now published. Their wording is the wording of the version they were '
      + 'drawn from, which is why they are retired rather than quietly reused: reprint from the '
      + 'version you published if the paper should match it.',
    );
  }

  const printed = outputs.filter(o => o.kind === 'qr' && o.status === 'ready');
  if (printed.length > 0) {
    notices.push(
      'A QR plate is a promise about an address, not about this invitation: it keeps working while '
      + 'that address does, and stops the moment the link is rotated or taken down. This list cannot '
      + 'tell you which address a stored plate encodes — the manifest deliberately keeps that out of '
      + 'reach — so if you printed before a rotation, print again.',
    );
  }

  return notices;
};
