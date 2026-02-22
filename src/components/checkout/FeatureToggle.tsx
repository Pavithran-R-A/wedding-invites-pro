import { motion } from 'framer-motion';
import { formatPaise } from '@/lib/pricing';

interface FeatureToggleProps {
  label: string;
  description: string;
  price: number;
  checked: boolean;
  included?: boolean;
  onChange: (checked: boolean) => void;
}

const FeatureToggle = ({ label, description, price, checked, included, onChange }: FeatureToggleProps) => {
  return (
    <motion.label
      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-180 ${
        checked
          ? 'border-primary/40 bg-primary/5'
          : 'border-border hover:border-primary/20'
      }`}
      whileTap={{ scale: 0.98 }}
    >
      <div className="pt-0.5">
        <motion.div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            checked ? 'bg-primary border-primary' : 'border-muted-foreground/30'
          }`}
          animate={checked ? { scale: [1, 1.15, 1] } : {}}
          transition={{ duration: 0.18 }}
        >
          {checked && (
            <motion.svg
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.18 }}
              className="w-3 h-3 text-primary-foreground"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2 6l3 3 5-5" />
            </motion.svg>
          )}
        </motion.div>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={e => !included && onChange(e.target.checked)}
          disabled={included}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-sm font-semibold text-primary ml-2 shrink-0">
            {included ? 'Included' : price === 0 ? 'Free' : formatPaise(price)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </motion.label>
  );
};

export default FeatureToggle;
