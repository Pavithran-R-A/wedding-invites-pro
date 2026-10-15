// What the publication panel may and may not claim.
//
// The panel is the one place this build hands a host something that leaves their account,
// so its wording is the contract: an address shown once, no promise of delivery, and no
// control that pretends a retired link can come back. These assertions are mostly about
// text, which is deliberate — a claim here is a product claim to a customer.
//
// The freeze button adds one claim of its own, and it is the weaker kind: a button held back
// because the server's own findings say a version cannot be made. That is a courtesy, so the
// assertions here are that the reason is given, that it points at the server's list instead of
// restating it, and that the panel still says the database checks again. Nothing in this file
// pretends a disabled button is an enforcement.
//
// The retired-release case is the same shape with the halves swapped. No finding says it (the
// refusal is the gate at the version INSERT), so the panel has to carry the words itself — and
// those words promise two things the rest of the panel's buttons depend on: what is already
// frozen stays readable, and publishing it is still offered.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PublicationPanel from "@/components/invitation/PublicationPanel";
import type {
  PublicationState,
  SelectedReleaseSummary,
} from "@/integrations/supabase/publication";

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

/** The release behind the document, retired since. `isCurrent` is the server's `status =
 *  'approved'` answered as a present-tense fact; the panel is shown the whole summary because
 *  naming the release is itself something §21 asks a host to be able to inspect. */
const RETIRED_RELEASE: SelectedReleaseSummary = {
  packKey: 'test-reviewed-fixture',
  displayName: 'TEST ONLY — Synthetic Reviewed Fixture',
  releaseNumber: 1,
  definitionSchemaVersion: 2,
  isCurrent: false,
};

const renderPanel = (props: Partial<React.ComponentProps<typeof PublicationPanel>> = {}) =>
  render(
    <PublicationPanel
      shareUrl={null}
      state={null}
      versions={versions}
      languageChosen
      serverBlocking={false}
      retiredRelease={null}
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

  it("holds the freeze button back while the server has a blocking finding, and names where the finding is", () => {
    renderPanel({ serverBlocking: true });
    expect(screen.getByRole('button', { name: /Freeze this draft/ })).toBeDisabled();
    // A disabled button with no reason reads as a broken page. The reason points at the panel
    // that carries the server's own words rather than repeating a finding this component does
    // not know, and it says plainly that the database is the one that decides.
    expect(
      screen.getByText(/What the server says stands between this and a version/),
    ).toBeInTheDocument();
    expect(screen.getByText(/makes the same checks again/)).toBeInTheDocument();
  });

  it("says nothing about blocking findings when the server has none", () => {
    const { container } = renderPanel();
    expect(container.textContent).not.toMatch(/stands between this and a version/);
    expect(screen.getByRole('button', { name: /Freeze this draft/ })).toBeEnabled();
  });

  it("gives the language reason ahead of the finding reason, because one is a precondition for the other", () => {
    renderPanel({ languageChosen: false, serverBlocking: true });
    expect(screen.getByText(/Choose the invitation language/)).toBeInTheDocument();
    expect(screen.queryByText(/stands between this and a version/)).toBeNull();
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

describe("an invitation standing on a retired release", () => {
  it("names the older release it uses, and says plainly what does not change", () => {
    renderPanel({ state: LIVE, retiredRelease: RETIRED_RELEASE });
    expect(
      screen.getByText(/This invitation uses an older release of TEST ONLY — Synthetic Reviewed Fixture — release 1/),
    ).toBeInTheDocument();
    // §21's own requirement: the promise has to be in the copy, because a host told their pack is
    // out of date will otherwise read it as "the page my guests are looking at is about to
    // change". Nothing here changes: the frozen versions and the live link both stay.
    expect(screen.getByText(/keep showing exactly what they show now/)).toBeInTheDocument();
    expect(screen.getByText(/A new version cannot be frozen from this release/)).toBeInTheDocument();
    expect(screen.getByText(/A link is live/)).toBeInTheDocument();
  });

  it("holds the freeze button back and says the release is why", () => {
    renderPanel({ retiredRelease: RETIRED_RELEASE });
    expect(screen.getByRole('button', { name: /Freeze this draft/ })).toBeDisabled();
    expect(
      screen.getByText(/Not while your invitation stands on that older release/),
    ).toBeInTheDocument();
    // The same non-enforcement the finding reason carries: the button is a courtesy, and the
    // version gate at the database is the rule.
    expect(screen.getByText(/freeze call refuses it on the server/)).toBeInTheDocument();
  });

  it("still publishes a version frozen earlier, because retirement does not reach behind itself", () => {
    const onPublish = vi.fn();
    renderPanel({ state: LIVE, retiredRelease: RETIRED_RELEASE, onPublish });
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeEnabled();
    publish.click();
    expect(onPublish).toHaveBeenCalledWith('v2');
    // Re-pointing an existing link at an already frozen version writes no new content from the
    // retired release, so the panel would be wrong to withhold it — and a host holding a live
    // link needs the rotation that keeps their guests' address working.
    expect(screen.getByRole('button', { name: 'New link, same version' })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Version 1/ })).toBeInTheDocument();
  });

  it("says no word about an older release when the server answered a current one", () => {
    const { container } = renderPanel({ state: LIVE });
    expect(container.textContent).not.toMatch(/older release/);
    expect(screen.getByRole('button', { name: /Freeze this draft/ })).toBeEnabled();
  });

  it("keeps the lifecycle vocabulary on the server's side of the wire", () => {
    const { container } = renderPanel({ state: LIVE, retiredRelease: RETIRED_RELEASE });
    // `deprecated` is the column's word, and `status_is_current` the JSON key it came from. A
    // host reading either has been shown a schema rather than an invitation.
    expect(container.textContent).not.toMatch(/deprecated|status_is_current|release_id|isCurrent/);
  });
});

// Stage 9's two additions to this panel, tested where the affordance lives rather than in
// `shareQrPlate.test.tsx`: when the plate is offered at all, and what the panel says about paper.
describe("the QR plate a host can scan", () => {
  const LOCAL = 'http://localhost:5173/i/abcdefghijabcdefghijabcdefghijabcdefghijabcde';

  it("offers a plate only in the session that is holding the address", () => {
    renderPanel({ state: LIVE });
    // No address on screen means nothing to encode, so the control is absent rather than a button
    // that would answer "there is no address" — §9.1's rule that a plate cannot be re-minted from
    // the store, which keeps only a digest.
    expect(screen.queryByRole('button', { name: /QR plate/i })).toBeNull();

    renderPanel({ state: LIVE, shareUrl: LOCAL });
    expect(screen.getByRole('button', { name: 'Show a QR plate to scan' })).toBeEnabled();
    expect(screen.getByText(/A plate is drawn only while this page still holds the address/)).toBeInTheDocument();
  });

  it("loads the plate on the host's press and refuses to draw one for a local address, in words", async () => {
    const { container } = renderPanel({ state: LIVE, shareUrl: LOCAL });
    fireEvent.click(screen.getByRole('button', { name: 'Show a QR plate to scan' }));
    // The encoder is a lazily loaded chunk, so the answer arrives asynchronously. What must not
    // arrive is a square of modules: §9.3 refuses a `http` origin outright, and the local run has
    // to see the reason rather than a plate that would scan on this machine and nowhere else.
    expect(await screen.findByText(/not an https one/)).toBeInTheDocument();
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide the QR plate' })).toHaveAttribute('aria-expanded', 'true');
  });

  it("warns about printed paper beside the two buttons that end an address, and claims nothing else", () => {
    const { container } = renderPanel({ state: LIVE });
    expect(screen.getByText(/If you have printed this QR, reprint it from the new address/)).toBeInTheDocument();
    // Where the recorded files are described, named so a host can find them — and the honest limit:
    // no code in this build retires a manifest row when a token turns over, so the panel says what
    // it cannot do instead of promising the files go away.
    expect(container.textContent).toContain('Files made from your invitation');
    expect(container.textContent).toContain('nothing on this page can withdraw a sheet that left the room');
    expect(container.textContent).not.toMatch(/will be deleted|are retired when you (rotate|take)/i);
  });

  it("says nothing about reprinting while there is no live address to reprint from", () => {
    const { container } = renderPanel({ state: RENDERED });
    expect(container.textContent).not.toMatch(/If you have printed this QR/);
  });
});
