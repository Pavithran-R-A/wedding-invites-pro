import { describe, it, expect } from 'vitest';
import {
  calculatePrice,
  calculatePrintCost,
  getGuestTierPrice,
  getGuestTierLabel,
  formatPaise,
  BASE_FEE,
  GST_RATE,
  type FeatureKey,
} from '@/lib/pricing';

describe('Pricing Engine', () => {
  describe('formatPaise', () => {
    it('formats zero correctly', () => {
      expect(formatPaise(0)).toBe('₹0');
    });
    it('formats 19900 paise as ₹199', () => {
      expect(formatPaise(19900)).toBe('₹199');
    });
    it('formats large amounts with Indian grouping', () => {
      const result = formatPaise(10000000); // ₹1,00,000
      expect(result).toContain('1');
    });
  });

  describe('getGuestTierPrice', () => {
    it('returns 9900 for 1-50 guests', () => {
      expect(getGuestTierPrice(1)).toBe(9900);
      expect(getGuestTierPrice(50)).toBe(9900);
    });
    it('returns 24900 for 51-150 guests', () => {
      expect(getGuestTierPrice(51)).toBe(24900);
      expect(getGuestTierPrice(150)).toBe(24900);
    });
    it('returns 39900 for 151-300 guests', () => {
      expect(getGuestTierPrice(151)).toBe(39900);
      expect(getGuestTierPrice(300)).toBe(39900);
    });
    it('returns 69900 for 301+ guests', () => {
      expect(getGuestTierPrice(301)).toBe(69900);
      expect(getGuestTierPrice(9999)).toBe(69900);
    });
  });

  describe('getGuestTierLabel', () => {
    it('returns correct label for each tier', () => {
      expect(getGuestTierLabel(25)).toBe('Up to 50 guests');
      expect(getGuestTierLabel(100)).toBe('Up to 150 guests');
      expect(getGuestTierLabel(200)).toBe('Up to 300 guests');
      expect(getGuestTierLabel(500)).toBe('Unlimited guests');
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

    it('adds guest tier when guestCount > 0', () => {
      const result = calculatePrice([], 50);
      expect(result.items).toHaveLength(2);
      expect(result.items[1].amount).toBe(9900);
    });

    it('adds paid features but not free ones', () => {
      const features: FeatureKey[] = ['rsvp', 'whatsapp', 'qr'];
      const result = calculatePrice(features, 0);
      // rsvp is free (0), whatsapp and qr are 4900 each
      expect(result.items).toHaveLength(3); // base + whatsapp + qr
      expect(result.subtotal).toBe(BASE_FEE + 4900 + 4900);
    });

    it('includes print costs when provided', () => {
      const result = calculatePrice([], 0, 15000, 2250);
      expect(result.items).toHaveLength(3); // base + print cost + platform fee
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

    it('uses integer arithmetic (no floating point errors)', () => {
      const result = calculatePrice(['branded_qr', 'priority_design_48h'], 300, 50000, 7500);
      // All values must be integers
      expect(Number.isInteger(result.subtotal)).toBe(true);
      expect(Number.isInteger(result.gst)).toBe(true);
      expect(Number.isInteger(result.total)).toBe(true);
      result.items.forEach(item => {
        expect(Number.isInteger(item.amount)).toBe(true);
      });
    });
  });

  describe('calculatePrintCost', () => {
    it('calculates basic matte print cost', () => {
      const { printerCost, platformMarkup } = calculatePrintCost(100, 'matte', '200', 'none');
      expect(printerCost).toBe(1500 * 100); // 1500 per card * 100
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
