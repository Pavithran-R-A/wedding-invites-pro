import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { formatPaise, BASE_FEE, FEATURES } from "@/lib/pricing";
import { Check, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const featureList = Object.entries(FEATURES).filter(([, f]) => f.price > 0).slice(0, 8);
const includedList = Object.entries(FEATURES).filter(([, f]) => 'included' in f && f.included);

const PricingSection = () => {
  return (
    <section className="py-20 md:py-28 bg-muted/30">
      <div className="container px-4 md:px-6">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Pay Only for What You Need
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            No bundles, no hidden fees. Pick exactly the features your wedding needs.
          </p>
        </motion.div>

        {/* Base fee card */}
        <motion.div
          className="max-w-lg mx-auto mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div className="bg-card border-2 border-primary/30 rounded-2xl p-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">Start with</p>
            <p className="font-display text-4xl font-bold text-primary mb-2">{formatPaise(BASE_FEE)}</p>
            <p className="text-sm text-muted-foreground mb-4">One-time project creation fee</p>
            <div className="space-y-2 text-left max-w-xs mx-auto mb-6">
              {includedList.map(([key, feat]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-accent shrink-0" />
                  <span>{feat.label} — <span className="text-accent font-medium">Free</span></span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-accent shrink-0" />
                <span>All templates included</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-accent shrink-0" />
                <span>Full editor access</span>
              </div>
            </div>
            <Button size="lg" className="rounded-xl w-full max-w-xs" asChild>
              <Link to="/signup">
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </motion.div>

        {/* A la carte features grid */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <h3 className="font-display text-xl font-semibold text-center mb-6">Add Features à la Carte</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
            {featureList.map(([key, feat], index) => (
              <motion.div
                key={key}
                className="border border-border rounded-xl p-4 bg-card hover:border-primary/30 transition-colors"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-medium">{feat.label}</span>
                  <span className="text-sm font-bold text-primary">{formatPaise(feat.price)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{feat.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.p
          className="text-center mt-8 text-sm text-muted-foreground"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          Guest pricing: 50 guests {formatPaise(9900)} · 150 guests {formatPaise(24900)} · 300 guests {formatPaise(39900)} · Unlimited {formatPaise(69900)}
        </motion.p>
      </div>
    </section>
  );
};

export default PricingSection;
