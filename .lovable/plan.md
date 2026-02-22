

# YourInvite — South Indian Wedding Invitation Platform

## Vision
A paid, mobile-first web app where families create beautiful South Indian wedding invitations, share them via WhatsApp/QR, and manage guest RSVPs, meals, and print orders — all in one place.

---

## Phase 1: MVP (What we build now)

### 1. Landing Page & Marketing
- Hero section with wedding theme (warm gold, deep green, maroon, off-white palette)
- Pricing section showing all tiers clearly (₹199 project fee, guest tiers, add-ons)
- "How it works" steps section
- Template gallery preview
- Trust signals, footer with legal links
- SEO meta tags and Open Graph tags
- Cookie consent banner with essential/analytics/messaging options

### 2. Authentication & User Management
- Email/phone signup and login via Supabase Auth
- User profiles with name, phone, role
- Session management with secure tokens
- Password reset flow

### 3. Template-Based Invite Creator
- **Template Gallery**: 6-8 beautiful South Indian wedding templates (Tamil, Telugu, Kannada, Malayalam styles)
- **Customization Form**: Fill in couple names, parents' names, venue, date/time, ritual details, custom message
- **Language Blocks**: Pre-written ritual wording templates in Tamil, Telugu, Kannada, Malayalam, and English — users pick and customize
- **Live Preview**: Real-time preview of the invitation as users fill in details, shown in device frame mockup
- **PDF Export**: Generate downloadable PDF of the invitation
- **Auto-save**: Drafts save every 10 seconds

### 4. Sharing & QR
- Generate shareable short URL for each invite preview page (hosted public page)
- QR code generation pointing to preview URL
- WhatsApp share button with pre-filled share text templates
- Public preview page accessible without login — elegant, fast-loading

### 5. Guest Management & RSVP
- Add guests manually (name, phone, email, group/side)
- CSV upload for bulk guest import
- Public RSVP form: attending yes/no, number of people, meal type (veg/non-veg/Jain), meal time, accommodation needed, transport needed, special notes
- Live dashboard with tiles: attending count, not attending, pending, total meals by type
- CSV export of guest list and printable meal report

### 6. Elder Approval Flow
- Generate a one-tap approval link that shows the final invite as a screenshot/preview
- Elder can approve or request changes with a simple tap — no login required
- Status shown on dashboard (approved / pending / changes requested)

### 7. Payments & Billing (Razorpay — set up when ready)
- Project creation charges ₹199
- Guest tier upgrade charging based on exact pricing rules
- Payment confirmation with receipt
- Invoice PDF generation
- All payment processing via Razorpay with server-side order creation and webhook verification

### 8. Print Order Flow
- Select paper type, finish, quantity
- Show printer cost + platform markup separately
- PDF sent to printer partner (initially via email)
- Order tracking with status updates on dashboard

### 9. Dashboard
- Overview tiles: active projects, total guests, RSVP stats, recent orders
- Quick actions: create new project, view guest report, check payments
- Activity history / audit log of recent actions

### 10. Admin Portal (Basic)
- View all orders and their statuses
- Manage printer partners
- View platform metrics (paid projects, conversion)

### 11. Localization
- UI strings in Tamil, Telugu, Kannada, Malayalam, and English
- Language selector in header
- Proper font fallbacks for each script
- Indian date/number formatting

### 12. Design & UX Details
- **Color palette**: Warm gold (#D4A853), deep green (#2D5016), maroon (#800020), off-white (#FFF8F0)
- **Mobile-first** single column layout, two-column on desktop for editor
- Skeleton loaders, toast confirmations, smooth transitions
- Confetti animation on first paid project creation
- Error states with clear messages and action buttons
- WCAG AA color contrast compliance

---

## Phase 2: Full Canvas Editor (Future)
- Drag-and-drop designer studio with layers, text boxes, image uploads
- Left toolbar for elements, center canvas, right properties panel
- Undo/redo with keyboard shortcuts
- Custom font uploads
- Save as template for reuse

## Phase 3: Advanced Features (Future)
- Branded QR posters (₹99)
- Seating planner (₹199)
- Priority design service (₹999 / ₹2,499)
- Human-verified wording edits (₹199–₹799)
- Sample pack ordering
- Keepsake PDF album
- Reminder blasts (₹49/round or ₹149 bundle)
- Printer API integration (beyond email)
- Two-factor auth for admin
- Advanced analytics and monitoring

---

## Technical Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + shadcn/ui components
- **Backend**: Lovable Cloud (Supabase) — database, auth, edge functions, storage
- **Payments**: Razorpay via edge functions (server-side order creation, webhook verification)
- **File Storage**: Supabase Storage for PDFs, images, templates
- **Database**: PostgreSQL via Supabase with RLS policies on all tables
- **Security**: Row-level security, input validation, secure cookies, rate limiting on RSVP endpoints, audit logging

