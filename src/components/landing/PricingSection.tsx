import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Shield, Lock, Printer, Check } from "lucide-react";
import { Link } from "react-router-dom";
import {
  FEATURES, FEATURE_CATEGORIES, BASE_FEE, PRICE_PER_GUEST,
  calculatePrice, formatPaise, type FeatureKey,
} from "@/lib/pricing";

const PricingSection = () => {
  const [selectedFeatures, setSelectedFeatures] = useState<FeatureKey[]>([]);
  const [guestCount, setGuestCount] = useState(100);

  const toggleFeature = (key: FeatureKey) => {
    setSelectedFeatures(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
  };

  const breakdown = useMemo(
    () => calculatePrice(selectedFeatures, guestCount),
    [selectedFeatures, guestCount]
  );

  const showPremiumMessage = breakdown.total > 100000;

  return (
    <section className="py-20 md:py-28">
      <div className="container px-4 md:px-6">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Add What You Need
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            No bundles. No hidden fees. Pick exactly the features your wedding needs.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Feature toggles */}
          <div className="lg:col-span-2 space-y-8">
            {/* Base fee info */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-semibold">Project Creation</span>
                <span className="font-bold text-primary">{formatPaise(BASE_FEE)}</span>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-accent shrink-0" /><span>Full editor access</span></div>
                <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-accent shrink-0" /><span>All templates included</span></div>
                <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-accent shrink-0" /><span>Hosted preview link</span></div>
              </div>
            </div>

            {/* Guest pricing */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-display font-semibold">Guest Count</span>
                <span className="text-sm text-muted-foreground">{formatPaise(PRICE_PER_GUEST)}/guest</span>
              </div>
              <input
                type="range"
                min={10}
                max={500}
                step={1}
                value={guestCount}
                onChange={e => setGuestCount(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{guestCount} guests</span>
                <span className="font-semibold text-primary">{formatPaise(guestCount * PRICE_PER_GUEST)}</span>
              </div>
            </div>

            {/* Feature categories */}
            {Object.entries(FEATURE_CATEGORIES).map(([catKey, catLabel]) => {
              const features = Object.entries(FEATURES).filter(([, f]) => f.category === catKey);
              if (features.length === 0) return null;
              return (
                <div key={catKey}>
                  <h3 className="font-display font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground">{catLabel}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {features.map(([key, feat]) => {
                      const isActive = selectedFeatures.includes(key as FeatureKey);
                      return (
                        <motion.button
                          key={key}
                          type="button"
                          onClick={() => toggleFeature(key as FeatureKey)}
                          className={`text-left border rounded-xl p-4 transition-all duration-200 ${
                            isActive
                              ? 'border-secondary bg-secondary/5 shadow-sm'
                              : 'border-border hover:border-secondary/30'
                          }`}
                          whileTap={{ scale: 0.98 }}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <span className="text-sm font-medium">{feat.label}</span>
                            <span className="text-sm font-bold text-primary ml-2">{formatPaise(feat.price)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{feat.description}</p>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Price meter sidebar */}
          <div>
            <div className="sticky top-20 space-y-4">
              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <h3 className="font-display text-lg font-semibold">Your Estimate</h3>

                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {breakdown.items.map((item) => (
                      <motion.div
                        key={item.label}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.18 }}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium">{formatPaise(item.amount)}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <div className="border-t border-border pt-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatPaise(breakdown.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">GST (18%)</span>
                    <span>{formatPaise(breakdown.gst)}</span>
                  </div>
                </div>

                <div className="border-t border-border pt-3">
                  <motion.div
                    className="flex justify-between"
                    key={breakdown.total}
                    initial={{ scale: 1.02 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="font-display font-semibold text-lg">Total</span>
                    <span className="font-display font-bold text-lg text-primary">{formatPaise(breakdown.total)}</span>
                  </motion.div>
                </div>

                {showPremiumMessage && (
                  <motion.p
                    className="text-xs text-secondary italic text-center pt-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    You're building a premium experience your guests will remember.
                  </motion.p>
                )}

                <Button size="lg" className="w-full rounded-xl mt-2" asChild>
                  <Link to="/signup">Get Started</Link>
                </Button>
              </div>

              {/* Trust indicators */}
              <div className="space-y-2 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Shield className="w-3.5 h-3.5 text-accent" />
                  <span>Secure Checkout · 256-bit encryption</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="w-3.5 h-3.5 text-accent" />
                  <span>SSL Encrypted · No hidden fees</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Printer className="w-3.5 h-3.5 text-accent" />
                  <span>Local Printers · Fast delivery</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
