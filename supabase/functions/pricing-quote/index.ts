import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_FEE = 19900;

const GUEST_TIERS = [
  { limit: 50, price: 9900, label: "Up to 50 guests" },
  { limit: 150, price: 24900, label: "Up to 150 guests" },
  { limit: 300, price: 39900, label: "Up to 300 guests" },
  { limit: Infinity, price: 69900, label: "Unlimited guests" },
];

const FEATURES: Record<string, { price: number; label: string; taxable: boolean }> = {
  rsvp: { price: 0, label: "RSVP Form", taxable: true },
  whatsapp: { price: 4900, label: "WhatsApp Sharing", taxable: true },
  qr: { price: 4900, label: "QR Code", taxable: true },
  branded_qr: { price: 9900, label: "Branded QR", taxable: true },
  priority_design_48h: { price: 99900, label: "Priority Design (48hr)", taxable: true },
  full_designer: { price: 249900, label: "Full Designer Service", taxable: true },
  wording_edit_basic: { price: 19900, label: "Wording Edit", taxable: true },
  accommodation: { price: 4900, label: "Accommodation Tracking", taxable: true },
  transport: { price: 4900, label: "Transport Tracking", taxable: true },
  seating_planner: { price: 19900, label: "Seating Planner", taxable: true },
  meal_report: { price: 0, label: "Meal Report", taxable: true },
  csv_export: { price: 0, label: "CSV Export", taxable: true },
  reminder_single: { price: 4900, label: "Reminder Blast (1 round)", taxable: true },
  reminder_bundle: { price: 14900, label: "Reminder Bundle", taxable: true },
};

const GST_RATE = 0.18;

// Simple in-memory cache with 60s TTL
const cache = new Map<string, { result: unknown; expiry: number }>();

function getCacheKey(body: unknown): string {
  return JSON.stringify(body);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { guestCount = 0, features = [], print } = body;

    // Check cache
    const cacheKey = getCacheKey({ guestCount, features, print });
    const cached = cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return new Response(JSON.stringify(cached.result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const breakdown: { label: string; amount: number; taxable: boolean }[] = [];

    // Base fee
    breakdown.push({ label: "Project Creation Fee", amount: BASE_FEE, taxable: true });

    // Guest tier
    if (guestCount > 0) {
      const tier = GUEST_TIERS.find((t) => guestCount <= t.limit) || GUEST_TIERS[GUEST_TIERS.length - 1];
      breakdown.push({ label: tier.label, amount: tier.price, taxable: true });
    }

    // Features
    for (const key of features) {
      const feat = FEATURES[key];
      if (feat && feat.price > 0) {
        breakdown.push({ label: feat.label, amount: feat.price, taxable: feat.taxable });
      }
    }

    // Print costs
    if (print && print.qty > 0) {
      const printCost = print.costPrinterPaise || 0;
      const platformMarkup = print.platformMarkupPaise || 0;
      if (printCost > 0) {
        breakdown.push({ label: "Print Cost (Printer)", amount: printCost, taxable: true });
      }
      if (platformMarkup > 0) {
        breakdown.push({ label: "Platform Fee (Print)", amount: platformMarkup, taxable: true });
      }
    }

    const subtotal = breakdown.reduce((sum, item) => sum + item.amount, 0);
    const taxableAmount = breakdown.filter((i) => i.taxable).reduce((sum, i) => sum + i.amount, 0);
    const taxes = Math.round(taxableAmount * GST_RATE);
    const total = subtotal + taxes;

    const result = { breakdown, subtotal, taxes, total };

    // Cache for 60 seconds
    cache.set(cacheKey, { result, expiry: Date.now() + 60_000 });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
