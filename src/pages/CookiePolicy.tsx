import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const CookiePolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-8">Cookie Policy</h1>
        <p className="text-muted-foreground mb-6">Last updated: February 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What Are Cookies</h2>
        <p className="text-sm text-muted-foreground">
          Cookies are small text files stored on your device when you visit our website.
          They help us provide a better experience and understand how you use our platform.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Essential Cookies</h2>
        <p className="text-sm text-muted-foreground mb-2">
          These cookies are necessary for the website to function. They cannot be disabled.
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>Session cookie</strong> — keeps you logged in securely (HttpOnly, SameSite=Strict)</li>
          <li><strong>CSRF token</strong> — prevents cross-site request forgery</li>
          <li><strong>Cookie consent</strong> — remembers your cookie preferences</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Analytics Cookies</h2>
        <p className="text-sm text-muted-foreground mb-2">
          These help us understand how visitors use our site. Only enabled with your consent.
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>Page views</strong> — which pages are most visited</li>
          <li><strong>Feature usage</strong> — which features are popular</li>
          <li><strong>Performance</strong> — page load times and errors</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Third-Party Cookies</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>Razorpay</strong> — payment processing (set during checkout only)</li>
          <li><strong>WhatsApp</strong> — sharing integration (set when sharing invite links)</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Managing Cookies</h2>
        <p className="text-sm text-muted-foreground">
          You can control cookie preferences using the cookie consent banner that appears on your
          first visit. You can also clear cookies through your browser settings at any time.
          Note: disabling essential cookies will prevent you from using the platform.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          Questions about cookies? Email{" "}
          <a href="mailto:privacy@yourinvite.in" className="text-primary underline">privacy@yourinvite.in</a>.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default CookiePolicy;
