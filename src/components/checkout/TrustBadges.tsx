import { Shield, Lock, Printer } from 'lucide-react';

const TrustBadges = () => {
  return (
    <div className="flex items-center justify-center gap-4 py-3 text-muted-foreground">
      <div className="flex items-center gap-1.5 text-xs">
        <Shield className="w-3.5 h-3.5 text-accent" />
        <span>Secure Checkout</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <Lock className="w-3.5 h-3.5 text-accent" />
        <span>SSL Encrypted</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <Printer className="w-3.5 h-3.5 text-accent" />
        <span>Local Printers</span>
      </div>
    </div>
  );
};

export default TrustBadges;
