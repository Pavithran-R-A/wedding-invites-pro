

# YourInvite — Next Implementation Step

## What exists now
A complete landing page with Hero, Trust signals, How It Works, Template Gallery, Pricing, Footer, and Cookie Consent. The color palette, fonts, and basic design system are in place.

## What we build next

This step focuses on **enabling Lovable Cloud (Supabase)** and building the **core database schema, authentication, and the two-step checkout flow with live price meter** -- the heart of the a la carte pricing model.

---

## Step 1: Enable Lovable Cloud and set up database

### Tables to create

1. **profiles** — id (FK to auth.users), name, phone, role (user/admin/planner), language_pref, created_at, last_login
2. **templates** — id, name, preview_svg, price_tier, tags (text[]), language_support (text[]), active
3. **projects** — id, user_id (FK profiles), title, language, template_id (FK templates), paid_status (unpaid/base_paid/fully_paid), selected_features (jsonb), guest_count, created_at
4. **guests** — id, project_id (FK projects), name, phone, email, group_name, rsvp_status (pending/attending/declined), rsvp_at, people_count, meal_type, meal_time, accommodation, transport, notes, token (unique for RSVP link)
5. **orders** — id, project_id (FK projects), type (print/addon), printer_id, status (pending/paid/held/sent/delivered), pdf_url, cost_printer_paise, price_platform_paise, created_at
6. **payments** — id, order_id, user_id, provider (razorpay), provider_id, amount_paise, status (created/captured/failed/refunded), created_at
7. **activity_logs** — id, user_id, project_id, action, ip, user_agent, created_at
8. **printers** — id, name, contact, api_endpoint, payment_terms, regions (text[]), active

All monetary values stored as integers in paise (1/100 of rupee) to avoid floating-point errors.

### RLS policies
- profiles: users read/update own row only
- projects: users CRUD own projects only
- guests: users manage guests on own projects; public can insert RSVP via token
- orders/payments: users read own; admin reads all
- templates: public read; admin write
- activity_logs: admin read; system insert
- printers: admin CRUD; public read active only

### Seed data
- 5-6 template records (Tamil Traditional, Telugu Grandeur, Kannada Elegance, Kerala Charm, Modern Minimal, Royal South)
- 1 sample printer record

---

## Step 2: Authentication

- Supabase Auth with email signup/login
- Profile auto-creation trigger on signup
- Login page (`/login`) and signup page (`/signup`)
- Password reset flow with `/reset-password` page
- Protected route wrapper component
- Auth context with `onAuthStateChange` listener
- Redirect unauthenticated users to login

---

## Step 3: Updated color palette

Update the CSS variables to match the exact hex values specified:
- Gold: #c9972f
- Maroon: #6b1e2a
- Deep green: #1f6f52
- Cream: #fbf6f0
- Off-white: #fff8f3

Update the trust section to say "PhonePe" instead of "Razorpay" (though backend payment integration will use Razorpay SDK since PhonePe doesn't have a direct JS SDK -- we'll handle this when payment keys are ready).

---

## Step 4: Two-step checkout with live price meter

### Step A: Project Creation (`/create-project`)
- Select template from gallery
- Enter project title
- Choose primary language
- Show mandatory base fee: Rs.199
- "Pay and Create" button (initially mocked -- actual payment wired when Razorpay keys are ready)
- On success: create project record with `paid_status = 'base_paid'`, redirect to Step B

### Step B: Feature Builder (`/project/:id/configure`)
- Left side (mobile: full width): Feature toggles grouped into categories
  - **Core**: RSVP form (Rs.0 included), WhatsApp sharing (Rs.49), QR code (Rs.49), Branded QR (Rs.99)
  - **Guests**: Guest count input with live tier pricing (50/Rs.99, 150/Rs.249, 300/Rs.399, unlimited/Rs.699)
  - **Print**: Toggle print order, show qty/paper/finish selectors, show printer cost + platform markup lines
  - **Human Services**: Priority design 48hr (Rs.999), Full designer (Rs.2,499), Wording edit (Rs.199-Rs.799)
  - **Logistics**: Accommodation tracking (Rs.49), Transport tracking (Rs.49), Seating planner (Rs.199)
  - **Reports**: Meal report (Rs.0 included), CSV export (Rs.0 included), Reminder blast (Rs.49/round or Rs.149 bundle)

- Right side (mobile: sticky bottom bar): **Live Price Meter**
  - Line items: base fee, guest tier, each selected feature, print costs, platform markup, taxes (GST 18%)
  - Running total updates with 180ms ease animation
  - All arithmetic in paise, displayed as rupees

- Each toggle shows: feature name, one-line value description, price
- Toggle microanimation: smooth check with subtle scale
- "Review Order" button opens invoice preview before final payment

### Invoice Preview
- Modal/page showing full breakdown as a styled invoice
- Download as PDF button (future)
- "Proceed to Pay" button

---

## Step 5: Dashboard shell (`/dashboard`)

- After login, users land here
- Shows list of user's projects with status badges
- "Create New Invite" button leading to `/create-project`
- Quick stats tiles (placeholder for now)

---

## Step 6: Localization foundation

- Create `src/lib/i18n.ts` with a simple key-value translation system
- Support 5 languages: en, ta, te, kn, ml
- Language selector in header (globe icon dropdown)
- Translate: header nav items, hero section, pricing labels, button text, form labels
- Store user's language preference in profile

---

## Technical details

### New files to create
- `src/pages/Login.tsx` — login form
- `src/pages/Signup.tsx` — signup form
- `src/pages/ResetPassword.tsx` — password reset
- `src/pages/Dashboard.tsx` — user dashboard
- `src/pages/CreateProject.tsx` — Step A checkout
- `src/pages/ConfigureProject.tsx` — Step B feature builder with price meter
- `src/components/auth/ProtectedRoute.tsx` — auth guard
- `src/components/auth/AuthProvider.tsx` — auth context
- `src/components/checkout/FeatureToggle.tsx` — individual feature toggle with animation
- `src/components/checkout/PriceMeter.tsx` — live price breakdown sidebar
- `src/components/checkout/InvoicePreview.tsx` — invoice modal
- `src/components/checkout/GuestCountInput.tsx` — guest count with tier display
- `src/lib/i18n.ts` — translation system
- `src/lib/pricing.ts` — client-side pricing calculator (mirrors server logic, amounts in paise)
- `src/integrations/supabase/client.ts` — Supabase client (auto-generated)
- `src/integrations/supabase/types.ts` — DB types (auto-generated)

### Routes to add
- `/login`, `/signup`, `/reset-password` — public
- `/dashboard` — protected
- `/create-project` — protected
- `/project/:id/configure` — protected

### Pricing engine (client-side for live meter, server-side edge function later)
```
BASE_FEE = 19900  // paise
GUEST_TIERS = { 50: 9900, 150: 24900, 300: 39900, Infinity: 69900 }
FEATURES = {
  whatsapp: 4900,
  qr: 4900,
  branded_qr: 9900,
  priority_design_48h: 99900,
  full_designer: 249900,
  wording_edit_basic: 19900,
  accommodation: 4900,
  transport: 4900,
  seating_planner: 19900,
  reminder_single: 4900,
  reminder_bundle: 14900,
}
GST_RATE = 0.18
```

All amounts stored and calculated as integers in paise. Display converts to rupees with proper Indian formatting.

