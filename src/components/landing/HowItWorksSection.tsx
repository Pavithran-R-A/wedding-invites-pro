import { Check, CircleDashed } from "lucide-react";
import { PRODUCT } from "@/config/product";

const targetFlow = [
  "Create an account and start an invitation",
  "Choose a design direction and the languages the family will read",
  "Enter the couple, the families inviting, and each function with its time and place",
  "Review the invitation as a patrika-style preview, with family approval on the exact version",
  "Publish one link, and share it with each guest household",
  "Guests open it on their phone, see only what they are invited to, and reply",
];

const implementedFoundations = [
  "Authentication screens and Supabase Auth integration",
  "Protected account routes that redirect while you are signed out",
  "Invitation draft creation flow, with design direction and language selection",
  "Planning guest-count persistence code for your own draft",
  "Styling preview and persistence code: font, size, colour, alignment and a simulated foil overlay",
  "The wording a guest reads, written and saved in four passages",
  "Freezing a draft as an immutable version, and publishing a chosen version as one link",
  "A public invitation page guests open without an account, and taking a link back down",
];

const plannedForV1 = [
  "Structured wedding, family and event details",
  "Family approval tied to a specific invitation version",
  "Personalised guest links and household scoping",
  "RSVP replies and an export of the guest list",
  "QR code and PDF output for printing",
  "Payment and checkout",
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-20 md:py-28">
      <div className="container px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="mb-4 font-display text-3xl font-bold text-ink md:text-4xl">
            How {PRODUCT.name} is intended to work
          </h2>
          <p className="text-lg leading-relaxed text-ink-muted">
            The target flow below is what we are building towards. Only the items in
            &ldquo;Implemented foundations in this preview&rdquo; are present in the
            codebase today.
          </p>
        </div>

        <ol className="mx-auto mb-14 grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {targetFlow.map((step, index) => (
            <li
              key={step}
              className="rounded-xl border border-line/70 bg-surface p-5"
            >
              <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-ceremonial">
                {index + 1}
              </span>
              <p className="text-sm leading-relaxed text-ink">{step}</p>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-success/40 bg-surface p-6 md:p-8">
            <h3 className="mb-1 font-display text-xl font-semibold text-ink">
              Implemented foundations in this preview
            </h3>
            <p className="mb-5 text-sm text-ink-muted">
              These pieces exist in the current codebase. Account-backed
              persistence still requires a verified Supabase environment.
            </p>
            <ul className="space-y-3">
              {implementedFoundations.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-line pt-4 text-sm text-ink-muted">
              The signed-in create, dashboard, configure and styling flows were not
              exercised end to end against a live backend during this stage.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-6 md:p-8">
            <h3 className="mb-1 font-display text-xl font-semibold text-ink">
              Planned for V1
            </h3>
            <p className="mb-5 text-sm text-ink-muted">
              Not built yet. No date to promise you.
            </p>
            <ul className="space-y-3">
              {plannedForV1.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-muted">
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
