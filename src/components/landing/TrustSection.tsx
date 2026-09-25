import { Palette, ShieldCheck, Save, Heart } from "lucide-react";

const signals = [
  {
    icon: Palette,
    text: "Draft creation and styling foundation",
  },
  {
    icon: ShieldCheck,
    text: "Row-level security covered by an SQL test suite",
  },
  {
    icon: Save,
    text: "Designed around private, account-owned drafts",
  },
  {
    icon: Heart,
    text: "Built for South Indian weddings first",
  },
];

const TrustSection = () => {
  return (
    <section className="border-y border-line/70 bg-paper py-10">
      <div className="container px-4 md:px-6">
        <ul className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {signals.map((signal) => (
            <li key={signal.text} className="flex items-center gap-2 text-ink-muted">
              <signal.icon className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
              <span className="text-sm font-medium">{signal.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default TrustSection;
