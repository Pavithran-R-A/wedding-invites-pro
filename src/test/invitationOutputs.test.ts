// The shape layer of the render manifest: what a row has to look like to be listed at all, where a
// file's address comes from, and what the panel is allowed to say about a printed plate.
//
// This file covers the three jobs `src/lib/invitationOutputs.ts` claims, and each is a different kind
// of refusal:
//
//   * **A lost artefact is worse than a failed read.** The projection is `api.list_invitation_outputs`'s
//     own `row_to_json` over a fixed column list
//     (`supabase/migrations/20261013120000_stage9_render_outputs.sql:576-578`), so a row that arrives
//     without `render_config_hash`, or with a `content_digest` that is not 64 hex, means the server's
//     projection moved and this build is reading it with the old assumptions. The whole list is refused
//     in that case rather than filtered, because a panel that drops one element silently tells a host
//     they have nothing to print when the truth is that it cannot read their files.
//   * **The delivery address is a spelling, and a spelling can drift.** `private.mint_invitation_output_key()`
//     writes `outputs/<wedding id>/<kind>/<variant>/<row id>` at `:258-259`, and the client is handed none
//     of it: the projection withholds `object_key` on purpose (`:550-554`). The assertions below pin the
//     exact string the two functions must agree on, and pin that an unrecognised segment produces no
//     string at all. What this cannot prove is that Storage accepts the composed path — that is the Stage 9
//     browser tier's job, on a file the render worker actually uploaded.
//   * **A reprint notice must not claim a fact the privacy boundary removed.** The read carries no
//     `target_url_digest`, so nothing here can tell a live plate from a stale one; the sentences are
//     checked below for the limit as well as for the count.
//
// Nothing here touches the network, and no claim about RLS, grants or bucket policies is made or
// implied — `supabase/tests/stage9/` qualifies those.

import { describe, expect, it } from "vitest";
import {
  dayOf,
  isDeliverable,
  kindWords,
  outputDeliveryPath,
  outputSummary,
  parseInvitationOutputs,
  reasonWords,
  reprintWarnings,
  statusWords,
  variantWords,
  type InvitationOutput,
} from "@/lib/invitationOutputs";

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const VERSION = '4a2b6c10-0000-4000-8000-000000000002';
const ROW = '9e3d5a70-0000-4000-8000-000000000003';
const CONFIG = 'a'.repeat(64);
const DIGEST = 'b'.repeat(64);

/** One element exactly as `row_to_json` over the projection's column list would write it. */
const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ROW,
  version_id: VERSION,
  output_kind: 'qr',
  variant: '25mm',
  format: 'png',
  page_number: 1,
  status: 'ready',
  content_digest: DIGEST,
  render_config_hash: CONFIG,
  storage_domain: 'host_private',
  ready_at: '2026-10-14T09:12:00.123456+00:00',
  invalidation_reason: null,
  attempt_count: 0,
  last_error: null,
  created_at: '2026-10-13T18:00:00+00:00',
  ...overrides,
});

const row = (overrides: Partial<InvitationOutput> = {}): InvitationOutput => ({
  id: ROW,
  versionId: VERSION,
  kind: 'qr',
  variant: '25mm',
  format: 'png',
  pageNumber: 1,
  status: 'ready',
  contentDigest: DIGEST,
  renderConfigHash: CONFIG,
  storageDomain: 'host_private',
  readyAt: '2026-10-14T09:12:00.123456+00:00',
  invalidationReason: null,
  attemptCount: 0,
  lastError: null,
  createdAt: '2026-10-13T18:00:00+00:00',
  ...overrides,
});

const parsed = (overrides: Record<string, unknown> = {}): InvitationOutput => {
  const rows = parseInvitationOutputs([payload(overrides)]);
  if (rows === null) throw new Error('the row under test must parse');
  return rows[0] as InvitationOutput;
};

describe('the manifest shape test', () => {
  it('reads one well-formed artefact into the panel’s own field names', () => {
    const rows = parseInvitationOutputs([payload()]);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    const first = rows?.[0] as InvitationOutput;
    expect(first.versionId).toBe(VERSION);
    expect(first.kind).toBe('qr');
    expect(first.contentDigest).toBe(DIGEST);
    expect(first.readyAt).toBe('2026-10-14T09:12:00.123456+00:00');
    expect(first.invalidationReason).toBeNull();
    expect(first.lastError).toBeNull();
    // The withheld columns stay withheld: nothing in the projection can hand the panel a path or a
    // target digest, so the parsed row must not carry one under any name.
    expect(JSON.stringify(first)).not.toContain('object_key');
    expect(JSON.stringify(first)).not.toContain('target_url_digest');
  });

  it('reads an empty manifest as an empty list, because that is what a wedding with nothing rendered answers', () => {
    // `internal_api.list_invitation_outputs` COALESCEs its aggregate to `'[]'` (`:571-573`), so the
    // panel's empty state is a real answer, not a missing one.
    expect(parseInvitationOutputs([])).toEqual([]);
  });

  it('treats an absent nullable as null rather than as a value to print', () => {
    const withoutOptionals = payload();
    delete withoutOptionals.content_digest;
    delete withoutOptionals.ready_at;
    delete withoutOptionals.last_error;
    const rows = parseInvitationOutputs([withoutOptionals]);
    expect(rows?.[0]?.contentDigest).toBeNull();
    expect(rows?.[0]?.readyAt).toBeNull();
    expect(rows?.[0]?.lastError).toBeNull();
  });

  // Every case below is a projection this build was not written against. All of them refuse the whole
  // read, so the difference between "no files" and "unreadable files" survives to the sentence the
  // host is handed.
  it.each([
    ['a non-array', { not: 'an array' }],
    ['a null body', null],
    ['an element that is not an object', ['qr']],
    ['a missing render_config_hash', [payload({ render_config_hash: undefined })]],
    ['a render_config_hash of the wrong length', [payload({ render_config_hash: 'abc' })]],
    ['a content_digest that is not 64 hex', [payload({ content_digest: 'zz'.repeat(32) })]],
    ['a row id that is not a uuid', [payload({ id: 'outputs/qr/25mm' })]],
    ['a version id that is not a uuid', [payload({ version_id: '1' })]],
    ['a page number below one', [payload({ page_number: 0 })]],
    ['a page number that is not a whole number', [payload({ page_number: 1.5 })]],
    ['a negative attempt count', [payload({ attempt_count: -1 })]],
    ['a status that is absent', [payload({ status: null })]],
    ['a storage domain that is absent', [payload({ storage_domain: undefined })]],
    ['a status that is a number', [payload({ status: 7 })]],
    ['a missing created_at', [payload({ created_at: null })]],
  ])('refuses the whole list for %s', (_name, value) => {
    expect(parseInvitationOutputs(value)).toBeNull();
  });

  it('ignores a column the projection has no business adding back', () => {
    // The read is a list of the fields this build knows; an element that also carries `object_key` is
    // still an artefact it can describe. What matters is that the parsed row holds no path, so a
    // future projection change cannot hand a signed address to the panel by accident.
    const rows = parseInvitationOutputs([payload({ object_key: `outputs/${WEDDING}/qr/25mm/${ROW}` })]);
    expect(rows).not.toBeNull();
    expect(Object.keys(rows?.[0] as InvitationOutput)).not.toContain('objectKey');
  });

  it('refuses a list in which only one element is unreadable', () => {
    expect(parseInvitationOutputs([payload(), payload({ format: 42 })])).toBeNull();
  });
});

describe('the delivery address', () => {
  it('spells the key the database mints', () => {
    expect(outputDeliveryPath(WEDDING, parsed())).toBe(`outputs/${WEDDING}/qr/25mm/${ROW}`);
    expect(outputDeliveryPath(WEDDING, parsed({ output_kind: 'pdf', variant: 'a4' })))
      .toBe(`outputs/${WEDDING}/pdf/a4/${ROW}`);
    expect(outputDeliveryPath(WEDDING, parsed({ output_kind: 'share_image', variant: '1080x1350' })))
      .toBe(`outputs/${WEDDING}/share_image/1080x1350/${ROW}`);
    expect(outputDeliveryPath(WEDDING, parsed({ output_kind: 'og_image', variant: '1200x630' })))
      .toBe(`outputs/${WEDDING}/og_image/1200x630/${ROW}`);
  });

  it('refuses a row in the published preview domain', () => {
    // That bucket has no read policy for a session and is reached by an opaque key alone (§8), so no
    // address is composed for it even in principle.
    expect(outputDeliveryPath(WEDDING, row({ storageDomain: 'published_preview', kind: 'og_image', variant: '1200x630' })))
      .toBeNull();
  });

  it('refuses a segment this build does not know instead of interpolating it', () => {
    // A path built from an unrecognised kind would be a guess about a future migration, and the only
    // thing it can sign is nothing — so it is not built.
    expect(outputDeliveryPath(WEDDING, row({ kind: 'video' }))).toBeNull();
    expect(outputDeliveryPath(WEDDING, row({ variant: '30mm' }))).toBeNull();
    expect(outputDeliveryPath(WEDDING, row({ kind: '../preview' }))).toBeNull();
    expect(outputDeliveryPath(WEDDING, row({ variant: '25mm/../../x' }))).toBeNull();
  });

  it('refuses an address it cannot compose safely', () => {
    expect(outputDeliveryPath('not-a-uuid', row())).toBeNull();
    expect(outputDeliveryPath('', row())).toBeNull();
    // The row id is the last segment, so an uppercase or unhyphenated one is not this table's id.
    expect(outputDeliveryPath(WEDDING, row({ id: ROW.toUpperCase() }))).toBeNull();
  });
});

describe('the words the panel prints', () => {
  it.each([
    ['og_image', 'Link preview image'],
    ['share_image', 'Share image'],
    ['pdf', 'Print-ready PDF'],
    ['qr', 'QR plate'],
  ] as const)('names the kind %s', (kind, expected) => {
    expect(kindWords(kind)).toBe(expected);
  });

  it.each([
    ['registered', 'Queued, nothing drawn yet'],
    ['uploading', 'Being drawn now'],
    ['invalidated', 'Retired'],
  ] as const)('names the state %s', (status, expected) => {
    expect(statusWords(status)).toBe(expected);
  });

  it('names the variant set the CHECK owns', () => {
    expect(variantWords('1080x2160')).toBe('1080 × 2160 tall');
    expect(variantWords('letter')).toBe('US Letter paper');
    expect(variantWords('60mm')).toBe('60 mm plate');
  });

  it.each([
    ['kind', kindWords],
    ['size', variantWords],
    ['state', statusWords],
    ['reason', reasonWords],
  ] as const)('prints an unknown %s as what it is', (kind, say) => {
    expect(say('tomorrow_value')).toBe(`this build has no word for the ${kind} “tomorrow_value”`);
  });

  it('reads a calendar day off a server stamp without moving it into a timezone', () => {
    expect(dayOf('2026-11-14T09:12:00.123456+00:00')).toBe('2026-11-14');
    expect(dayOf('not a day')).toBeNull();
    expect(dayOf(null)).toBeNull();
  });
});

describe('one line about one artefact', () => {
  it('gives a page of a PDF its page number and everything else none', () => {
    expect(outputSummary(row({ kind: 'pdf', variant: 'a4', format: 'pdf', pageNumber: 3 })))
      .toBe('Print-ready PDF · A4 paper · PDF · page 3');
    expect(outputSummary(row({ kind: 'pdf', variant: 'a4', format: 'pdf', pageNumber: 1 })))
      .toBe('Print-ready PDF · A4 paper · PDF');
    expect(outputSummary(row())).toBe('QR plate · 25 mm plate · PNG');
  });

  it('says the format in the letters a host reads on a file', () => {
    expect(outputSummary(row({ kind: 'og_image', variant: '1200x630', format: 'webp' })))
      .toBe('Link preview image · 1200 × 630 teaser · WEBP');
  });
});

describe('what may be opened', () => {
  it('offers only a ready row', () => {
    expect(isDeliverable(row())).toBe(true);
    for (const status of ['registered', 'uploading', 'failed', 'invalidated']) {
      expect(isDeliverable(row({ status }))).toBe(false);
    }
  });
});

describe('the reprint notices', () => {
  it('says nothing when there is nothing to say', () => {
    expect(reprintWarnings([])).toEqual([]);
    expect(reprintWarnings([row({ status: 'registered', contentDigest: null, readyAt: null })])).toEqual([]);
  });

  it('counts the plates retired by a rotation', () => {
    const notices = reprintWarnings([
      row({ status: 'invalidated', invalidationReason: 'token_rotated' }),
      row({ status: 'invalidated', invalidationReason: 'token_rotated', id: '00000000-0000-4000-8000-00000000000a' }),
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('2 QR plates were retired');
    expect(notices[0]).toContain('dead page');
  });

  it('counts one retirement in the singular', () => {
    const notices = reprintWarnings([row({ status: 'invalidated', invalidationReason: 'token_rotated' })]);
    expect(notices[0]).toContain('1 QR plate was retired');
  });

  it('names a take-down and a supersession apart from a rotation', () => {
    const revoked = reprintWarnings([row({ kind: 'pdf', variant: 'a4', format: 'pdf', status: 'invalidated', invalidationReason: 'publication_revoked' })]);
    expect(revoked[0]).toContain('taken down');
    const superseded = reprintWarnings([row({ kind: 'share_image', variant: '1080x1350', status: 'invalidated', invalidationReason: 'superseded' })]);
    expect(superseded[0]).toContain('an older version');
  });

  it('states the limit on what a stored plate can be vouched for', () => {
    const notices = reprintWarnings([row()]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('cannot');
    // The sentence must not read as a verification: the projection deliberately carries no
    // `target_url_digest`, so the panel can say a plate is a promise and cannot say it was kept.
    expect(notices[0]).toContain('print again');
    expect(notices.join(' ')).not.toMatch(/verified current|still matches the live/);
  });

  it('says nothing about a live plate that is not a plate', () => {
    const notices = reprintWarnings([row({ kind: 'og_image', variant: '1200x630' })]);
    expect(notices).toEqual([]);
  });

  it('does not promise that retiring a row happens when the host presses a button', () => {
    // §9.2 assigns manifest writes to the worker's privileged path; a notice may describe a row that
    // is recorded as retired, and must not claim the act of rotating deleted anything.
    const notices = reprintWarnings([
      row({ status: 'invalidated', invalidationReason: 'token_rotated' }),
      row({ status: 'ready' }),
    ]);
    expect(notices.join(' ')).not.toMatch(/files? (are|were) deleted automatically|we removed/);
  });
});
