import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PRICE_PER_GUEST, formatPaise, getGuestSubtotal } from '@/lib/pricing';

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
        placeholder="e.g., 173"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatPaise(PRICE_PER_GUEST)} per guest</span>
        {value > 0 && (
          <span className="font-semibold text-primary">
            {value} × {formatPaise(PRICE_PER_GUEST)} = {formatPaise(getGuestSubtotal(value))}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground/80 italic">
        Every confirmed guest helps you avoid food waste and seating confusion.
      </p>
    </div>
  );
};

export default GuestCountInput;
