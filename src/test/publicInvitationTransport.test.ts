// The guest's transport: one function, one header, no session, and one answer to every
// question the visitor might be asking.
//
// The database half of this is qualified over real HTTP in supabase/tests/api/. What this
// file pins is the browser half — that the credential never enters a URL (where it would
// land in access logs, history and `Referer` headers), that a guest's visit stores
// nothing, and that a malformed link, a refused link and a link whose answer arrived in an
// unexpected shape all reach the page as the same sentence.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ schema: () => ({ rpc }) })));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { INVITATION_UNAVAILABLE, resolvePublicInvitation } from "@/integrations/supabase/publicInvitation";
import { guestPayload } from "@/test/invitationFixture";

/** 41 characters plus the two the alphabet of a minted credential allows: 43 in all,
 *  which is what `private.mint_public_invitation_token` writes. */
const TOKEN = `${'a'.repeat(41)}_-`;

let warnSpy: MockInstance;

type ClientOptions = {
  global: { headers: Record<string, string> };
  auth: Record<string, unknown>;
};

const optionsOf = () => createClient.mock.calls[0][2] as ClientOptions;

beforeEach(() => {
  rpc.mockReset();
  createClient.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe("a credential that cannot possibly match", () => {
  const hopeless = [
    '',
    'short',
    TOKEN.slice(0, 42),
    `${TOKEN}extra`,
    'has spaces and symbols !@#',
    '../../../../etc/passwd',
  ];

  it("is refused without leaving the page", async () => {
    for (const token of hopeless) {
      expect(await resolvePublicInvitation(token)).toEqual({ data: null, error: INVITATION_UNAVAILABLE });
    }
    // One RPC is the whole public surface; a string that cannot match earns no request.
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("a well-shaped credential", () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: guestPayload(), error: null });
  });

  it("travels in a header, not in a URL or an argument", async () => {
    await resolvePublicInvitation(TOKEN);
    expect(optionsOf().global.headers).toEqual({ 'x-invitation-token': TOKEN });
    expect(rpc).toHaveBeenCalledWith('resolve_public_invitation');

    const [url, key] = createClient.mock.calls[0];
    expect(`${url}`).not.toContain(TOKEN);
    expect(`${key}`).not.toContain(TOKEN);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
  });

  it("builds a client that stores nothing", async () => {
    await resolvePublicInvitation(TOKEN);
    expect(optionsOf().auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it("hands the page the parsed invitation", async () => {
    const result = await resolvePublicInvitation(TOKEN);
    expect(result.error).toBeNull();
    expect(result.data?.title).toBe('Arun weds Deepa');
    expect(result.data?.events[0]?.venue?.mapUrl).toBe('https://maps.example/sri-kanchi-mahal');
  });
});

describe("every way a read can fail", () => {
  it("answers with the same sentence and keeps none of the server's words", async () => {
    const failures: Array<{ data?: unknown; error?: unknown }> = [
      { error: { code: '42501', message: 'permission denied for schema private', hint: 'granted to nobody' } },
      { error: { code: 'PGRST202', message: 'Could not find the function api.resolve_public_invitation' } },
      { data: { available: false } },
      { data: null },
      { data: { available: true, invitation: { title: 42 } } },
      { data: '<html>an invitation</html>' },
    ];

    for (const response of failures) {
      rpc.mockResolvedValueOnce(response);
      expect(await resolvePublicInvitation(TOKEN)).toEqual({ data: null, error: INVITATION_UNAVAILABLE });
    }

    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('permission denied for schema private');
    expect(logged).not.toContain('granted to nobody');
    expect(logged).toContain('42501');
  });
});
