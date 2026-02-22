import { describe, it, expect } from 'vitest';
import {
  calculatePrice,
  calculatePrintCost,
  getGuestSubtotal,
  formatPaise,
  BASE_FEE,
  GST_RATE,
  PRICE_PER_GUEST,
  FEATURES,
  type FeatureKey,
} from '@/lib/pricing';

describe('Pricing Engine', () => {
  describe('formatPaise', () => {
    it('formats zero correctly', () => {
      expect(formatPaise(0)).toContain('0');
    });
    it('formats 19900 paise as ₹199', () => {
      expect(formatPaise(19900)).toContain('199');
    });
    it('formats per-guest price', () => {
      expect(formatPaise(499)).toContain('4.99');
    });
  });

  describe('getGuestSubtotal', () => {
    it('calculates per-guest pricing', () => {
      expect(getGuestSubtotal(100)).toBe(100 * PRICE_PER_GUEST);
      expect(getGuestSubtotal(173)).toBe(173 * PRICE_PER_GUEST);
      expect(getGuestSubtotal(0)).toBe(0);
      expect(getGuestSubtotal(1)).toBe(PRICE_PER_GUEST);
    });
  });

  describe('calculatePrice', () => {
    it('returns base fee for empty features and 0 guests', () => {
      const result = calculatePrice([], 0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].label).toBe('Project Creation Fee');
      expect(result.items[0].amount).toBe(BASE_FEE);
      expect(result.subtotal).toBe(BASE_FEE);
      expect(result.gst).toBe(Math.round(BASE_FEE * GST_RATE));
      expect(result.total).toBe(BASE_FEE + result.gst);
    });

    it('adds per-guest cost when guestCount > 0', () => {
      const result = calculatePrice([], 50);
      expect(result.items).toHaveLength(2);
      expect(result.items[1].amount).toBe(50 * PRICE_PER_GUEST);
    });

    it('adds paid features', () => {
      const features: FeatureKey[] = ['whatsapp', 'qr'];
      const result = calculatePrice(features, 0);
      expect(result.subtotal).toBe(BASE_FEE + FEATURES.whatsapp.price + FEATURES.qr.price);
    });

    it('includes print costs when provided', () => {
      const result = calculatePrice([], 0, 15000, 2250);
      expect(result.subtotal).toBe(BASE_FEE + 15000 + 2250);
    });

    it('calculates GST correctly (18%)', () => {
      const result = calculatePrice([], 0);
      expect(result.gst).toBe(Math.round(result.subtotal * 0.18));
    });

    it('total equals subtotal + gst', () => {
      const features: FeatureKey[] = ['whatsapp', 'accommodation', 'seating_planner'];
      const result = calculatePrice(features, 150, 10000, 1500);
      expect(result.total).toBe(result.subtotal + result.gst);
    });

    it('uses integer arithmetic', () => {
      const result = calculatePrice(['branded_qr', 'priority_design_48h'], 300, 50000, 7500);
      expect(Number.isInteger(result.subtotal)).toBe(true);
      expect(Number.isInteger(result.gst)).toBe(true);
      expect(Number.isInteger(result.total)).toBe(true);
    });

    it('all feature prices are positive integers', () => {
      for (const [, feat] of Object.entries(FEATURES)) {
        expect(feat.price).toBeGreaterThan(0);
        expect(Number.isInteger(feat.price)).toBe(true);
      }
    });
  });

  describe('calculatePrintCost', () => {
    it('calculates basic matte print cost', () => {
      const { printerCost, platformMarkup } = calculatePrintCost(100, 'matte', '200', 'none');
      expect(printerCost).toBe(1500 * 100);
      expect(platformMarkup).toBe(Math.round(printerCost * 0.15));
    });

    it('applies GSM multiplier', () => {
      const base = calculatePrintCost(10, 'matte', '200', 'none');
      const premium = calculatePrintCost(10, 'matte', '350', 'none');
      expect(premium.printerCost).toBeGreaterThan(base.printerCost);
    });

    it('applies finish multiplier', () => {
      const plain = calculatePrintCost(10, 'matte', '200', 'none');
      const foil = calculatePrintCost(10, 'matte', '200', 'foil_gold');
      expect(foil.printerCost).toBeGreaterThan(plain.printerCost);
    });

    it('returns integers only', () => {
      const { printerCost, platformMarkup } = calculatePrintCost(77, 'textured', '300', 'foil_emboss');
      expect(Number.isInteger(printerCost)).toBe(true);
      expect(Number.isInteger(platformMarkup)).toBe(true);
    });

    it('handles zero quantity', () => {
      const { printerCost, platformMarkup } = calculatePrintCost(0, 'matte', '200', 'none');
      expect(printerCost).toBe(0);
      expect(platformMarkup).toBe(0);
    });
  });
});
