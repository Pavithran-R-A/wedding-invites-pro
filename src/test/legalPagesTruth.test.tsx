// Pilot P4b: the three standing legal pages checked against the build they describe.
//
// This file exists because `src/pages/PrivacyPolicy.tsx` promised, in its own banner, to say "what this
// build actually does today" — and four sentences in it had quietly stopped being true while the product
// grew around them. Each one was verified before being replaced, and each is a shape this page could
// easily fall back into, because the honest sentence is one edit away from the confident one:
//
//   * **The font disclosure had inverted.** The page said the preview "loads font files from Google Fonts".
//     Since Stage 9 the faces are committed bytes asked for from this site's own address
//     (`index.html:24` → `/fonts/fonts.css`, inventoried in `public/fonts/font-manifest.json`), and
//     `scripts/check-render-assets.mjs:374-386` fails a build whose product-facing text names a remote font
//     host — a gate that covers `index.html`, `render.html` and `src`, but not what this page *omits*. The
//     cell below therefore pins both halves: the host names absent, the self-hosted sentence present.
//   * **"No analytics" had become a denial of a real record.** The household link and the reviewer link each
//     stamp `private.access_tokens.last_used_at` on a read that succeeded
//     (`supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql:675-677`,
//     `…stage7_family_approval_review.sql:426-428`), and the host's own panel prints it as "opened on <day>"
//     (`src/components/invitation/GuestInvitationPanel.tsx:700`). A blanket "we record nothing about a guest
//     who follows a link" is the worst shape a privacy page can take: true for one of the three link kinds,
//     false for two. The page must keep saying both halves — the published address leaves nothing, the
//     household and reviewer links leave a date — and must keep naming what the date does not hold.
//   * **The channels it deferred had shipped.** "A support and deletion-request channel will be provided in a
//     later release" is now false twice over: `/support` and `/my-data` are live behind the sign-in wall
//     (`src/App.tsx:68-69`), over Stage 11's intake substrate. The replacement has to stay honest in the
//     other direction too, because that substrate's own header reads "receive a request, route it, never
//     erase anything" (`…20261020190300_stage11_privacy_intake.sql:1`) — so the page says asking is not doing,
//     and the cell below pins that sentence as firmly as it pins the absence of the deferral.
//   * **The data list stopped at drafts.** The product stores guest replies, uploads, every frozen version,
//     support threads, data requests and an internal trail. Those are named as a list below, each phrase loose
//     enough to survive a rewording and specific enough that dropping a whole subject goes red.
//
//   * **The sibling pages deferred the same channel.** `CookiePolicy.tsx` closed with "A monitored contact
//     address will be published alongside the production release" and denied a WhatsApp cookie "because those
//     features are not present yet" — the first is now false (`/support`, `/my-data`), and the second is true
//     about the cookie for a reason that has gone stale, since the publish panel links out to WhatsApp at
//     `src/components/invitation/PublicationPanel.tsx:258`. `TermsOfService.tsx` carried the same deferral, and
//     widening the sweep past the exact old sentence found a third wording of it — in the privacy policy's own
//     Contact section, "A monitored email contact will be published alongside the production release" — which
//     is why the pinned absence below is a family of phrases rather than one string. The last describe block
//     reads all three pages, because a channel that exists in the product and exists nowhere in its legal
//     pages is the same defect wearing a different hat.
//
// What this file does NOT claim. That the list is *provably* exhaustive — its yardstick is the verb census in
// `src/integrations/supabase/*`, which a person read; a new adapter verb can still outpace this page, and the
// browser tier that would catch the rendering of these sentences on a real document has not run at this head.
// That the retention rule described as missing is coming: it is missing because nobody has written it down.
// And nothing here is a legal opinion; the banner this file pins says so in the page's own words.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType } from 'react';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

import PrivacyPolicy from '@/pages/PrivacyPolicy';
import CookiePolicy from '@/pages/CookiePolicy';
import TermsOfService from '@/pages/TermsOfService';

const renderPolicy = () => render(
  <MemoryRouter>
    <PrivacyPolicy />
  </MemoryRouter>,
);

const text = () => document.body.textContent ?? '';

/** Subjects the product writes today, read from the adapter census in `src/integrations/supabase/*`. A
 *  policy that forgets a whole subject is the failure this list is for, so the phrases are deliberately
 *  about the *thing*, not about the sentence that happened to ship with it. */
const STORED_SUBJECTS = [
  /email address/i,                       // sign-up, `Signup.tsx`
  /name you type on the sign-up form/i,   // `Signup.tsx:64`, stored on the account
  /estimated guest count/i,               // `ConfigureProject` → `weddings.estimated_guest_count`
  /address text/i,                        // venues, `weddingContent.ts`
  /version you freeze/i,                  // `publication.ts`, `weddingContent.ts`
  /one-way digest/i,                      // published link, `…stage3_publication…`
  /household/i,                           // `guestInvitations.ts` → `createGuestHousehold`
  /family reviewer/i,                     // `familyReview.ts` → `requestFamilyReview`
  /whether they are coming/i,             // the guest's reply, `GuestDoor.tsx`
  /support thread/i,                      // `support.ts` → `openSupportCase`
  /data request/i,                        // `privacyRequests.ts` → `createPrivacyRequest`
  /internal trail/i,                      // `private.audit_events`, read only as an operator aggregate
];

describe('the privacy policy says what this build does, not what it used to do', () => {
  it('keeps the banner that makes the rest of the page answerable', () => {
    renderPolicy();
    expect(text()).toMatch(/what this build actually does today/);
    expect(text()).toMatch(/This is not formal legal advice/);
  });

  it('renders the page as a landmark rather than a bare document', () => {
    renderPolicy();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
  });

  it('says the typefaces come from this site and names no remote font host anywhere', () => {
    renderPolicy();
    expect(text()).toMatch(/carried with the build and asked for\s+from this site's own address/);
    for (const retired of [/Google Fonts/i, /fonts\.googleapis\.com/i, /fonts\.gstatic\.com/i]) {
      expect(text()).not.toMatch(retired);
    }
  });

  it('tells the two halves of the link-opening truth instead of one comfortable half', () => {
    renderPolicy();
    // The published address really does leave nothing.
    expect(text()).toMatch(/published address leaves no record/);
    // The household and reviewer links really do leave a date, and the page says which.
    expect(text()).toMatch(/date they were last opened/);
    expect(text()).toMatch(/household, and a link\s+issued to one family reviewer/i);
    // What the date is not: no identity, no device, and no proof of who inside the household.
    expect(text()).toMatch(/no name, no device, no IP address/);
    expect(text()).toMatch(/opened, not by whom/);
    // And the failure mode this file exists for: the blanket denial, phrased the way the page used to
    // phrase it, must not come back even alongside the true sentences.
    expect(text()).not.toMatch(/does not record who opened/i);
  });

  it('names the channels that shipped and refuses to imply that asking is doing', () => {
    renderPolicy();
    expect(text()).toMatch(/\/support/);
    expect(text()).toMatch(/\/my-data/);
    expect(text()).toMatch(/Filing either request records the ask and routes it\. It does not produce a file/);
    for (const deferred of [/will be provided in a later release/i, /not yet implemented in this build/i]) {
      expect(text()).not.toMatch(deferred);
    }
  });

  it('keeps the one outbound door visible rather than implying a sealed site', () => {
    renderPolicy();
    expect(text()).toMatch(/There is one door that leads out, and only you can open it/);
    expect(text()).toMatch(/Open in WhatsApp/);
    // The claim a crawler audit would contradict: nothing here says the product *previews* on WhatsApp.
    expect(text()).not.toMatch(/preview(s|ed)? (on|in) WhatsApp/i);
  });

  it('still refuses money, in the sentences a later commerce slice has to edit on purpose', () => {
    renderPolicy();
    expect(text()).toMatch(/does not process payments/);
    expect(text()).toMatch(/no checkout/i);
    expect(text()).toMatch(/does not take, store, or have access to card\s+details/);
  });

  it('describes the session as a browser storage mechanism, not a server cookie', () => {
    renderPolicy();
    expect(text()).toMatch(/local storage/);
    expect(text()).toMatch(/not an HttpOnly server-set session\s+cookie/);
    expect(text()).toMatch(/Clearing your browser storage signs you out/);
  });

  it('inventories every subject this build writes for a customer', () => {
    renderPolicy();
    const page = text();
    for (const subject of STORED_SUBJECTS) expect(page).toMatch(subject);
  });

  it('says what a guest is NOT asked, because a reply is the row most likely to be over-described', () => {
    renderPolicy();
    expect(text()).toMatch(/no name typed at the door, no device detail and no\s+location/);
  });

  it("keeps the operator's access honest: scoped, checked against the session, and not self-service", () => {
    renderPolicy();
    expect(text()).toMatch(/No account can hand itself that grant/);
    expect(text()).toMatch(/checked against your session rather than against anything a caller types/);
  });

  it('admits the retention rule is missing instead of inventing a window', () => {
    renderPolicy();
    expect(text()).toMatch(/how long an\s+invitation's data is kept after the wedding it announces is over\s+—\s+is not written down yet/);
    expect(text()).not.toMatch(/retained for \d+ (?:days|months|years)/i);
    expect(text()).not.toMatch(/automatically deleted after/i);
  });
});

describe('the sibling legal pages describe channels and denials that still hold', () => {
  // Every shape these pages used to reach for to defer the contact channel to "later". All three now name
  // the two channels that are in the product and say plainly that no email address is published today.
  const DEFERRAL = /(contact address|email contact|email address) will be published/i;

  const LEGAL_PAGES: { Page: ComponentType; title: string }[] = [
    { Page: PrivacyPolicy, title: 'Privacy Policy' },
    { Page: CookiePolicy, title: 'Cookie & Storage Policy' },
    { Page: TermsOfService, title: 'Terms of Service' },
  ];

  it('points every legal page at the two channels that are in the product', () => {
    for (const { Page, title } of LEGAL_PAGES) {
      const { container } = render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>,
      );
      // Read this page's own document only — a loop over three pages that reads document.body would be
      // satisfied by the text of one of them — and prove the document is the page this iteration claims.
      const main = container.querySelector('main');
      expect(main, `${title}: rendered with no main landmark`).toBeTruthy();
      expect(main?.querySelector('h1')?.textContent).toBe(title);
      const page = main?.textContent ?? '';
      expect(page).toMatch(/\/support/);
      expect(page).toMatch(/\/my-data/);
      expect(page).not.toMatch(DEFERRAL);
      expect(page).not.toMatch(/will be provided in a later release/i);
    }
  });

  it('says the cookie page has nothing to decline, and why', () => {
    render(
      <MemoryRouter>
        <CookiePolicy />
      </MemoryRouter>,
    );
    expect(text()).toMatch(/There is no optional storage to decline/);
    expect(text()).toMatch(/Notice acknowledgement/);
    expect(text()).toMatch(/no advertising, analytics, or third-party cookies/);
  });

  it('denies the provider cookies without claiming the product has no integration', () => {
    render(
      <MemoryRouter>
        <CookiePolicy />
      </MemoryRouter>,
    );
    expect(text()).toMatch(/sets no Razorpay or PhonePe cookie/);
    // The retired reason clause: true when written, stale now that a share link to WhatsApp ships.
    expect(text()).not.toMatch(/those features are\s+not present yet/i);
    expect(text()).toMatch(/sets no WhatsApp cookie/);
    expect(text()).toMatch(/passes your invitation's address\s+to them when you press it/);
  });

  it('explains the missing CSRF token by the session it protects, not by an absent feature', () => {
    render(
      <MemoryRouter>
        <CookiePolicy />
      </MemoryRouter>,
    );
    expect(text()).toMatch(/no cookie-based session for one to protect/);
    expect(text()).toMatch(/Clearing\s+the session signs you out/);
  });

  it('keeps the terms page free of a commerce claim it cannot support', () => {
    render(
      <MemoryRouter>
        <TermsOfService />
      </MemoryRouter>,
    );
    expect(text()).toMatch(/not a commercial service yet/);
    expect(text()).toMatch(/not formal legal advice/i);
    expect(text()).toMatch(/no published email address for this preview yet/i);
  });
});
