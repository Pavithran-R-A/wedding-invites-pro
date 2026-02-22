import { motion } from "framer-motion";
import { Shield, CreditCard, Globe, Heart } from "lucide-react";

const signals = [
  {
    icon: Shield,
    text: "Secure Payments via Razorpay",
  },
  {
    icon: CreditCard,
    text: "No Hidden Charges",
  },
  {
    icon: Globe,
    text: "5 Languages Supported",
  },
  {
    icon: Heart,
    text: "Trusted by 1000+ Families",
  },
];

const TrustSection = () => {
  return (
    <section className="py-12 border-y border-border/50">
      <div className="container px-4 md:px-6">
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
          {signals.map((signal, index) => (
            <motion.div
              key={signal.text}
              className="flex items-center gap-2 text-muted-foreground"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <signal.icon className="w-5 h-5 text-secondary" />
              <span className="text-sm font-medium">{signal.text}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustSection;
