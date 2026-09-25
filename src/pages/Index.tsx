import Header from "@/components/landing/Header";
import HeroSection from "@/components/landing/HeroSection";
import ProductStorySection from "@/components/landing/ProductStorySection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import DesignDirectionSection from "@/components/landing/DesignDirectionSection";
import TrustSection from "@/components/landing/TrustSection";
import Footer from "@/components/landing/Footer";
import CookieConsent from "@/components/landing/CookieConsent";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection />
        <TrustSection />
        <ProductStorySection />
        <HowItWorksSection />
        <DesignDirectionSection />
      </main>
      <Footer />
      <CookieConsent />
    </div>
  );
};

export default Index;
