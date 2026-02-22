// All amounts in paise (1/100 of rupee)
export const BASE_FEE = 19900;

export const GUEST_TIERS = [
  { limit: 50, price: 9900, label: 'Up to 50 guests' },
  { limit: 150, price: 24900, label: 'Up to 150 guests' },
  { limit: 300, price: 39900, label: 'Up to 300 guests' },
  { limit: Infinity, price: 69900, label: 'Unlimited guests' },
] as const;

export const FEATURES = {
  rsvp: { price: 0, label: 'RSVP Form', description: 'Collect responses from your guests', category: 'core', included: true },
  whatsapp: { price: 4900, label: 'WhatsApp Sharing', description: 'Share your invite with one tap', category: 'core' },
  qr: { price: 4900, label: 'QR Code', description: 'Printable QR for quick access', category: 'core' },
  branded_qr: { price: 9900, label: 'Branded QR', description: 'Custom designed QR with your names', category: 'core' },
  priority_design_48h: { price: 99900, label: 'Priority Design (48hr)', description: 'Professional mockup in 48 hours', category: 'human_services' },
  full_designer: { price: 249900, label: 'Full Designer Service', description: 'Dedicated designer for your invite', category: 'human_services' },
  wording_edit_basic: { price: 19900, label: 'Wording Edit', description: 'Human-verified wording in your language', category: 'human_services' },
  accommodation: { price: 4900, label: 'Accommodation Tracking', description: 'Track who needs stay arrangements', category: 'logistics' },
  transport: { price: 4900, label: 'Transport Tracking', description: 'Manage pickup and drop logistics', category: 'logistics' },
  seating_planner: { price: 19900, label: 'Seating Planner', description: 'Plan seating for your event', category: 'logistics' },
  meal_report: { price: 0, label: 'Meal Report', description: 'Detailed meal count by type', category: 'reports', included: true },
  csv_export: { price: 0, label: 'CSV Export', description: 'Download your guest list', category: 'reports', included: true },
  reminder_single: { price: 4900, label: 'Reminder Blast (1 round)', description: 'Send one reminder to all guests', category: 'reports' },
  reminder_bundle: { price: 14900, label: 'Reminder Bundle', description: 'Unlimited reminders until the event', category: 'reports' },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_CATEGORIES = {
  core: 'Core',
  human_services: 'Human Services',
  logistics: 'Logistics',
  reports: 'Reports',
} as const;

export const GST_RATE = 0.18;

export function getGuestTierPrice(guestCount: number): number {
  const tier = GUEST_TIERS.find(t => guestCount <= t.limit);
  return tier ? tier.price : GUEST_TIERS[GUEST_TIERS.length - 1].price;
}

export function getGuestTierLabel(guestCount: number): string {
  const tier = GUEST_TIERS.find(t => guestCount <= t.limit);
  return tier ? tier.label : GUEST_TIERS[GUEST_TIERS.length - 1].label;
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

  // Guest tier
  if (guestCount > 0) {
    const guestPrice = getGuestTierPrice(guestCount);
    items.push({ label: getGuestTierLabel(guestCount), amount: guestPrice });
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
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}
