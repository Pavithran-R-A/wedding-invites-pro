import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const acknowledged = localStorage.getItem("cookie-consent");
    if (!acknowledged) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem("cookie-consent", "acknowledged");
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
            <h4 className="font-display font-semibold text-base mb-1">Your privacy</h4>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              We store a sign-in session in your browser's local storage so you stay logged in.
              This site does not use advertising or analytics cookies.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="sm" onClick={dismiss} className="rounded-lg">
                Got it
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg" asChild>
                <Link to="/cookie-policy">Read cookie policy</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CookieConsent;
