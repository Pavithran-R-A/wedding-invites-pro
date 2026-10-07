// The press area of the panel's own controls, pinned through the relation the accessibility
// instrument reads.
//
// `scripts/stage5-a11y-mobile.mjs` does not ask how big a control's box is; it asks how big the box
// a user aims at is, and computes that as `el.closest('label')` when one exists (its own comment
// calls a bare 16px radio a defect the host never meets only *because* it is inside a padded label).
// The replace-target control is a radio, which is 16 CSS px at `h-4 w-4` under this project's
// `html { font-size: 1rem }`. Wrapped in a label it is a label-sized press target; on its own it is
// 16x16, and the sweep asserts against both a 24px floor and the 44px host-workbench figure that
// `docs/product/design-principles.md` states as this product's own rule.
//
// So this file pins the mechanism the instrument depends on, and nothing more. The measured pixel
// figure is the browser tier's to produce — jsdom lays nothing out, and a test here that claimed to
// know a bounding box would be a number with no measurement behind it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WeddingAssetsPanel from "@/components/invitation/WeddingAssetsPanel";
import type { AssetEntry } from "@/integrations/supabase/weddingAssets";

const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  previewAsset: vi.fn(),
  uploadAsset: vi.fn(),
  replaceAsset: vi.fn(),
  removeAsset: vi.fn(),
}));

vi.mock("@/integrations/supabase/weddingAssets", () => ({
  listAssets: (...a: unknown[]) => api.listAssets(...a),
  previewAsset: (...a: unknown[]) => api.previewAsset(...a),
  uploadAsset: (...a: unknown[]) => api.uploadAsset(...a),
  replaceAsset: (...a: unknown[]) => api.replaceAsset(...a),
  removeAsset: (...a: unknown[]) => api.removeAsset(...a),
}));

const ROW: AssetEntry = {
  id: 'a1',
  weddingId: 'w1',
  assetKind: 'photo',
  label: 'Stage photograph',
  objectKey: 'weddings/w1/photo/a1',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  uploadStatus: 'ready',
};

describe('S6 PANEL TARGETS', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listAssets.mockResolvedValue({ data: [ROW], error: null });
  });

  it('gives the replace-target radio a label to press through, which is what makes its target label-sized', async () => {
    render(<WeddingAssetsPanel weddingId="w1" />);
    const radio = await screen.findByRole('radio', { name: /Replace this file/i });
    expect(radio.closest('label')).not.toBeNull();
  });

  it('keeps the radio named by itself, so wrapping it cannot leave the control unlabeled', async () => {
    render(<WeddingAssetsPanel weddingId="w1" />);
    const radio = await screen.findByRole('radio', { name: /Replace this file/i });
    expect(radio.getAttribute('aria-label')).toMatch(/Replace this file/);
  });
});
