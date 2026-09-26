// The guest's page: `/i/<credential>`, with no account anywhere in it.
//
// Three things this page exists to get right:
//   * It reads through one function and one only — `resolvePublicInvitation`, which is
//     the app's sole caller of `api.resolve_public_invitation`. There is no session to
//     check, no dashboard link, no "sign in to see more", and no second request that
//     could turn a guest into a visitor with a login prompt on the family's front door.
//   * Every failure is the same sentence. A mistyped address, a link the host took
//     down, an expiry that passed and a string that is not a credential at all all read
//     identically, because the database answers them identically and a guest has no way
//     to tell which happened either. Nothing here offers a way to "request access" —
//     that would be inventing a workflow the host never asked for.
//   * It renders the same component the host previews through. If a guest could see a
//     better document than the host was shown, the host would be promising something
//     they had never seen.
//
// The credential arrives as a route parameter, which the browser resolves locally
// against the SPA shell; the API request that follows carries it in a header, never in a
// query string (`src/integrations/supabase/publicInvitation.ts` explains why that
// distinction is the point).

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InvitationRenderer from '@/components/invitation/InvitationRenderer';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { resolvePublicInvitation } from '@/integrations/supabase/publicInvitation';
import type { PublicInvitation } from '@/lib/publicInvitation';

type Phase =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; invitation: PublicInvitation };

const Unavailable = () => (
  <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-16 text-center">
    <BrandLockup variant="compact" className="mb-8" />
    <h1 className="font-display text-2xl font-semibold text-ink">
      This invitation is not available
    </h1>
    <p className="mt-3 text-ink-muted">
      The link may have been retired by the family, it may have expired, or a character
      may have been missed when it was typed. Only the family can share a working link.
    </p>
    <p className="mt-6 text-sm text-ink-muted">
      No account is needed to read a wedding invitation. Nothing was signed in, and no
      account was created, to show you this page.
    </p>
  </main>
);

const PublicInvitationPage = () => {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    // A missing parameter is the `/i/` route with nothing after it. Refuse it here
    // rather than letting an empty string reach the resolver, whose own shape test would
    // answer the same way but after a round trip.
    if (!token) {
      setPhase({ kind: 'unavailable' });
      return;
    }
    let active = true;
    resolvePublicInvitation(token).then(result => {
      if (!active) return;
      setPhase(result.data ? { kind: 'ready', invitation: result.data } : { kind: 'unavailable' });
    });
    return () => {
      active = false;
    };
  }, [token]);

  // The tab is what a guest with six links open is scanning, so the family's names
  // belong there once they are known. Plain text, no token, no product tagline.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    // The title this page replaces belongs to whatever the guest came from. Restating a
    // hardcoded product title here would put a second owner on a string the shell
    // already owns, and would go stale the moment that string changed.
    const previous = document.title;
    document.title = `${phase.invitation.title} — wedding invitation`;
    return () => {
      document.title = previous;
    };
  }, [phase]);

  if (phase.kind === 'loading') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
        <p role="status" className="animate-pulse text-ink-muted">
          Opening the invitation…
        </p>
      </main>
    );
  }

  if (phase.kind === 'unavailable') return <Unavailable />;

  return (
    <main className="min-h-dvh bg-surface px-4 py-8 sm:py-12">
      <InvitationRenderer invitation={phase.invitation} />
      <p className="mx-auto mt-6 max-w-[34rem] text-center text-xs text-ink-muted">
        No account or app is needed to read this invitation.
      </p>
    </main>
  );
};

export default PublicInvitationPage;
