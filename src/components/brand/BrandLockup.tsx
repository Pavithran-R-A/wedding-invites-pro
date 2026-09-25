import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/config/product";

interface BrandLockupProps {
  /** `compact` for headers, `full` for footers and auth screens. */
  variant?: "compact" | "full";
  /** `inverse` for dark surfaces. */
  tone?: "brand" | "inverse";
  /** When set the lockup links there; when omitted it renders as text. */
  to?: string;
  className?: string;
}

/**
 * Splits a compound wordmark on its internal capital so a rename only touches
 * PRODUCT. Names without a second capital render as one tone.
 */
const splitWordmark = (name: string): [string, string] => {
  const parts = name.split(/(?=[A-Z])/);
  return parts.length > 1 ? [parts[0], parts.slice(1).join("")] : [name, ""];
};

const Wordmark = ({ className }: { className?: string }) => {
  const [emphasis, quiet] = splitWordmark(PRODUCT.name);
  return (
    <span className={cn("font-display font-bold tracking-tight whitespace-nowrap", className)}>
      {/* The two-tone split is decorative: it keeps the name in one node for AT. */}
      <span aria-hidden="true">{emphasis}</span>
      <span aria-hidden="true" className="opacity-70">
        {quiet}
      </span>
      <span className="sr-only">{PRODUCT.name}</span>
    </span>
  );
};

export const BrandLockup = ({ variant, tone = "brand", to, className }: BrandLockupProps) => {
  const inverse = tone === "inverse";

  const body =
    variant === "full" ? (
      <span className="flex flex-col gap-1">
        <Wordmark className="text-2xl leading-none" />
        <span
          className={cn(
            "text-sm font-medium tracking-wide",
            inverse ? "opacity-70" : "text-muted-foreground",
          )}
        >
          {PRODUCT.descriptor} · {PRODUCT.status}
        </span>
      </span>
    ) : (
      <Wordmark className="text-xl leading-none" />
    );

  if (!to) {
    return <span className={cn("inline-flex", className)}>{body}</span>;
  }

  return (
    <Link
      to={to}
      className={cn(
        "inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {body}
    </Link>
  );
};

export default BrandLockup;
