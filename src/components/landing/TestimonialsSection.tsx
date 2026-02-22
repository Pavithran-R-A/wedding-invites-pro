import { motion } from "framer-motion";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Priya & Karthik",
    location: "Chennai, Tamil Nadu",
    quote: "Our guests were amazed by how beautiful the digital invite looked. The Tamil wording was perfect — no mistakes.",
    stars: 5,
  },
  {
    name: "Lakshmi & Srinivas",
    location: "Hyderabad, Telangana",
    quote: "The RSVP tracking saved us so much stress. We knew exact meal counts 3 days before the wedding.",
    stars: 5,
  },
  {
    name: "Devika & Arun",
    location: "Kochi, Kerala",
    quote: "My mother-in-law approved the design with one tap on WhatsApp. Elder approval feature is genius!",
    stars: 5,
  },
  {
    name: "Kavitha & Rajesh",
    location: "Bengaluru, Karnataka",
    quote: "Print quality was stunning — gold foil on textured paper. Our relatives kept the card as a memento.",
    stars: 5,
  },
];

const TestimonialsSection = () => {
  return (
    <section className="py-20 md:py-28 bg-muted/30">
      <div className="container px-4 md:px-6">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Loved by Families
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Real stories from couples who created their perfect invite
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              className="bg-card border border-border rounded-xl p-6 space-y-3"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="flex gap-0.5">
                {Array.from({ length: t.stars }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-secondary text-secondary" />
                ))}
              </div>
              <p className="text-sm text-foreground leading-relaxed italic">"{t.quote}"</p>
              <div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.location}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
