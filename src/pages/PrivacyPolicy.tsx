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
          <li>The wording you write for an invitation, the versions you choose to freeze, and the record of a link you publish.</li>
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

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What a published invitation shares</h2>
        <p className="text-sm text-muted-foreground">
          Freezing a version and publishing it creates a public web address. Anyone who has that
          address can open the invitation without an account: its name, the wording you wrote, the
          names and ceremonies it contains, and the styling you chose. The address itself is the
          only access control — it is unguessable, but it is not a password, so anyone you forward
          it to can read the invitation and pass it on.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          A guest who opens it is shown a page and nothing else: no sign of your account, your
          email address, or any internal identifier of the wedding, the version or the link. The
          link is stored as a one-way digest, so the address cannot be recovered from the stored
          record. Taking a link down stops new visitors immediately, and a retired address cannot
          be reactivated.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          This build does not record who opened a published invitation: there is no analytics, no
          visit counter and no tracking of guests who follow a link.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Access Control</h2>
        <p className="text-sm text-muted-foreground">
          Your project and guest data is isolated per account using Supabase row-level security, so
          other signed-in users cannot read or modify it. A link you publish is the one deliberate
          exception, described above.
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
