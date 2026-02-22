import Header from "@/components/landing/Header";
import HeroSection from "@/components/landing/HeroSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import TemplateGallerySection from "@/components/landing/TemplateGallerySection";
import PricingSection from "@/components/landing/PricingSection";
import TrustSection from "@/components/landing/TrustSection";
import TestimonialsSection from "@/components/landing/TestimonialsSection";
import Footer from "@/components/landing/Footer";
import CookieConsent from "@/components/landing/CookieConsent";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection />
        <TrustSection />
        <section id="how-it-works">
          <HowItWorksSection />
        </section>
        <section id="templates">
          <TemplateGallerySection />
        </section>
        <section id="pricing">
          <PricingSection />
        </section>
        <TestimonialsSection />
      </main>
      <Footer />
      <CookieConsent />
    </div>
  );
};

export default Index;
