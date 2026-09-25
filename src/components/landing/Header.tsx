import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { useAuth } from "@/components/auth/AuthProvider";

const landingNavItems = [
  { label: "Design directions", href: "#design-directions" },
  { label: "How it works", href: "#how-it-works" },
];

const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();
  const location = useLocation();
  const isLanding = location.pathname === "/";

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/85 backdrop-blur-lg">
      <div className="container flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <BrandLockup to={user ? "/dashboard" : "/"} className="h-full items-center" />

        {isLanding && (
          <nav className="hidden md:flex items-center gap-8" aria-label="Landing page sections">
            {landingNavItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard">My invitations</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={signOut}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">Log in</Link>
              </Button>
              <Button size="sm" className="rounded-lg" asChild>
                <Link to="/signup">Create a Draft</Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-line/60 bg-paper md:hidden"
          >
            <div className="container flex flex-col gap-4 px-4 py-4">
              {isLanding &&
                landingNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="flex min-h-11 items-center text-sm font-medium text-ink-muted hover:text-ink"
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              <div className="flex gap-3 pt-2">
                {user ? (
                  <>
                    <Button variant="outline" className="min-h-11 flex-1" asChild>
                      <Link to="/dashboard" onClick={() => setMobileOpen(false)}>
                        My invitations
                      </Link>
                    </Button>
                    <Button
                      className="min-h-11 flex-1"
                      onClick={() => {
                        signOut();
                        setMobileOpen(false);
                      }}
                    >
                      Log out
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="min-h-11 flex-1" asChild>
                      <Link to="/login" onClick={() => setMobileOpen(false)}>
                        Log in
                      </Link>
                    </Button>
                    <Button className="min-h-11 flex-1" asChild>
                      <Link to="/signup" onClick={() => setMobileOpen(false)}>
                        Create a Draft
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Header;
