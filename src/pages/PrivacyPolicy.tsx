import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import { PRODUCT } from "@/config/product";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-4">Privacy Policy</h1>
        <div className="bg-muted border border-border rounded-xl p-4 mb-6 text-sm text-muted-foreground">
          Provisional policy for {PRODUCT.name}, an early development-stage product. This is a
          pre-launch build; the
          features and data practices described below reflect what this build actually does today and
          will be updated as the product matures. This is not formal legal advice.
        </div>
        <p className="text-muted-foreground mb-6">Last updated: September 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Data We Collect</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>Account information you provide at sign-up: your name and email address.</li>
          <li>Invitation drafts you create: the draft name, chosen language, selected design, and styling settings.</li>
          <li>An estimated guest count you choose to store as a planning note.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">How Your Session Is Stored</h2>
        <p className="text-sm text-muted-foreground">
          When you sign in, your authentication session is stored by Supabase Auth in your browser's
          local storage. This is a browser storage mechanism, not an HttpOnly server-set session
          cookie. Clearing your browser storage signs you out.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Payments</h2>
        <p className="text-sm text-muted-foreground">
          This build does not process payments and does not take, store, or have access to card
          details, bank information, or any payment credentials. There is currently no checkout.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Analytics and Tracking</h2>
        <p className="text-sm text-muted-foreground">
          This build does not run advertising or analytics trackers and does not set analytics
          cookies. This preview currently loads font files from Google Fonts, so your browser makes
          requests to Google's font-serving domains when loading the site.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Data Retention and Deletion</h2>
        <p className="text-sm text-muted-foreground">
          Your account and drafts are retained while your account exists. Automated retention windows
          and self-service export/deletion are not yet implemented in this build. A support and
          deletion-request channel will be provided in a later release.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Access Control</h2>
        <p className="text-sm text-muted-foreground">
          Your project and guest data is isolated per account using Supabase row-level security, so
          other signed-in users cannot read or modify it.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          A monitored privacy contact will be published alongside the production release.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
