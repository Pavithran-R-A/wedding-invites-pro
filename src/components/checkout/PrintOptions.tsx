import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  PAPER_TYPES, PAPER_GSM, FINISH_OPTIONS,
  calculatePrintCost, formatPaise
} from '@/lib/pricing';

interface PrintOptionsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  qty: number;
  onQtyChange: (qty: number) => void;
  paperType: string;
  onPaperTypeChange: (type: string) => void;
  gsm: string;
  onGsmChange: (gsm: string) => void;
  finish: string;
  onFinishChange: (finish: string) => void;
}

const PrintOptions = ({
  enabled, onToggle,
  qty, onQtyChange,
  paperType, onPaperTypeChange,
  gsm, onGsmChange,
  finish, onFinishChange,
}: PrintOptionsProps) => {
  const { printerCost, platformMarkup } = calculatePrintCost(qty, paperType, gsm, finish);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 cursor-pointer">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          enabled ? 'bg-primary border-primary' : 'border-muted-foreground/30'
        }`}>
          {enabled && (
            <svg className="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6l3 3 5-5" />
            </svg>
          )}
        </div>
        <input type="checkbox" className="sr-only" checked={enabled} onChange={e => onToggle(e.target.checked)} />
        <span className="font-medium text-sm">Add Print Order</span>
      </label>

      {enabled && (
        <div className="pl-8 space-y-4 border-l-2 border-primary/20 ml-2.5">
          <div className="space-y-1.5">
            <Label className="text-xs">Quantity</Label>
            <Input type="number" min={10} max={2000} step={10} value={qty || ''} onChange={e => onQtyChange(parseInt(e.target.value) || 0)} placeholder="e.g., 100" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Paper Type</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {PAPER_TYPES.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPaperTypeChange(p.id)}
                  className={`text-xs border rounded-md px-2 py-1.5 transition-colors text-left ${
                    paperType === p.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-[10px]">{formatPaise(p.pricePerCard)}/card</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Paper Weight (GSM)</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {PAPER_GSM.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onGsmChange(g.id)}
                  className={`text-xs border rounded-md px-2 py-1.5 transition-colors ${
                    gsm === g.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Finish</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {FINISH_OPTIONS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onFinishChange(f.id)}
                  className={`text-xs border rounded-md px-2 py-1.5 transition-colors ${
                    finish === f.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {qty > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Printer Cost ({qty} cards)</span>
                <span className="font-medium">{formatPaise(printerCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform Fee (15%)</span>
                <span className="font-medium">{formatPaise(platformMarkup)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PrintOptions;
