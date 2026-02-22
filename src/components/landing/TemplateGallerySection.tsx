import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const templates = [
  {
    name: "Tamil Traditional",
    language: "Tamil",
    style: "Classic kolam borders with brass lamp motifs",
    color: "bg-primary/10",
  },
  {
    name: "Telugu Grandeur",
    language: "Telugu",
    style: "Ornate gold frames with mango paisley designs",
    color: "bg-secondary/20",
  },
  {
    name: "Kannada Elegance",
    language: "Kannada",
    style: "Sandalwood-inspired floral patterns",
    color: "bg-accent/10",
  },
  {
    name: "Kerala Charm",
    language: "Malayalam",
    style: "Kasavu border with Nilavilakku motifs",
    color: "bg-secondary/15",
  },
  {
    name: "Modern Minimal",
    language: "English",
    style: "Clean lines with subtle mandala accents",
    color: "bg-muted",
  },
  {
    name: "Royal South",
    language: "Multi",
    style: "Bilingual layout with temple architecture borders",
    color: "bg-primary/5",
  },
];

const TemplateGallerySection = () => {
  return (
    <section className="py-20 md:py-28">
      <div className="container px-4 md:px-6">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Beautiful Templates
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Designs rooted in South Indian tradition, crafted for modern sharing
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template, index) => (
            <motion.div
              key={template.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.08 }}
            >
              <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300 cursor-pointer group border-border/50">
                <div className={`aspect-[3/4] ${template.color} flex items-center justify-center relative overflow-hidden`}>
                  <div className="text-center p-6">
                    <div className="w-24 h-32 mx-auto border-2 border-primary/20 rounded-lg flex items-center justify-center mb-4 bg-background/50 backdrop-blur-sm group-hover:scale-105 transition-transform duration-300">
                      <span className="font-display text-xs text-primary/60">Preview</span>
                    </div>
                    <p className="text-xs text-muted-foreground italic">{template.style}</p>
                  </div>
                </div>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-semibold">{template.name}</h3>
                    <Badge variant="secondary" className="text-xs">{template.language}</Badge>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TemplateGallerySection;
