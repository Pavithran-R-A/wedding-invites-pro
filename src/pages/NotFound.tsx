import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { PRODUCT } from "@/config/product";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <BrandLockup to="/" className="min-h-11 items-center" />
      <div>
        <h1 className="mb-2 font-display text-3xl font-bold">We could not find that page</h1>
        <p className="mb-6 text-muted-foreground">
          Nothing lives at this address on {PRODUCT.name}. If you followed a link
          from a message, it may be from a newer version of the product that does
          not exist yet.
        </p>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to the home page
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
