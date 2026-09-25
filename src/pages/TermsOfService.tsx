import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import { PRODUCT } from "@/config/product";

const TermsOfService = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-4">Terms of Service</h1>
        <div className="bg-muted border border-border rounded-xl p-4 mb-6 text-sm text-muted-foreground">
          Provisional terms for an early development-stage product. This build is provided to let you
          create and preview invitation drafts. It is not a commercial service yet and this is not
          formal legal advice. The name {PRODUCT.name} is a working name and may change.
        </div>
        <p className="text-muted-foreground mb-6">Last updated: September 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Acceptance of Terms</h2>
        <p className="text-sm text-muted-foreground">
          By using {PRODUCT.name}, you agree to these terms. If you do not agree, please do not use it.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Current Scope of the Service</h2>
        <p className="text-sm text-muted-foreground">
          Today {PRODUCT.name} lets you create, style and privately save wedding invitation drafts. It
          does not yet provide paid plans, checkout, publishing, public invitation pages, guest RSVP
          collection, or print ordering. These terms deliberately avoid making promises about those
          features until they actually exist.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Payments and Refunds</h2>
        <p className="text-sm text-muted-foreground">
          No charges are made in this build, so there is currently nothing to pay for and no purchase
          to refund. Payment, pricing and refund terms will be introduced only when a real commerce
          system is available.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Your Content</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>You are responsible for the names, dates and details you enter into your drafts.</li>
          <li>Content you create remains your property.</li>
          <li>You must not upload offensive, illegal, or infringing material.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Intellectual Property</h2>
        <p className="text-sm text-muted-foreground">
          Design assets made available within the platform are licensed for use
          in your invitations on this platform only; you may not redistribute or resell them.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Disclaimer and Liability</h2>
        <p className="text-sm text-muted-foreground">
          The service is provided "as is" without warranties of any kind. Because this is an
          unfinished development-stage product, we do not guarantee availability or fitness for a
          particular purpose, and we are not liable for indirect or consequential damages arising
          from its use.
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

export default TermsOfService;
