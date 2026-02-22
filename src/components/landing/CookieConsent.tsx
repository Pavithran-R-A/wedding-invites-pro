import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = (level: string) => {
    localStorage.setItem("cookie-consent", level);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-4"
        >
          <div className="max-w-2xl mx-auto bg-card border border-border rounded-2xl shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h4 className="font-display font-semibold text-base mb-1">We value your privacy</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We use cookies to store your session and handle payments. Choose your preferences or accept essential cookies to proceed.
                </p>
              </div>
              <button onClick={() => accept("essential")} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="sm" onClick={() => accept("all")} className="rounded-lg">
                Accept All
              </Button>
              <Button size="sm" variant="outline" onClick={() => accept("essential")} className="rounded-lg">
                Essential Only
              </Button>
              <Button size="sm" variant="ghost" onClick={() => accept("essential")} className="rounded-lg text-muted-foreground">
                Cookie Policy
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CookieConsent;
