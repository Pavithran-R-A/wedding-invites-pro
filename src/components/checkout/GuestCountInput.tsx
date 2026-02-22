import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GUEST_TIERS, formatPaise, getGuestTierLabel } from '@/lib/pricing';

interface GuestCountInputProps {
  value: number;
  onChange: (count: number) => void;
}

const GuestCountInput = ({ value, onChange }: GuestCountInputProps) => {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Number of Guests</Label>
      <Input
        type="number"
        min={0}
        max={9999}
        value={value || ''}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        placeholder="e.g., 100"
      />
      {value > 0 && (
        <p className="text-xs text-muted-foreground">
          Tier: {getGuestTierLabel(value)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {GUEST_TIERS.map(tier => (
          <div
            key={tier.label}
            className={`text-xs border rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
              value > 0 && value <= tier.limit && (GUEST_TIERS.indexOf(tier) === 0 || value > GUEST_TIERS[GUEST_TIERS.indexOf(tier) - 1].limit)
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/30'
            }`}
          >
            <span className="font-medium">{tier.label}</span>
            <span className="block text-[10px]">{formatPaise(tier.price)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GuestCountInput;
