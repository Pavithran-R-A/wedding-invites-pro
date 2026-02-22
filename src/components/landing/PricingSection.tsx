import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

const tiers = [
  {
    name: "Starter",
    price: "₹199",
    description: "Project creation + up to 50 guests",
    guestAddon: "₹99",
    features: [
      "1 wedding project",
      "Up to 50 guests",
      "All templates included",
      "WhatsApp & QR sharing",
      "RSVP management",
      "CSV guest export",
      "PDF download",
    ],
    highlight: false,
  },
  {
    name: "Family",
    price: "₹448",
    description: "Project + up to 150 guests",
    guestAddon: "₹249",
    features: [
      "Everything in Starter",
      "Up to 150 guests",
      "Meal tracking dashboard",
      "Elder approval flow",
      "Print ordering",
      "Priority support",
    ],
    highlight: true,
  },
  {
    name: "Grand",
    price: "₹598",
    description: "Project + up to 300 guests",
    guestAddon: "₹399",
    features: [
      "Everything in Family",
      "Up to 300 guests",
      "Accommodation tracking",
      "Transport management",
      "Printable meal reports",
      "Activity audit log",
    ],
    highlight: false,
  },
  {
    name: "Royal",
    price: "₹898",
    description: "Project + unlimited guests",
    guestAddon: "₹699",
    features: [
      "Everything in Grand",
      "Unlimited guests",
      "Multiple events support",
      "Bulk reminders",
      "Dedicated account manager",
      "Custom branding",
    ],
    highlight: false,
  },
];

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
            Simple, Honest Pricing
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Pay per project. No subscriptions, no surprises. Every tier includes all templates.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            All prices include ₹199 project creation fee
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {tiers.map((tier, index) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <Card className={`relative h-full flex flex-col ${tier.highlight ? "border-primary shadow-lg shadow-primary/10 scale-[1.02]" : "border-border/50"}`}>
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                    Most Popular
                  </div>
                )}
                <CardHeader className="text-center pb-4">
                  <CardTitle className="font-display text-xl">{tier.name}</CardTitle>
                  <div className="mt-3">
                    <span className="text-3xl font-bold">{tier.price}</span>
                    <span className="text-muted-foreground text-sm ml-1">/ project</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{tier.description}</p>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <ul className="space-y-3 flex-1 mb-6">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full rounded-xl"
                    variant={tier.highlight ? "default" : "outline"}
                  >
                    Get Started
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="text-center mt-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <p className="text-sm text-muted-foreground">
            Need add-ons? Branded QR ₹99 · Seating planner ₹199 · Priority design from ₹999
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default PricingSection;
