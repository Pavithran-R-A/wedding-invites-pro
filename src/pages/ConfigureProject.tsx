import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
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
  const [project, setProject] = useState<{ id: string; title: string; guest_count: number | null } | null>(null);
  const [guestCount, setGuestCount] = useState(50);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    supabase
      .from('projects')
      .select('id, title, guest_count')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setLoadError(true);
          return;
        }
        setProject(data);
        if (typeof data.guest_count === 'number') setGuestCount(data.guest_count);
      });
  }, [id, user]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase
      .from('projects')
      .update({ guest_count: guestCount })
      .eq('id', id)
      .eq('user_id', user?.id);
    setSaving(false);
    if (error) {
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
          <p className="text-muted-foreground">We could not load this project. Please try again later.</p>
          <Button asChild variant="outline" className="mt-4 rounded-xl">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <div className="animate-pulse text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-8 max-w-2xl">
        <h1 className="font-display text-2xl md:text-3xl font-bold mb-1">{project.title}</h1>
        <p className="text-muted-foreground mb-8">
          This is a work-in-progress draft. You can set a planning guest count and edit the design.
        </p>

        <Card className="mb-6">
          <CardContent className="pt-6 space-y-2">
            <Label htmlFor="guests">Estimated guests (planning only)</Label>
            <Input
              id="guests"
              type="number"
              min={0}
              max={9999}
              value={guestCount}
              onChange={e => setGuestCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
            <p className="text-xs text-muted-foreground">
              A rough number to help you plan. It does not affect billing — there is no checkout yet.
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" className="rounded-xl" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button className="rounded-xl" asChild>
            <Link to={`/project/${id}/edit`}>Edit Design</Link>
          </Button>
        </div>

        <div className="mt-10 p-4 rounded-xl border border-border bg-muted/30">
          <h2 className="font-display font-semibold text-sm mb-2">Coming in a later stage</h2>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Feature add-ons and pricing</li>
            <li>Secure payment and publishing</li>
            <li>Guest invitations, RSVP and printing</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            These are not available in this build and cannot be purchased or activated here.
          </p>
        </div>
      </main>
    </div>
  );
};

export default ConfigureProject;
