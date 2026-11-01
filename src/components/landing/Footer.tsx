import { Link } from "react-router-dom";
import { Separator } from "@/components/ui/separator";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { PRODUCT } from "@/config/product";

// Absolute so the links stay valid when the footer renders on a legal page,
// where a bare "#design-directions" fragment would resolve to nothing.
const productLinks = [
  { label: "Design directions", href: "/#design-directions" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Product idea", href: "/#product-idea" },
];

const legalLinks = [
  { label: "Privacy Policy", to: "/privacy-policy" },
  { label: "Terms of Service", to: "/terms-of-service" },
  { label: "Cookie Policy", to: "/cookie-policy" },
];

const Footer = () => {
  return (
    <footer className="bg-ink text-paper">
      <div className="container px-4 py-16 md:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
          <div className="md:col-span-1">
            <BrandLockup variant="full" tone="inverse" to="/" />
            <p className="mt-4 text-sm leading-relaxed text-paper/60">
              {PRODUCT.tagline} A digital wedding patrika made for the way South
              Indian families actually invite people.
            </p>
          </div>

          <nav aria-label="Product">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-paper">
              Product
            </h2>
            <ul className="space-y-0.5">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="block py-3 text-sm text-paper/60 transition-colors hover:text-paper"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-paper">
              Legal
            </h2>
            <ul className="space-y-0.5">
              {legalLinks.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="block py-3 text-sm text-paper/60 transition-colors hover:text-paper"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <Separator className="my-8 bg-paper/10" />

        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <p className="text-sm text-paper/60">
            © {new Date().getFullYear()} {PRODUCT.name}. {PRODUCT.status} — the
            feature set and brand name are still provisional.
          </p>
          <p className="text-sm text-paper/60">
            No checkout in this build, nothing hosted yet, and no reviewed pack wording has been
            signed off by a reader of the language it writes.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
