// What the publication panel may and may not claim.
//
// The panel is the one place this build hands a host something that leaves their account,
// so its wording is the contract: an address shown once, no promise of delivery, and no
// control that pretends a retired link can come back. These assertions are mostly about
// text, which is deliberate — a claim here is a product claim to a customer.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PublicationPanel from "@/components/invitation/PublicationPanel";
import type { PublicationState } from "@/integrations/supabase/publication";

const LIVE: PublicationState = {
  versionNumber: 2,
  publishedAt: '2026-09-20T09:12:00.123456+00:00',
  linkActive: true,
  linkExpiresAt: null,
};

const RENDERED: PublicationState = { ...LIVE, linkActive: false };

const EXPARED = { ...RENDERED, linkExpiresAt: '2020-01-01T00:00:00+00:00' };

const versions = [
  { id: 'v2', versionNumber: 2, createdAt: '2026-09-19T00:00:00+00:00' },
  { id: 'v1', versionNumber: 1, createdAt: '2026-09-18T00:00:00+00:00' },
];

const renderPanel = (props: Partial<React.ComponentProps<typeof PublicationPanel>> = {}) =>
  render(
    <PublicationPanel
      shareUrl={null}
      state={null}
      versions={versions}
      languageChosen
      busy={false}
      message={null}
      notice={null}
      onCreateVersion={vi.fn()}
      onPublish={vi.fn()}
      onRotate={vi.fn()}
      onRevoke={vi.fn()}
      {...props}
    />,
  );

describe("the publication panel", () => {
  it("says an invitation has not been published, rather than showing an empty link box", () => {
    renderPanel();
    expect(screen.getByText('This invitation has not been published yet.')).toBeInTheDocument();
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
  });

  it("names the version a live link is showing, and when it went out", () => {
    renderPanel({ state: LIVE });
    expect(screen.getByText('A link is live')).toBeInTheDocument();
    expect(screen.getByText(/showing version 2/)).toBeInTheDocument();
    // The date is read from the server's own stamp, not shifted into the browser's day.
    expect(screen.getByText(/since 2026-09-20/)).toBeInTheDocument();
  });

  it("distinguishes an expired link from a taken-down one", () => {
    renderPanel({ state: EXPARED });
    expect(screen.getByText('The link has expired')).toBeInTheDocument();
  });

  it("names a link the host took down as taken down", () => {
    renderPanel({ state: RENDERED });
    expect(screen.getByText('The link was taken down')).toBeInTheDocument();
  });

  it("shows the address only in the session that was handed it", () => {
    renderPanel({ state: LIVE, shareUrl: 'http://localhost:5173/i/abcdefghijabcdefghijabcdefghijabcdefghijabcde' });
    expect(screen.getByText(/It is shown once/)).toBeInTheDocument();
    expect(screen.getByText(/^http:\/\/localhost:5173\/i\//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it("explains a live address it can no longer show, and offers a new one", () => {
    renderPanel({ state: LIVE });
    expect(screen.getByText(/A live address cannot be shown again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New link, same version' })).toBeEnabled();
  });

  it("never claims a message was sent", () => {
    const { container } = renderPanel({ state: LIVE, shareUrl: 'http://localhost:5173/i/x' });
    const text = container.textContent ?? '';
    // There is no delivery in this build: no message, no invite, no read receipt. So the
    // panel offers a clipboard, a share sheet and a chat link — and no verb implying it
    // reached anyone.
    expect(screen.queryByRole('button', { name: /send|deliver|notify|invite/i })).toBeNull();
    expect(text).toContain('Nothing has been sent.');
  });

  it("will not freeze or publish while the invitation has no language", () => {
    renderPanel({ languageChosen: false });
    expect(screen.getByRole('button', { name: /Freeze this draft/ })).toBeDisabled();
    expect(screen.getByText(/Choose the invitation language/)).toBeInTheDocument();
  });

  it("freezes before it publishes, and publishes a version it can name", () => {
    const onPublish = vi.fn();
    renderPanel({ onPublish });
    screen.getByRole('button', { name: 'Publish' }).click();
    // The newest frozen version is the one offered, and it is named on the control.
    expect(onPublish).toHaveBeenCalledWith('v2');
    expect(screen.getByRole('option', { name: /Version 2/ })).toBeInTheDocument();
  });

  it("takes no publication action while a call is in flight", () => {
    renderPanel({ state: LIVE, busy: true });
    expect(screen.getByRole('button', { name: 'New link, same version' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take the link down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Freeze this draft/ })).toBeDisabled();
  });

  it("shows a failure as the adapter's phrase, in a live region", () => {
    renderPanel({ notice: 'the link could not be published' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('the link could not be published');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it("says what just happened as well as what went wrong", () => {
    renderPanel({
      message: 'Version 2 is frozen. It cannot be edited.',
      notice: 'the link could not be published',
    });
    const statuses = screen.getAllByRole('status');
    const spoken = statuses.map(node => node.textContent);
    expect(spoken).toContain('Version 2 is frozen. It cannot be edited.');
    expect(spoken).toContain('the link could not be published');
    // Two sentences, one per question they answer — a merged line would leave the host
    // guessing whether the failure happened before or after the freeze.
    expect(statuses).toHaveLength(2);
  });

  it("links to WhatsApp with the address as text, and nothing else", () => {
    renderPanel({ shareUrl: 'http://localhost:5173/i/abcdefghijabcdefghijabcdefghijabcdefghijabcde' });
    const link = screen.getByRole('link', { name: 'Open in WhatsApp' });
    expect(link.getAttribute('href')).toBe(
      'https://wa.me/?text=http%3A%2F%2Flocalhost%3A5173%2Fi%2Fabcdefghijabcdefghijabcdefghijabcdefghijabcde',
    );
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
