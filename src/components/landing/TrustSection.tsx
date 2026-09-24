import { motion } from "framer-motion";
import { Palette, ShieldCheck, Save, Heart } from "lucide-react";

const signals = [
  {
    icon: Palette,
    text: "Design & preview invites",
  },
  {
    icon: ShieldCheck,
    text: "Data protected by row-level security",
  },
  {
    icon: Save,
    text: "Save drafts to your account",
  },
  {
    icon: Heart,
    text: "Crafted for South Indian weddings",
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
