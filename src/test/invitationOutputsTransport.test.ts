// The host's two calls to Stage 9's substrate: one named function for the manifest, one Storage call
// for one object, and nothing else.
//
// Four claims hold this file together.
//
//   * **The manifest is read through `api.list_invitation_outputs`, never from the table.** The table
//     does have a `GRANT SELECT` and an owner-read policy
//     (`supabase/migrations/20261013120000_stage9_render_outputs.sql:439,445-448`), so a direct
//     `from('invitation_outputs')` would succeed — and it would read `object_key`, the column the
//     projection withholds on purpose (`:550-554`). The mock below therefore has no working `from`:
//     a table read is not merely disfavoured, it fails the test loudly.
//   * **Delivery is Storage's signed URL with the TTL Stage 6 measured.** §8 promises the private
//     domain "one delivery mechanism", so the arguments are pinned as they are signed: the bucket
//     named once, the composed path, and 60 seconds. `weddingAssets.ts:217-222` is the precedent this
//     reuses, including the number.
//   * **A row the client cannot address makes no call at all.** A published-preview row has no read
//     policy in this build and an unknown kind or variant is not a box the renderer offers, so the
//     adapter answers with a sentence and Storage is never asked. Asserting the absence of the call
//     is the point: a signed request against a guessed path is a request.
//   * **A refusal is a phrase, not a schema dump.** PostgREST's `message`/`details`/`hint` name
//     constraints and policies, so they go to `console.warn` through `describe()` and the caller gets
//     one of four fixed sentences. A test that asserted the adapter returned the database's prose
//     would be testing a leak.
//
// Whether Postgres and Storage answer at all is qualified by `supabase/tests/stage9/` and the Stage 9
// browser tier; nothing here claims to prove a policy.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const schema = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn());
const createSignedUrl = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn(() => {
  throw new Error('the manifest is read through api.list_invitation_outputs, never from the table');
}));

schema.mockReturnValue({ rpc });
storageFrom.mockReturnValue({ createSignedUrl });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { schema, storage: { from: storageFrom }, from },
}));

import {
  listInvitationOutputs,
  signedOutputUrl,
  OUTPUT_LINK_SECONDS,
} from "@/integrations/supabase/invitationOutputs";
import type { InvitationOutput } from "@/lib/invitationOutputs";

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const VERSION = '4a2b6c10-0000-4000-8000-000000000002';
const ROW = '9e3d5a70-0000-4000-8000-000000000003';
const OTHER_ROW = '9e3d5a70-0000-4000-8000-000000000009';
const CONFIG = 'a'.repeat(64);
const DIGEST = 'b'.repeat(64);

const element = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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

const refusal = (code: string) => ({ data: null, error: { message: 'private.some_policy names this', details: 'column object_key', hint: 'x', code } });

let warnSpy: MockInstance;

beforeEach(() => {
  schema.mockClear();
  rpc.mockReset();
  storageFrom.mockClear();
  createSignedUrl.mockReset();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('reading the manifest', () => {
  it('names the api schema and the one function, with only the wedding id as an argument', async () => {
    rpc.mockResolvedValue({ data: [element()], error: null });
    const result = await listInvitationOutputs(WEDDING);

    expect(schema).toHaveBeenCalledWith('api');
    expect(rpc).toHaveBeenCalledWith('list_invitation_outputs', { p_wedding_id: WEDDING });
    // Nothing about a caller's session, a bucket or a key travels into the read: the database derives
    // the owner from the JWT and the function's own membership check does the refusing.
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_wedding_id: WEDDING });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.storageDomain).toBe('host_private');
  });

  it('leaves the server’s order alone', async () => {
    // The RPC's ORDER BY is `output_kind, variant, format, page_number, created_at, id`
    // (`:572`). A client-side sort would make the panel's order a second claim about a fact the
    // server already decided, so the array arrives in the shape it was answered in.
    rpc.mockResolvedValue({
      data: [element({ output_kind: 'share_image', variant: '1080x2160', id: OTHER_ROW }), element()],
      error: null,
    });
    const result = await listInvitationOutputs(WEDDING);
    expect(result.data?.map(r => r.id)).toEqual([OTHER_ROW, ROW]);
  });

  it('answers an empty manifest with an empty list, which is a different sentence from a failure', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const result = await listInvitationOutputs(WEDDING);
    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a grant or RLS refusal', refusal('42501')],
    ['a function the surface does not expose', refusal('PGRST202')],
    ['a projection this build cannot read', { data: [{ id: 'not-a-uuid' }], error: null }],
    ['a body that is not a list', { data: null, error: null }],
  ])('turns %s into one fixed phrase and keeps the database’s prose off both channels', async (_name, response) => {
    rpc.mockResolvedValue(response);
    const result = await listInvitationOutputs(WEDDING);
    expect(result.data).toBeNull();
    expect(result.error).toBe('the list of files could not be read');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The log line is the maintainer's channel and still carries no schema prose: `describe()` keeps
    // the category and the code and drops `message`, `details` and `hint`.
    expect(warnSpy.mock.calls[0]?.[0]).toContain('the list of files could not be read');
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain('some_policy');
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain('column object_key');
  });

  it('never reads the table itself', async () => {
    // `from()` throws in this mock, so the assertion below is not the proof — the absence of a throw
    // is. A second read path would be a second policy to audit and would carry `object_key`.
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(listInvitationOutputs(WEDDING)).resolves.toEqual({ data: [], error: null });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('opening one artefact', () => {
  it('signs the composed path in the private bucket for the TTL Stage 6 measured', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.invalid/signed?token=x' }, error: null });
    const result = await signedOutputUrl(WEDDING, row());

    expect(storageFrom).toHaveBeenCalledWith('invitation-outputs');
    expect(createSignedUrl).toHaveBeenCalledWith(`outputs/${WEDDING}/qr/25mm/${ROW}`, 60);
    expect(result.data).toBe('https://storage.invalid/signed?token=x');
    expect(result.error).toBeNull();
  });

  it('publishes the same number of seconds the panel reads out', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.invalid/signed?token=x' }, error: null });
    await signedOutputUrl(WEDDING, row());
    expect(createSignedUrl.mock.calls[0]?.[1]).toBe(OUTPUT_LINK_SECONDS);
  });

  it('signs a different box at the path that box is kept at', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.invalid/signed' }, error: null });
    await signedOutputUrl(WEDDING, row({ kind: 'pdf', variant: 'a4', format: 'pdf' }));
    expect(createSignedUrl.mock.calls[0]?.[0]).toBe(`outputs/${WEDDING}/pdf/a4/${ROW}`);
  });

  it('asks Storage nothing for a published-preview row and says why', async () => {
    const result = await signedOutputUrl(WEDDING, row({ storageDomain: 'published_preview' }));
    expect(storageFrom).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error).toBe('this file belongs to the published preview, which no session can download');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('asks Storage nothing for a row whose kind or size this build does not know', async () => {
    for (const bad of [row({ kind: 'video' }), row({ variant: '30mm' }), row({ id: ROW.toUpperCase() })]) {
      const result = await signedOutputUrl(WEDDING, bad);
      expect(result.error).toBe('this build cannot work out where this file is kept');
    }
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('reports a Storage refusal in the host’s words, not the policy’s', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } });
    const result = await signedOutputUrl(WEDDING, row());
    expect(result.data).toBeNull();
    expect(result.error).toBe('the file could not be opened');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain('row-level security');
  });

  it('treats a signed answer that carries no address as the same failure', async () => {
    createSignedUrl.mockResolvedValue({ data: {}, error: null });
    const result = await signedOutputUrl(WEDDING, row());
    expect(result).toEqual({ data: null, error: 'the file could not be opened' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
