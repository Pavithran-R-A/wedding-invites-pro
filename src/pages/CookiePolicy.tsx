import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const CookiePolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-4">Cookie &amp; Storage Policy</h1>
        <div className="bg-muted border border-border rounded-xl p-4 mb-6 text-sm text-muted-foreground">
          Provisional policy for an early development-stage product. This describes what this build
          actually stores in your browser today.
        </div>
        <p className="text-muted-foreground mb-6">Last updated: September 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What This Build Stores</h2>
        <p className="text-sm text-muted-foreground mb-2">
          This build does not set advertising, analytics, or third-party cookies. It stores a small
          amount of data in your browser's local storage:
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>Authentication session</strong> — kept by Supabase Auth in local storage so you
            stay signed in. This is local storage, not an HttpOnly server-set cookie.</li>
          <li><strong>Cookie-consent acknowledgement</strong> — a single flag recording that you dismissed
            the privacy notice.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Not Used in This Build</h2>
        <p className="text-sm text-muted-foreground">
          To be explicit: this build currently does not use analytics cookies, does not implement a
          CSRF token, and sets no Razorpay, PhonePe, or WhatsApp cookies, because those features are
          not present yet. If they are introduced later, this policy will be updated accordingly.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Managing Stored Data</h2>
        <p className="text-sm text-muted-foreground">
          You can clear this site's local storage through your browser settings at any time. Clearing
          the session signs you out.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          A monitored contact address will be published alongside the production release.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default CookiePolicy;
