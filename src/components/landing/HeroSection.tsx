import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCT } from "@/config/product";

const HeroSection = () => {
  return (
    <section className="relative flex items-center overflow-hidden py-16 md:py-24 lg:min-h-[80vh]">
      {/* Paper ground with a warm grain, in place of a SaaS gradient hero. */}
      <div className="absolute inset-0 bg-gradient-to-b from-paper via-surface to-paper" aria-hidden="true" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.5'/%3E%3C/svg%3E")`,
        }}
      />
      {/* Two ceremonial rules: the edge of a patrika sheet. */}
      <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-gold/50 to-transparent" aria-hidden="true" />
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-gold/50 to-transparent" aria-hidden="true" />

      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">
              {PRODUCT.name}
            </span>
            <span className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ceremonial">
              {PRODUCT.status}
            </span>
          </div>

          {/* text-gold measured 2.5:1 on paper — decorative tone is not legible as copy. */}
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-ceremonial">
            {PRODUCT.descriptor}
          </p>

          <h1 className="mb-6 font-display text-4xl font-bold leading-[1.15] tracking-tight text-ink sm:text-5xl md:text-6xl">
            {PRODUCT.tagline}
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg">
            A South-India-first digital wedding invitation that keeps the structure,
            dignity and family feeling of a traditional patrika. Today you can create
            and preview an invitation draft.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              className="w-full rounded-xl text-base px-8 py-6 sm:w-auto"
              asChild
            >
              <Link to="/signup">
                Create an Invitation Draft
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full rounded-xl text-base px-8 py-6 sm:w-auto"
              asChild
            >
              <a href="#design-directions">Explore design directions</a>
            </Button>
          </div>

          <p className="mt-8 text-sm text-ink-muted">
            Drafts are free while {PRODUCT.name} is in preview. Sharing, RSVP,
            publishing and payment are not available yet.
          </p>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
