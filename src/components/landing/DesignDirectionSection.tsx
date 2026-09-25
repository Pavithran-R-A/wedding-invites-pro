import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PRODUCT } from "@/config/product";

const directions = [
  {
    title: "Tamil + English Traditional",
    script: "தமிழ் · English",
    character:
      "A dominant heading block, ruled function sections and space for both the Tamil and English wording side by side.",
  },
  {
    title: "Telugu Ceremonial",
    script: "తెలుగు",
    character:
      "A tall display line for the Telugu heading, with a compact English summary underneath for wider family readers.",
  },
  {
    title: "Malayalam Elegant",
    script: "മലയാളം",
    character:
      "Lighter gold detail, wider line spacing and a softer paper tone that keeps long invitations calm on a phone screen.",
  },
  {
    title: "Kannada Classic",
    script: "ಕನ್ನಡ",
    character:
      "A centred, structured composition with a strong hierarchy for names, dates, functions and places.",
  },
  {
    title: "Contemporary South Indian",
    script: "English",
    character:
      "Minimal ornament, larger type and more whitespace for families who prefer restraint over decoration.",
  },
  {
    title: "Bilingual Family Invitation",
    script: "தமிழ் · తెలుగు · English",
    character:
      "A parallel two-script layout so elders and younger relatives can read the same card comfortably.",
  },
];

const DesignDirectionSection = () => {
  return (
    <section id="design-directions" className="bg-surface py-20 md:py-28">
      <div className="container px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="mb-4 font-display text-3xl font-bold text-ink md:text-4xl">
            Invitation Design Directions
          </h2>
          <p className="text-lg leading-relaxed text-ink-muted">
            These are visual directions we are exploring for {PRODUCT.name}, not
            finished templates. The script samples show the typefaces we are
            testing; the wording, motifs and layout rules still need cultural
            review.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {directions.map((direction) => (
            <li
              key={direction.title}
              className="flex flex-col overflow-hidden rounded-2xl border border-line/70 bg-paper"
            >
              {/* Deliberately an abstract sheet, not a finished invitation. */}
              <div
                className="flex h-40 flex-col items-center justify-center gap-3 bg-paper px-6 text-center"
                aria-hidden="true"
              >
                <span className="h-px w-16 bg-gold/60" />
                <span className="font-display text-lg font-semibold text-ceremonial">
                  {direction.script}
                </span>
                <span className="h-1.5 w-24 rounded-full bg-ink/10" />
                <span className="h-1.5 w-16 rounded-full bg-ink/10" />
                <span className="h-px w-16 bg-gold/60" />
              </div>

              <div className="flex flex-1 flex-col gap-3 border-t border-line/70 p-6">
                <span className="w-fit rounded-full border border-gold/50 bg-gold/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ceremonial">
                  Preview concept
                </span>
                <h3 className="font-display text-xl font-semibold text-ink">
                  {direction.title}
                </h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {direction.character}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-12 text-center">
          <p className="mb-4 text-sm text-ink-muted">
            These directions are not the same thing as the designs currently
            loaded in the preview, and none of them is purchasable yet.
          </p>
          <Button variant="outline" size="lg" className="rounded-xl" asChild>
            <Link to="/signup">Create an Invitation Draft</Link>
          </Button>
        </div>
      </div>
    </section>
  );
};

export default DesignDirectionSection;
