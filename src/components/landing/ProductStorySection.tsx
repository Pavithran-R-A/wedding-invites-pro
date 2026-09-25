import { BookMarked, Languages, Smartphone, Users } from "lucide-react";

const principles = [
  {
    icon: BookMarked,
    title: "Patrika-first",
    description:
      "The invitation is the product. It should read like a cared-for wedding card, not a form receipt.",
  },
  {
    icon: Users,
    title: "Family-readable",
    description:
      "Elders and relatives are the first audience, so clarity and comfortable text come before effects.",
  },
  {
    icon: Languages,
    title: "Language-conscious",
    description:
      "Tamil, Telugu, Kannada and Malayalam are first-class, with language always chosen by the family.",
  },
  {
    icon: Smartphone,
    title: "Mobile-first",
    description:
      "Invitations are opened on phones and in chat, so the small screen is the main design target.",
  },
];

const ProductStorySection = () => {
  return (
    <section id="product-idea" className="bg-surface py-20 md:py-28">
      <div className="container px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="mb-4 font-display text-3xl font-bold text-ink md:text-4xl">
            A wedding invitation is more than a date and venue
          </h2>
          <p className="text-lg leading-relaxed text-ink-muted">
            It is the first thing families send. It carries names, blessings,
            the shape of the functions and the tone of the household. A digital
            invitation earns its place only when it keeps that dignity intact —
            which is the standard we hold ourselves to.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((principle) => (
            <li
              key={principle.title}
              className="rounded-2xl border border-line/70 bg-paper p-6"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-ceremonial/10 text-ceremonial">
                <principle.icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="mb-2 font-display text-lg font-semibold text-ink">
                {principle.title}
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                {principle.description}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-sm text-ink-muted">
          These are design commitments for the product, not a claim that every
          one is fully implemented today.
        </p>
      </div>
    </section>
  );
};

export default ProductStorySection;
