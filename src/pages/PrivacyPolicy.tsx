import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-8">Privacy Policy</h1>
        <p className="text-muted-foreground mb-6">Last updated: February 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Data We Collect</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>Account information: name, email address, phone number</li>
          <li>Project data: invite designs, guest lists, RSVP responses</li>
          <li>Payment information: processed securely via Razorpay — we never store card details</li>
          <li>Usage data: pages visited, features used, device information</li>
          <li>Cookies: essential session cookies and optional analytics cookies</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">How We Use Your Data</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>To provide and improve our wedding invitation services</li>
          <li>To process payments and manage print orders</li>
          <li>To send transactional emails (order confirmations, RSVP notifications)</li>
          <li>To ensure platform security and prevent fraud</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Payment Handling</h2>
        <p className="text-sm text-muted-foreground">
          All payments are processed securely through Razorpay, a PCI-DSS compliant payment gateway.
          We do not store, process, or have access to your full card number, expiry date, or CVV.
          Only transaction IDs and payment status are stored in our system.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Data Retention</h2>
        <p className="text-sm text-muted-foreground">
          Your account and project data is retained for 12 months after your last login.
          Payment records are retained for 7 years as required by Indian tax law.
          You may request early deletion of your account data at any time.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Data Deletion</h2>
        <p className="text-sm text-muted-foreground">
          To request deletion of your account and all associated data, email us at{" "}
          <a href="mailto:privacy@yourinvite.in" className="text-primary underline">privacy@yourinvite.in</a>.
          We will process your request within 30 days and confirm deletion via email.
          Note: payment records cannot be deleted due to legal requirements.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Your Rights</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>Access your personal data at any time from your dashboard</li>
          <li>Export your guest lists and project data</li>
          <li>Request correction of inaccurate information</li>
          <li>Request deletion of your account</li>
          <li>Opt out of non-essential cookies</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          For any privacy-related queries, email{" "}
          <a href="mailto:privacy@yourinvite.in" className="text-primary underline">privacy@yourinvite.in</a>.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
