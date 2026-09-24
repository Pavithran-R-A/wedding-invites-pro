import { motion } from "framer-motion";
import { Palette, Eye, Save } from "lucide-react";

const steps = [
  {
    icon: Palette,
    title: "Start a Draft",
    description: "Pick an available template and name your invitation to create a working draft.",
  },
  {
    icon: Eye,
    title: "Preview & Style",
    description: "Adjust text styling and see a live preview of your invitation.",
  },
  {
    icon: Save,
    title: "Save to Your Account",
    description: "Your draft is saved privately so you can come back and keep editing.",
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
            Design, preview and save your invitation — sharing, RSVP and printing arrive in later stages.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
