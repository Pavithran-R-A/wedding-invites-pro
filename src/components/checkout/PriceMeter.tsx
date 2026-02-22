import { motion, AnimatePresence } from 'framer-motion';
import { formatPaise, type PriceBreakdown } from '@/lib/pricing';

interface PriceMeterProps {
  breakdown: PriceBreakdown;
}

const PriceMeter = ({ breakdown }: PriceMeterProps) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <h3 className="font-display text-lg font-semibold">Order Summary</h3>

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {breakdown.items.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
              className="flex justify-between text-sm"
            >
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-medium">{formatPaise(item.amount)}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-medium">{formatPaise(breakdown.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">GST (18%)</span>
          <span className="font-medium">{formatPaise(breakdown.gst)}</span>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <motion.div
          className="flex justify-between"
          key={breakdown.total}
          initial={{ scale: 1.02 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <span className="font-display font-semibold text-lg">Total</span>
          <span className="font-display font-bold text-lg text-primary">{formatPaise(breakdown.total)}</span>
        </motion.div>
      </div>
    </div>
  );
};

export default PriceMeter;
