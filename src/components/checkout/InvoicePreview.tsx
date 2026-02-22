import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatPaise, type PriceBreakdown } from '@/lib/pricing';

interface InvoicePreviewProps {
  open: boolean;
  onClose: () => void;
  onPay: () => void;
  breakdown: PriceBreakdown;
  projectTitle: string;
  loading?: boolean;
}

const InvoicePreview = ({ open, onClose, onPay, breakdown, projectTitle, loading }: InvoicePreviewProps) => {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Invoice Preview</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-center border-b border-border pb-4">
            <p className="font-display text-lg font-semibold text-primary">YourInvite</p>
            <p className="text-sm text-muted-foreground mt-1">{projectTitle}</p>
          </div>

          <div className="space-y-2">
            {breakdown.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{item.label}</span>
                <span className="font-medium">{formatPaise(item.amount)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{formatPaise(breakdown.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>GST (18%)</span>
              <span>{formatPaise(breakdown.gst)}</span>
            </div>
            <div className="flex justify-between font-semibold text-lg pt-2 border-t border-border mt-2">
              <span>Total</span>
              <span className="text-primary">{formatPaise(breakdown.total)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onPay} disabled={loading} className="rounded-xl">
            {loading ? 'Processing...' : `Pay ${formatPaise(breakdown.total)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InvoicePreview;
