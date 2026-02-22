import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { formatPaise, BASE_FEE } from '@/lib/pricing';
import { LANGUAGES } from '@/lib/i18n';
import Header from '@/components/landing/Header';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const CreateProject = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('en');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('templates').select('*').eq('active', true).then(({ data }) => {
      setTemplates(data || []);
      if (data && data.length > 0) setSelectedTemplate(data[0].id);
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedTemplate) return;
    setLoading(true);

    // Mock payment — in production this would create a Razorpay order first
    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        title,
        language,
        template_id: selectedTemplate,
        paid_status: 'base_paid',
      })
      .select()
      .single();

    setLoading(false);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '🎉 Project created!', description: 'Now configure your features.' });
      navigate(`/project/${data.id}/configure`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-8 max-w-2xl">
        <h1 className="font-display text-2xl md:text-3xl font-bold mb-2">Create Your Invitation</h1>
        <p className="text-muted-foreground mb-8">Choose a template, name your project, and pay the base fee to get started.</p>

        <form onSubmit={handleCreate} className="space-y-8">
          {/* Template selection */}
          <div>
            <Label className="text-base font-semibold mb-4 block">Choose a Template</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {templates.map(tmpl => (
                <motion.div
                  key={tmpl.id}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedTemplate(tmpl.id)}
                  className={`relative cursor-pointer rounded-lg border-2 p-3 transition-all ${
                    selectedTemplate === tmpl.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  {selectedTemplate === tmpl.id && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className="aspect-[5/7] w-full mb-2 rounded bg-muted flex items-center justify-center overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: tmpl.preview_svg || '' }}
                  />
                  <p className="text-xs font-medium text-center truncate">{tmpl.name}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Project title */}
          <div className="space-y-2">
            <Label htmlFor="title">Project Title</Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="e.g., Priya & Karthik's Wedding"
            />
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label htmlFor="language">Primary Language</Label>
            <select
              id="language"
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeLabel} ({lang.label})
                </option>
              ))}
            </select>
          </div>

          {/* Price summary */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <span className="font-medium">Base Project Fee</span>
                <span className="text-xl font-bold text-primary">{formatPaise(BASE_FEE)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                One-time fee. Add features in the next step — pay only for what you use.
              </p>
            </CardContent>
          </Card>

          <Button type="submit" size="lg" className="w-full rounded-xl text-base" disabled={loading || !selectedTemplate}>
            {loading ? 'Creating...' : `Pay ${formatPaise(BASE_FEE)} & Create Project`}
          </Button>
        </form>
      </main>
    </div>
  );
};

export default CreateProject;
