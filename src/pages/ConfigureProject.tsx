import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getWedding,
  updatePlanningDetails,
  type WeddingSummary,
} from '@/integrations/supabase/weddings';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Header from '@/components/landing/Header';

const ConfigureProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [wedding, setWedding] = useState<WeddingSummary | null>(null);
  const [guestCount, setGuestCount] = useState(50);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    getWedding(user.id, id).then(result => {
      if (result.error || !result.data) {
        setLoadError(true);
        return;
      }
      setWedding(result.data);
      setGuestCount(result.data.estimatedGuestCount);
    });
  }, [id, user]);

  const handleSave = async () => {
    if (!id || !user) return;
    setSaving(true);
    const result = await updatePlanningDetails(user.id, id, {
      estimatedGuestCount: guestCount,
    });
    setSaving(false);
    if (result.error) {
      toast({ title: 'Could not save changes', variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: 'Your draft has been updated.' });
    }
  };

  if (loadError) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-16 text-center">
          <h1 className="font-display text-xl font-semibold mb-2">This invitation draft could not be opened</h1>
          <p className="text-muted-foreground">
            It may have been deleted, or the connection dropped. Please try again.
          </p>
          <Button asChild variant="outline" className="mt-4 rounded-xl">
            <Link to="/dashboard">Back to My Invitations</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (!wedding) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-16 text-center" role="status">
          <p className="animate-pulse text-muted-foreground">Loading your invitation draft…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Invitation draft
        </p>
        <h1 className="font-display text-2xl md:text-3xl font-bold mb-1 mt-1">{wedding.title}</h1>
        <p className="text-muted-foreground mb-8">
          This is a private draft. Only you can see it, and nothing here reaches guests yet.
        </p>

        <section aria-labelledby="planning-heading" className="mb-6">
          <h2 id="planning-heading" className="font-display text-lg font-semibold mb-3">
            Planning
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-2">
              <Label htmlFor="guests">Estimated guests</Label>
              <Input
                id="guests"
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                value={guestCount}
                onChange={e => setGuestCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
              <p className="text-xs text-muted-foreground">
                A rough number you note down for yourself. It is not a guest list,
                and it does not affect billing — there is no checkout yet.
              </p>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="design-heading" className="mb-6">
          <h2 id="design-heading" className="font-display text-lg font-semibold mb-3">
            Design
          </h2>
          <Card>
            <CardContent className="py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Adjust the typeface, size, colour and alignment of the preview text.
              </p>
              <Button className="rounded-xl shrink-0" asChild>
                <Link to={`/project/${id}/edit`}>Open Design Preview</Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" className="rounded-xl" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button variant="ghost" className="rounded-xl" asChild>
            <Link to="/dashboard">Back to My Invitations</Link>
          </Button>
        </div>

        <section
          aria-labelledby="roadmap-heading"
          className="mt-10 p-4 rounded-xl border border-border bg-muted/30"
        >
          <h2 id="roadmap-heading" className="font-display font-semibold text-sm mb-2">
            Planned, not part of this draft yet
          </h2>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Couple, family, function and venue details</li>
            <li>Family approval of a specific version</li>
            <li>Guest lists, personalised links and RSVP replies</li>
            <li>Sharing, QR code, PDF, payment and publishing</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            These are directions for the product, not capabilities of this build.
            Nothing on this page can be purchased or activated.
          </p>
        </section>
      </main>
    </div>
  );
};

export default ConfigureProject;
