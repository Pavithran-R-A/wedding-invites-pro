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
  "The people, the venues and each function, entered as rows you can add, edit, reorder and remove",
  "Styling preview and persistence code: font, size, colour, alignment and a simulated foil overlay",
  "The wording a guest reads, written and saved in four passages",
  "Freezing a draft as an immutable version, and publishing a chosen version as one link",
  "A public invitation page guests open without an account, and taking a link back down",
  "One link per guest household, scoped to what that household is invited to",
  "Replies collected through that link, and read back on your own invitation screen",
  "A reviewer link that sends one frozen version to a family reader for their answer",
  "A QR plate for the version you published, and printable files generated from it",
  "A support screen that writes to a queue a person reads, and a My data screen for a copy request "
    + "or a removal request",
];

/**
 * What is genuinely not in the build. Every item here was checked against `src/` rather than against a
 * roadmap: there is no checkout address in the product, no sending service that reaches a guest on the
 * host's behalf, no door that hands back a data copy without a person, and no tradition pack that a
 * reader of the language it writes has signed off — the only approved releases this repository has ever
 * carried are labelled, in the product's own words, as a test fixture rather than a real review.
 */
const plannedForV1 = [
  "Payment and checkout",
  "Reviewed pack wording that a reader of that language has signed off",
  "Sending the invitation to your guests for you — you still send the link yourself",
  "A data copy or removal prepared by the software rather than by a person reading your request",
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-20 md:py-28">
      <div className="container px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="mb-4 font-display text-3xl font-bold text-ink md:text-4xl">
            How {PRODUCT.name} works
          </h2>
          <p className="text-lg leading-relaxed text-ink-muted">
            The flow below is what this build does today, step by step, on a local
            deployment. What is not built is listed beside it, and the note under the
            lists says what has not been verified.
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
              The signed-in create, configure, edit, publish and guest-viewing flows
              were exercised end to end against a local Supabase stack. Nothing here
              has been exercised against a hosted deployment, and nothing is deployed.
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
