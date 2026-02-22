import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const templates = [
  {
    name: "Tamil Traditional",
    language: "Tamil",
    style: "Classic kolam borders with brass lamp motifs",
    bride: "Meenakshi",
    groom: "Karthik",
    venue: "Sri Meenakshi Temple Hall, Madurai",
    date: "14th February 2026",
    motif: "🪔",
    snippet: "அன்புடன் அழைக்கிறோம்",
    gradient: "from-primary/15 via-secondary/10 to-primary/5",
    foilAccent: "bg-gradient-to-r from-secondary/60 via-secondary/30 to-secondary/60",
  },
  {
    name: "Telugu Grandeur",
    language: "Telugu",
    style: "Ornate gold frames with mango paisley designs",
    bride: "Lakshmi",
    groom: "Venkatesh",
    venue: "Tirumala Convention Centre, Hyderabad",
    date: "22nd March 2026",
    motif: "🥭",
    snippet: "ఆహ్వానం",
    gradient: "from-secondary/20 via-card to-secondary/10",
    foilAccent: "bg-gradient-to-r from-secondary/70 via-secondary/40 to-secondary/70",
  },
  {
    name: "Kannada Elegance",
    language: "Kannada",
    style: "Sandalwood-inspired floral patterns",
    bride: "Aishwarya",
    groom: "Prashanth",
    venue: "Palace Grounds, Bengaluru",
    date: "5th April 2026",
    motif: "🌸",
    snippet: "ಆಮಂತ್ರಣ ಪತ್ರಿಕೆ",
    gradient: "from-accent/10 via-card to-accent/5",
    foilAccent: "bg-gradient-to-r from-secondary/50 via-secondary/25 to-secondary/50",
  },
  {
    name: "Kerala Charm",
    language: "Malayalam",
    style: "Kasavu border with Nilavilakku motifs",
    bride: "Devika",
    groom: "Arun",
    venue: "Le Méridien, Kochi",
    date: "18th May 2026",
    motif: "🪷",
    snippet: "ക്ഷണക്കത്ത്",
    gradient: "from-secondary/15 via-card to-primary/5",
    foilAccent: "bg-gradient-to-r from-secondary/55 via-secondary/30 to-secondary/55",
  },
  {
    name: "Modern Minimal",
    language: "English",
    style: "Clean lines with subtle mandala accents",
    bride: "Priya",
    groom: "Arjun",
    venue: "The Leela Palace, Chennai",
    date: "10th June 2026",
    motif: "✨",
    snippet: "Together with their families",
    gradient: "from-muted via-card to-muted/50",
    foilAccent: "bg-gradient-to-r from-secondary/40 via-secondary/20 to-secondary/40",
  },
  {
    name: "Royal South",
    language: "Multi",
    style: "Bilingual layout with temple architecture borders",
    bride: "Kavitha",
    groom: "Rajesh",
    venue: "Chettinad Palace, Sivagangai",
    date: "28th July 2026",
    motif: "🏛️",
    snippet: "With blessings of the elders",
    gradient: "from-primary/10 via-secondary/5 to-card",
    foilAccent: "bg-gradient-to-r from-secondary/65 via-secondary/35 to-secondary/65",
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
              <Card className="overflow-hidden group border-border/50 hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 cursor-pointer hover:-translate-y-1">
                <div className={`aspect-[3/4] bg-gradient-to-b ${template.gradient} relative overflow-hidden p-6 flex flex-col items-center justify-center`}>
                  {/* Border decoration */}
                  <div className="absolute inset-3 border border-secondary/20 rounded-lg pointer-events-none" />
                  <div className="absolute inset-4 border border-secondary/10 rounded pointer-events-none" />

                  {/* Foil accent line */}
                  <div className={`absolute top-8 left-8 right-8 h-[1px] ${template.foilAccent} animate-shimmer bg-[length:200%_100%]`} />
                  <div className={`absolute bottom-8 left-8 right-8 h-[1px] ${template.foilAccent} animate-shimmer bg-[length:200%_100%]`} />

                  {/* Motif */}
                  <span className="text-3xl mb-3">{template.motif}</span>

                  {/* Language snippet */}
                  <p className="text-xs text-secondary font-medium mb-2 italic">{template.snippet}</p>

                  {/* Names */}
                  <p className="font-display text-lg font-bold text-foreground text-center leading-tight">
                    {template.bride} <span className="text-secondary">&</span> {template.groom}
                  </p>

                  {/* Date & Venue */}
                  <p className="text-xs text-muted-foreground mt-2 text-center">{template.date}</p>
                  <p className="text-[10px] text-muted-foreground/70 text-center mt-0.5 max-w-[80%]">{template.venue}</p>

                  {/* Hover CTA overlay */}
                  <div className="absolute inset-0 bg-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                    <Button size="sm" className="rounded-xl shadow-lg" asChild>
                      <Link to="/signup">Customize This</Link>
                    </Button>
                  </div>
                </div>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-semibold">{template.name}</h3>
                    <Badge variant="secondary" className="text-xs">{template.language}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{template.style}</p>
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
