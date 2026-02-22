// All amounts in paise (1/100 of rupee)
export const BASE_FEE = 19900;

// Per-guest pricing in paise
export const PRICE_PER_GUEST = 499; // ₹4.99 per guest

export const FEATURES = {
  whatsapp: { price: 4900, label: 'WhatsApp Sharing', description: 'Share your invite with one tap', category: 'core', whyPay: 'Without this, guests may miss your invite — 90% of Indian families use WhatsApp daily.' },
  qr: { price: 4900, label: 'QR Code', description: 'Printable QR for quick access', category: 'core', whyPay: 'Elders can scan and view — no typing needed. Avoid confusion at the door.' },
  branded_qr: { price: 9900, label: 'Branded QR', description: 'Custom designed QR with your names', category: 'core', whyPay: 'Make your QR part of the invite design — elegant and personal.' },
  rsvp: { price: 4900, label: 'RSVP Form', description: 'Collect responses from your guests', category: 'core', whyPay: 'Know exactly who is coming. Avoid empty chairs or overcrowding.' },
  meal_report: { price: 4900, label: 'Meal Report', description: 'Detailed meal count by type', category: 'reports', whyPay: 'You will avoid wasted plates — know exact meal counts before the caterer arrives.' },
  csv_export: { price: 2900, label: 'CSV Export', description: 'Download your guest list', category: 'reports', whyPay: 'Easily share guest lists with your family, caterer, or event planner.' },
  priority_design_48h: { price: 99900, label: 'Priority Design (48hr)', description: 'Professional mockup in 48 hours', category: 'human_services', whyPay: 'Running out of time? Our designers deliver a polished invite in 48 hours.' },
  full_designer: { price: 249900, label: 'Full Designer Service', description: 'Dedicated designer for your invite', category: 'human_services', whyPay: 'A personal designer who understands South Indian wedding aesthetics.' },
  wording_edit_basic: { price: 19900, label: 'Wording Edit', description: 'Human-verified wording in your language', category: 'human_services', whyPay: 'Avoid embarrassing wording mistakes — our experts check every line.' },
  accommodation: { price: 4900, label: 'Accommodation Tracking', description: 'Track who needs stay arrangements', category: 'logistics', whyPay: 'Avoid last-minute room shortfalls — know exactly how many beds you need.' },
  transport: { price: 4900, label: 'Transport Tracking', description: 'Manage pickup and drop logistics', category: 'logistics', whyPay: 'No guest left behind at the station — plan vehicles accurately.' },
  seating_planner: { price: 19900, label: 'Seating Planner', description: 'Plan seating for your event', category: 'logistics', whyPay: 'Avoid awkward seat shortfalls. Plan by family group and dietary needs.' },
  reminder_single: { price: 4900, label: 'Reminder Blast (1 round)', description: 'Send one reminder to all guests', category: 'reports', whyPay: 'Guests forget — one reminder doubles your RSVP response rate.' },
  reminder_bundle: { price: 14900, label: 'Reminder Bundle', description: 'Unlimited reminders until the event', category: 'reports', whyPay: 'Keep nudging until every guest responds. Peace of mind guaranteed.' },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_CATEGORIES = {
  core: 'Core',
  human_services: 'Human Services',
  logistics: 'Logistics',
  reports: 'Reports',
} as const;

export const GST_RATE = 0.18;

export function getGuestSubtotal(guestCount: number): number {
  return guestCount * PRICE_PER_GUEST;
}

export interface PriceBreakdown {
  items: { label: string; amount: number }[];
  subtotal: number;
  gst: number;
  total: number;
}

export function calculatePrice(
  selectedFeatures: FeatureKey[],
  guestCount: number,
  printCostPaise: number = 0,
  platformMarkupPaise: number = 0
): PriceBreakdown {
  const items: { label: string; amount: number }[] = [];

  // Base fee
  items.push({ label: 'Project Creation Fee', amount: BASE_FEE });

  // Guest pricing (per head)
  if (guestCount > 0) {
    const guestSubtotal = getGuestSubtotal(guestCount);
    items.push({ label: `${guestCount} guests × ${formatPaise(PRICE_PER_GUEST)}/guest`, amount: guestSubtotal });
  }

  // Features
  for (const key of selectedFeatures) {
    const feature = FEATURES[key];
    if (feature.price > 0) {
      items.push({ label: feature.label, amount: feature.price });
    }
  }

  // Print
  if (printCostPaise > 0) {
    items.push({ label: 'Print Cost (Printer)', amount: printCostPaise });
  }
  if (platformMarkupPaise > 0) {
    items.push({ label: 'Platform Fee (Print)', amount: platformMarkupPaise });
  }

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const gst = Math.round(subtotal * GST_RATE);
  const total = subtotal + gst;

  return { items, subtotal, gst, total };
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: rupees % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

// Print options constants
export const PAPER_TYPES = [
  { id: 'matte', label: 'Matte', pricePerCard: 1500 },
  { id: 'gloss', label: 'Glossy', pricePerCard: 1800 },
  { id: 'textured', label: 'Textured', pricePerCard: 2500 },
  { id: 'handmade', label: 'Handmade Paper', pricePerCard: 4500 },
] as const;

export const PAPER_GSM = [
  { id: '200', label: '200 GSM', multiplier: 1.0 },
  { id: '300', label: '300 GSM', multiplier: 1.3 },
  { id: '350', label: '350 GSM (Premium)', multiplier: 1.5 },
] as const;

export const FINISH_OPTIONS = [
  { id: 'none', label: 'No finish', multiplier: 1.0 },
  { id: 'foil_gold', label: 'Gold Foil', multiplier: 1.8 },
  { id: 'foil_silver', label: 'Silver Foil', multiplier: 1.7 },
  { id: 'emboss', label: 'Embossing', multiplier: 1.6 },
  { id: 'foil_emboss', label: 'Foil + Emboss', multiplier: 2.2 },
] as const;

export function calculatePrintCost(
  qty: number,
  paperType: string,
  gsm: string,
  finish: string
): { printerCost: number; platformMarkup: number } {
  const paper = PAPER_TYPES.find(p => p.id === paperType) || PAPER_TYPES[0];
  const gsmOption = PAPER_GSM.find(g => g.id === gsm) || PAPER_GSM[0];
  const finishOption = FINISH_OPTIONS.find(f => f.id === finish) || FINISH_OPTIONS[0];

  const perCard = Math.round(paper.pricePerCard * gsmOption.multiplier * finishOption.multiplier);
  const printerCost = perCard * qty;
  const platformMarkup = Math.round(printerCost * 0.15);

  return { printerCost, platformMarkup };
}
