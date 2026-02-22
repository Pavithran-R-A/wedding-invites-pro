import { motion } from "framer-motion";
import { Palette, Share2, Users, Printer } from "lucide-react";

const steps = [
  {
    icon: Palette,
    title: "Pick a Template",
    description: "Choose from beautiful South Indian wedding templates in your language and style.",
  },
  {
    icon: Share2,
    title: "Customize & Share",
    description: "Add your details, preview live, and share instantly via WhatsApp or QR code.",
  },
  {
    icon: Users,
    title: "Manage RSVPs",
    description: "Track guests, meal preferences, accommodation, and transport — all in real time.",
  },
  {
    icon: Printer,
    title: "Order Prints",
    description: "Send your design to partner printers. Choose paper, finish, and quantity.",
  },
];

const HowItWorksSection = () => {
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
            How It Works
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            From template to print-ready invite in minutes
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              className="relative text-center"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-5">
                <step.icon className="w-7 h-7" />
              </div>
              <div className="absolute -top-2 -left-2 w-8 h-8 rounded-full bg-secondary/20 text-secondary-foreground text-sm font-bold flex items-center justify-center">
                {index + 1}
              </div>
              <h3 className="font-display text-xl font-semibold mb-2">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
