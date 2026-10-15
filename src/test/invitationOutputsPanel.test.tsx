// The host's files screen, tested against the four facts its own header says shapes it: nothing here
// makes a file, only a `ready` row has bytes behind it, delivery is a 60-second address minted on
// press, and the panel cannot tell a live plate from a stale one.
//
// Most of this file is about what the screen is allowed to print, for the same reason Stage 8's panel
// was: a host deciding what to hand to a photographer is deciding from these sentences. So the
// assertions cover the vocabulary boundary (a kind or state from a future migration is shown as an
// unknown word, never as a guessed one), the affordance boundary (a control appears exactly where
// pressing it can work), and the leak boundary (a digest is shortened, a signed address is never
// composed into visible text, and the object path this build derives stays off the screen).
//
// jsdom lays nothing out, so no tap target or contrast claim is made here; those are the Stage 9
// browser tier's, along with the one statement this file cannot make — that Storage signs a real
// artefact at the derived path.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import InvitationOutputsPanel from "@/components/invitation/InvitationOutputsPanel";
import type { InvitationOutput } from "@/lib/invitationOutputs";

const api = vi.hoisted(() => ({ list: vi.fn(), sign: vi.fn() }));

vi.mock("@/integrations/supabase/invitationOutputs", () => ({
  listInvitationOutputs: (...args: unknown[]) => api.list(...args),
  signedOutputUrl: (...args: unknown[]) => api.sign(...args),
  OUTPUT_LINK_SECONDS: 60,
}));

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const VERSION = '4a2b6c10-0000-4000-8000-000000000002';
const QR_ROW = '9e3d5a70-0000-4000-8000-000000000003';
const SECOND_QR = '9e3d5a70-0000-4000-8000-000000000005';
const PDF_ROW = '9e3d5a70-0000-4000-8000-000000000004';
const CONFIG = 'a'.repeat(64);
const DIGEST = 'b'.repeat(64);

const row = (overrides: Partial<InvitationOutput> = {}): InvitationOutput => ({
  id: QR_ROW,
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

const list = (rows: InvitationOutput[]) => ({ data: rows, error: null });

const render_ = (refreshKey = 0) =>
  render(<InvitationOutputsPanel weddingId={WEDDING} refreshKey={refreshKey} />);

beforeEach(() => {
  api.list.mockReset();
  api.sign.mockReset();
});

describe('listing what was rendered', () => {
  it('reads the manifest for this wedding and lists each artefact in the server’s words', async () => {
    api.list.mockResolvedValue(list([
      row(),
      row({ id: PDF_ROW, kind: 'pdf', variant: 'a4', format: 'pdf', pageNumber: 2 }),
    ]));
    const { container } = render_();

    await waitFor(() => expect(screen.queryByText(/files are recorded for this wedding/)).not.toBeNull());
    expect(api.list).toHaveBeenCalledWith(WEDDING);

    const summary = screen.getByText(/2 files are recorded for this wedding/);
    expect(summary.textContent).toContain('2 of them openable right now');

    expect(within(container as HTMLElement).getByText('QR plate · 25 mm plate · PNG')).toBeDefined();
    expect(screen.getByText('Print-ready PDF · A4 paper · PDF · page 2')).toBeDefined();
    expect(screen.getByText('QR plates')).toBeDefined();
    expect(screen.getByText('Print-ready PDF')).toBeDefined();
    // One made-day line per `ready` row, not one per panel: both artefacts were drawn on the same day
    // the fixture stamps, and a host reading a two-row list needs to see which row says when.
    expect(within(container as HTMLElement).getAllByText(/Made 2026-10-14/)).toHaveLength(2);
  });

  it('prints the fingerprint shortened, and never the address it derived', async () => {
    api.list.mockResolvedValue(list([row()]));
    const { container } = render_();
    await waitFor(() => expect(container.textContent).toContain('File fingerprint'));

    expect(container.textContent).toContain(DIGEST.slice(0, 12));
    expect(container.textContent).not.toContain(DIGEST);
    // The composed object path is an internal identifier, not something to read out: printing it would
    // invite a host to copy a path that only works inside a signed address.
    expect(container.textContent).not.toContain('outputs/');
    expect(container.textContent).not.toContain(CONFIG);
  });

  it('says the worker makes these files and this page cannot start one', async () => {
    api.list.mockResolvedValue(list([]));
    render_();
    await waitFor(() => expect(screen.queryByText(/Nothing has been rendered/)).not.toBeNull());
    expect(screen.getByText(/render worker/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Get a temporary link' })).toBeNull();
  });

  it('keeps a row whose kind or state this build does not know visible as an unknown word', async () => {
    api.list.mockResolvedValue(list([
      row({ kind: 'video', variant: '60mm' }),
      row({ id: PDF_ROW, status: 'queued' }),
    ]));
    const { container } = render_();
    await waitFor(() => expect(container.textContent).toContain('this build has no word for the kind “video”'));

    expect(container.textContent).toContain('this build has no word for the state “queued”');
    // An unrecognised kind is not silently dropped from the count, and it gets no affordance: there is
    // no box the renderer offers for it, so there is no path to sign.
    expect(container.textContent).toContain('2 files are recorded');
    expect(screen.queryByRole('button', { name: 'Get a temporary link' })).toBeNull();
  });

  it('names why a retired artefact was retired', async () => {
    api.list.mockResolvedValue(list([
      row({ status: 'invalidated', invalidationReason: 'token_rotated' }),
    ]));
    const { container } = render_();
    await waitFor(() => expect(container.textContent).toContain('Retired — the address it points at was rotated away'));

    expect(container.textContent).not.toContain('Open the file');
    expect(screen.queryByRole('button', { name: 'Get a temporary link' })).toBeNull();
  });

  it('keeps the worker’s own sentence about a failed artefact', async () => {
    api.list.mockResolvedValue(list([
      row({ status: 'failed', contentDigest: null, readyAt: null, attemptCount: 3, lastError: 'the browser did not answer' }),
    ]));
    const { container } = render_();
    await waitFor(() => expect(container.textContent).toContain('Failed after 3 attempts'));
    expect(container.textContent).toContain('The worker said: the browser did not answer');
  });

  it('describes a queue without pretending it is a file', async () => {
    api.list.mockResolvedValue(list([
      row({ status: 'registered', contentDigest: null, readyAt: null }),
      row({ id: PDF_ROW, status: 'uploading', contentDigest: null, readyAt: null }),
    ]));
    const { container } = render_();
    await waitFor(() => expect(container.textContent).toContain('Queued for the worker'));
    expect(container.textContent).toContain('Being drawn now');
    expect(container.textContent).toContain('0 of them openable right now');
  });
});

describe('re-reading', () => {
  it('refuses to answer with nothing when the read fails, and offers the same question again', async () => {
    api.list.mockResolvedValue({ data: null, error: 'the list of files could not be read' });
    render_();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('the list of files could not be read');

    api.list.mockResolvedValue(list([row()]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('QR plate · 25 mm plate · PNG')).not.toBeNull());
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('keeps the last list on screen when a refresh fails', async () => {
    api.list.mockResolvedValue(list([row()]));
    render_();
    await waitFor(() => expect(screen.queryByText('QR plate · 25 mm plate · PNG')).not.toBeNull());

    api.list.mockResolvedValue({ data: null, error: 'the list of files could not be read' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.getByText('QR plate · 25 mm plate · PNG')).toBeDefined();
  });

  it('re-reads when the page says the invitation moved', async () => {
    api.list.mockResolvedValue(list([]));
    const { rerender } = render(<InvitationOutputsPanel weddingId={WEDDING} refreshKey={0} />);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    rerender(<InvitationOutputsPanel weddingId={WEDDING} refreshKey={1} />);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('drops a minted address on a re-read rather than keeping it on screen', async () => {
    api.list.mockResolvedValue(list([row()]));
    api.sign.mockResolvedValue({ data: 'https://storage.invalid/signed?token=abc', error: null });
    render_();
    await screen.findByRole('button', { name: 'Get a temporary link' });
    fireEvent.click(screen.getByRole('button', { name: 'Get a temporary link' }));
    await waitFor(() => expect(screen.queryByText('Open the file')).not.toBeNull());

    api.list.mockResolvedValue(list([row()]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Get a temporary link' })).not.toBeNull());
    expect(screen.queryByText('Open the file')).toBeNull();
  });
});

describe('opening one file', () => {
  it('asks for the address only when the host presses, and hands back exactly that', async () => {
    api.list.mockResolvedValue(list([row()]));
    render_();
    await screen.findByRole('button', { name: 'Get a temporary link' });
    expect(api.sign).not.toHaveBeenCalled();

    api.sign.mockResolvedValue({ data: 'https://storage.invalid/signed?token=abc', error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Get a temporary link' }));

    await waitFor(() => expect(screen.queryByText('Open the file')).not.toBeNull());
    expect(api.sign).toHaveBeenCalledWith(WEDDING, expect.objectContaining({ id: QR_ROW }));
    const anchor = screen.getByText('Open the file').closest('a');
    expect(anchor?.getAttribute('href')).toBe('https://storage.invalid/signed?token=abc');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/Works for 60 seconds/)).toBeDefined();
  });

  it('prints the adapter’s reason when Storage says no', async () => {
    api.list.mockResolvedValue(list([row()]));
    api.sign.mockResolvedValue({ data: null, error: 'the file could not be opened' });
    render_();
    fireEvent.click(await screen.findByRole('button', { name: 'Get a temporary link' }));
    // By then the panel has two live regions — the reprint notice this manifest earns and the refusal —
    // so the assertion names the sentence it means instead of taking whichever appeared first.
    const message = await screen.findByText('the file could not be opened');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByText('Open the file')).toBeNull();
  });

  it('offers nothing to press for a published-preview file, and says who does reach it', async () => {
    api.list.mockResolvedValue(list([
      row({ kind: 'og_image', variant: '1200x630', storageDomain: 'published_preview' }),
    ]));
    const { container } = render_();
    await waitFor(() => expect(container.textContent).toContain('published preview'));
    expect(screen.queryByRole('button', { name: 'Get a temporary link' })).toBeNull();
    expect(api.sign).not.toHaveBeenCalled();
  });
});

describe('the reprint notices', () => {
  it('warns about printed plates as soon as the manifest shows a rotation', async () => {
    api.list.mockResolvedValue(list([
      row({ status: 'invalidated', invalidationReason: 'token_rotated' }),
      row({ id: SECOND_QR, status: 'ready' }),
    ]));
    const { container } = render_();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull());

    const notices = screen.getByRole('status');
    expect(notices.textContent).toContain('1 QR plate was retired when the address was rotated');
    expect(notices.textContent).toContain('print again');
    expect(container.textContent).toContain('QR plate');
  });

  it('says nothing about paper when nothing has moved', async () => {
    api.list.mockResolvedValue(list([row({ kind: 'pdf', variant: 'a4', format: 'pdf' })]));
    render_();
    await waitFor(() => expect(screen.queryByText(/Print-ready PDF · A4 paper/)).not.toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('what the panel never does', () => {
  it('offers no control that would start a render', async () => {
    api.list.mockResolvedValue(list([]));
    const { container } = render_();
    await waitFor(() => expect(screen.queryByText(/Nothing has been rendered/)).not.toBeNull());
    const names = [...container.querySelectorAll('button')].map(b => b.textContent);
    expect(names).toEqual(['Refresh']);
  });

  it('holds no address, path or digest in a place a later page could read', async () => {
    api.list.mockResolvedValue(list([row()]));
    api.sign.mockResolvedValue({ data: 'https://storage.invalid/signed?token=abc', error: null });
    render_();
    fireEvent.click(await screen.findByRole('button', { name: 'Get a temporary link' }));
    await waitFor(() => expect(screen.queryByText('Open the file')).not.toBeNull());

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // The signed address exists only as the anchor this session asked for; no other copy of it is
    // written into the document.
    expect(document.querySelectorAll(`a[href*="storage.invalid"]`)).toHaveLength(1);
  });
});
