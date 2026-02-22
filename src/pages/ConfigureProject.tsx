import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  FEATURES, FEATURE_CATEGORIES, calculatePrice, type FeatureKey,
} from '@/lib/pricing';
import Header from '@/components/landing/Header';
import FeatureToggle from '@/components/checkout/FeatureToggle';
import PriceMeter from '@/components/checkout/PriceMeter';
import GuestCountInput from '@/components/checkout/GuestCountInput';
import InvoicePreview from '@/components/checkout/InvoicePreview';

const ConfigureProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [project, setProject] = useState<any>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<FeatureKey[]>(['rsvp', 'meal_report', 'csv_export']);
  const [guestCount, setGuestCount] = useState(50);
  const [showInvoice, setShowInvoice] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    supabase.from('projects').select('*').eq('id', id).eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) {
          setProject(data);
          if (data.selected_features && typeof data.selected_features === 'object') {
            const feats = (data.selected_features as any).features;
            if (Array.isArray(feats)) setSelectedFeatures(feats);
          }
          if (data.guest_count) setGuestCount(data.guest_count);
        }
      });
  }, [id, user]);

  const toggleFeature = (key: FeatureKey) => {
    const feat = FEATURES[key];
    if ('included' in feat && feat.included) return;
    setSelectedFeatures(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
  };

  const breakdown = useMemo(
    () => calculatePrice(selectedFeatures, guestCount),
    [selectedFeatures, guestCount]
  );

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    await supabase.from('projects').update({
      selected_features: { features: selectedFeatures },
      guest_count: guestCount,
    }).eq('id', id);
    setSaving(false);
    toast({ title: 'Saved!', description: 'Your feature selections have been saved.' });
  };

  const handlePay = () => {
    // Mock payment — will integrate Razorpay when keys are ready
    toast({ title: '🎉 Payment successful!', description: 'Your features are now active.' });
    setShowInvoice(false);
  };

  const groupedFeatures = useMemo(() => {
    const groups: Record<string, { key: FeatureKey; feature: typeof FEATURES[FeatureKey] }[]> = {};
    for (const [key, feature] of Object.entries(FEATURES)) {
      const cat = feature.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ key: key as FeatureKey, feature });
    }
    return groups;
  }, []);

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
      <main className="container px-4 md:px-6 py-8">
        <h1 className="font-display text-2xl md:text-3xl font-bold mb-1">{project.title}</h1>
        <p className="text-muted-foreground mb-8">Choose features for your invitation. Pay only for what you need.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Feature toggles */}
          <div className="lg:col-span-2 space-y-8">
            {/* Guest count */}
            <div className="p-4 border border-border rounded-xl">
              <h3 className="font-display font-semibold mb-3">Guests</h3>
              <GuestCountInput value={guestCount} onChange={setGuestCount} />
            </div>

            {/* Feature categories */}
            {Object.entries(FEATURE_CATEGORIES).map(([catKey, catLabel]) => (
              <div key={catKey}>
                <h3 className="font-display font-semibold mb-3">{catLabel}</h3>
                <div className="space-y-2">
                  {(groupedFeatures[catKey] || []).map(({ key, feature }) => (
                    <FeatureToggle
                      key={key}
                      label={feature.label}
                      description={feature.description}
                      price={feature.price}
                      checked={selectedFeatures.includes(key)}
                      included={'included' in feature ? feature.included : undefined}
                      onChange={() => toggleFeature(key)}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="flex gap-3 pb-8">
              <Button variant="outline" className="rounded-xl" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Draft'}
              </Button>
              <Button className="rounded-xl flex-1" onClick={() => setShowInvoice(true)}>
                Review Order
              </Button>
            </div>
          </div>

          {/* Price meter — desktop sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <PriceMeter breakdown={breakdown} />
            </div>
          </div>
        </div>

        {/* Mobile sticky price bar */}
        <div className="fixed bottom-0 left-0 right-0 lg:hidden bg-card border-t border-border p-4 z-30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total (incl. GST)</p>
              <p className="font-display font-bold text-lg text-primary">
                {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(breakdown.total / 100)}
              </p>
            </div>
            <Button className="rounded-xl" onClick={() => setShowInvoice(true)}>
              Review Order
            </Button>
          </div>
        </div>

        <InvoicePreview
          open={showInvoice}
          onClose={() => setShowInvoice(false)}
          onPay={handlePay}
          breakdown={breakdown}
          projectTitle={project.title}
        />
      </main>
    </div>
  );
};

export default ConfigureProject;
