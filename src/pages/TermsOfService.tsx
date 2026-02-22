import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const TermsOfService = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-8">Terms of Service</h1>
        <p className="text-muted-foreground mb-6">Last updated: February 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Acceptance of Terms</h2>
        <p className="text-sm text-muted-foreground">
          By using YourInvite, you agree to these terms. If you do not agree, please do not use our services.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Services</h2>
        <p className="text-sm text-muted-foreground">
          YourInvite provides digital wedding invitation creation, customization, guest management,
          and optional print ordering services. Features are available on an à la carte basis.
        </p>

        <div className="bg-primary/5 border-2 border-primary/30 rounded-xl p-6 my-8">
          <h2 className="font-display text-xl font-bold text-primary mb-3">Refund Policy</h2>
          <p className="text-sm font-semibold text-foreground mb-2">
            All payments are final. No refunds after purchase.
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
            <li>Digital purchases (base fee, features, design services) are non-refundable</li>
            <li>Print orders are final once submitted to the printer</li>
            <li>Payment processing fees are non-refundable</li>
          </ul>
        </div>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Print Orders</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>Print orders are processed by third-party print partners</li>
          <li>Once a print order is placed, it cannot be cancelled or modified</li>
          <li>YourInvite is not responsible for delays caused by the printer or shipping provider</li>
          <li>Delivery timelines are estimates and may vary by region</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">User Responsibilities</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>You are responsible for correct spelling</strong> of all names, venues, and dates before placing a print order</li>
          <li>YourInvite is not liable for errors in content provided by the user</li>
          <li>You must not upload offensive, illegal, or copyrighted material</li>
          <li>You must not use the platform to send unsolicited messages</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Intellectual Property</h2>
        <p className="text-sm text-muted-foreground">
          Templates, motifs, and design assets provided by YourInvite are licensed for use within
          the platform only. You may not redistribute or resell these assets.
          Content you create (text, uploaded images) remains your property.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Limitation of Liability</h2>
        <p className="text-sm text-muted-foreground">
          YourInvite is provided "as is" without warranties. We are not liable for any indirect,
          incidental, or consequential damages arising from use of the platform.
          Our total liability is limited to the amount you paid for the specific service.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          For questions about these terms, email{" "}
          <a href="mailto:legal@yourinvite.in" className="text-primary underline">legal@yourinvite.in</a>.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default TermsOfService;
