// Customer-facing legal copy, re-derived from what this build writes to a browser today.
//
// Two sentences here had gone the same way as the ones the privacy policy grew four new sections to fix: not
// wrong about a feature's existence, but wrong about the *reason* a denial was safe.
//   * "sets no Razorpay, PhonePe, or WhatsApp cookies, because those features are not present yet." The
//     cookies part is still true — the storage census of this tree is `src/components/landing/CookieConsent.tsx:10,18`
//     (two `localStorage` calls) and one `document.cookie` write at `src/components/ui/sidebar.tsx:68`, which is
//     library code no screen in this app mounts and which appears in zero files under `dist/` — but the reason
//     clause is not: the publish panel now links out to WhatsApp (`src/components/invitation/PublicationPanel.tsx:258`).
//     A denial that is right for a reason that has gone stale reads as careful and is a guess, so the sentence
//     now separates "no cookie" from "no integration".
//   * "A monitored contact address will be published alongside the production release." `/support` and
//     `/my-data` are in the product (`src/App.tsx:68-69`), so the channel exists; what is genuinely still
//     missing is a published email address, and that is what this page now says.
//
// The consent band is described as it behaves: it has one action, "Got it", and no decline. Saying so is only
// honest because there are no optional stores to decline out of — which the census above is the evidence for.

import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import { PRODUCT } from "@/config/product";

const CookiePolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-4">Cookie &amp; Storage Policy</h1>
        <div className="bg-muted border border-border rounded-xl p-4 mb-6 text-sm text-muted-foreground">
          Provisional policy for {PRODUCT.name}, an early development-stage product. This describes what this build
          actually stores in your browser today.
        </div>
        <p className="text-muted-foreground mb-6">Last updated: November 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What This Build Stores</h2>
        <p className="text-sm text-muted-foreground mb-2">
          This build sets no advertising, analytics, or third-party cookies. Two things are stored in your
          browser, both in local storage:
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>Authentication session</strong> — kept by Supabase Auth in local storage so you
            stay signed in. This is local storage, not an HttpOnly server-set cookie.</li>
          <li><strong>Notice acknowledgement</strong> — one flag, written when you press "Got it" on the
            privacy notice on the public site, so the notice stays dismissed. It records that you were
            shown it, not that you agreed to anything optional.</li>
        </ul>
        <p className="text-sm text-muted-foreground mt-2">
          Nothing else. There is no optional storage to decline, and the notice asks for none.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Not Used in This Build</h2>
        <p className="text-sm text-muted-foreground">
          To be explicit: this build uses no analytics cookies, sets no Razorpay or PhonePe cookie, and
          sets no WhatsApp cookie — the sharing panel's link to WhatsApp passes your invitation's address
          to them when you press it, and writes nothing here. It also implements no CSRF token, because
          there is no cookie-based session for one to protect: your sign-in is held in local storage and
          sent as a header. If any of those become true, this page is the place the change has to be
          written down.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Managing Stored Data</h2>
        <p className="text-sm text-muted-foreground">
          You can clear this site's local storage through your browser settings at any time. Clearing
          the session signs you out, and clearing the acknowledgement brings the notice back. Neither
          reaches anything stored on our side: what we hold about your invitation is described in the
          privacy policy, and asking for a copy of it or for its removal happens through the support and
          data pages, not through your browser.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          The channels are in the product: sign in and use <strong>/support</strong> or{' '}
          <strong>/my-data</strong>. There is no published email address for this preview yet, and none
          is collected to send one.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default CookiePolicy;
