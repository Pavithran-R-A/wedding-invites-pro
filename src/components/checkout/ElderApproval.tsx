import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Eye, Send } from 'lucide-react';

interface ElderApprovalProps {
  projectId: string;
  projectTitle: string;
}

const ElderApproval = ({ projectId, projectTitle }: ElderApprovalProps) => {
  const [open, setOpen] = useState(false);
  const [elderName, setElderName] = useState('');
  const [elderPhone, setElderPhone] = useState('');
  const { toast } = useToast();

  const handleSend = () => {
    if (!elderName.trim() || !elderPhone.trim()) {
      toast({ title: 'Please fill in all fields', variant: 'destructive' });
      return;
    }
    // Generate approval link (mock for now)
    const approvalLink = `${window.location.origin}/approve/${projectId}?name=${encodeURIComponent(elderName)}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(approvalLink).then(() => {
      toast({ 
        title: '✅ Approval link copied!', 
        description: `Share this link with ${elderName}. They can approve with one tap.` 
      });
    });
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full rounded-xl border-secondary/30 text-secondary hover:bg-secondary/5"
        onClick={() => setOpen(true)}
      >
        <Eye className="w-4 h-4 mr-2" />
        Send to Elder for Approval
      </Button>
      <p className="text-[11px] text-muted-foreground text-center -mt-1">
        One-tap approval with large text — perfect for parents and grandparents.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Elder Approval</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Generate a simple approval link for <strong>{projectTitle}</strong>. 
            The elder sees the invite in large text and taps "Approve" — no login needed.
          </p>
          <div className="space-y-3">
            <Input
              placeholder="Elder's name (e.g., Appa, Thatha)"
              value={elderName}
              onChange={e => setElderName(e.target.value)}
            />
            <Input
              placeholder="Phone number"
              type="tel"
              value={elderPhone}
              onChange={e => setElderPhone(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleSend} className="w-full rounded-xl">
              <Send className="w-4 h-4 mr-2" />
              Generate & Copy Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ElderApproval;
