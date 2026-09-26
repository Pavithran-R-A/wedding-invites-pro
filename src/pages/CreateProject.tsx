import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createWedding,
  listDesignOptions,
  type DesignOption,
} from '@/integrations/supabase/weddings';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LANGUAGES } from '@/lib/i18n';
import { sanitizeSvg } from '@/lib/sanitizeSvg';
import Header from '@/components/landing/Header';
import { Check } from 'lucide-react';

const CreateProject = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('en');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templates, setTemplates] = useState<DesignOption[]>([]);
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listDesignOptions().then(result => {
      if (result.error) {
        setTemplatesFailed(true);
        return;
      }
      setTemplates(result.data);
      if (result.data.length > 0) setSelectedTemplate(result.data[0].id);
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    const result = await createWedding(user.id, {
      title,
      primaryLanguage: language,
      designTemplateId: selectedTemplate,
    });

    setLoading(false);

    if (result.error || !result.data) {
      toast({ title: 'Could not create your draft', variant: 'destructive' });
      return;
    }
    toast({ title: 'Draft created', description: 'Continue configuring your invitation.' });
    navigate(`/project/${result.data.id}/configure`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-8 max-w-2xl">
        <h1 className="font-display text-2xl md:text-3xl font-bold mb-2">Create an Invitation Draft</h1>
        <p className="text-muted-foreground mb-8">
          Give the draft a name your family will recognise, pick the main language
          and choose a design. The draft is saved privately to your account, and
          you can change all of it later.
        </p>

        <form onSubmit={handleCreate} className="space-y-8">
          <fieldset>
            <legend className="text-base font-semibold mb-1 block">Design direction</legend>
            <p className="text-sm text-muted-foreground mb-4">
              These are the designs currently loaded in the preview. They are
              starting points, not final production templates.
            </p>
            {templatesFailed ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                The design list could not be loaded right now. You can still
                create the draft and choose a design later.
              </p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/40 p-4">
                No designs are loaded in this preview yet. You can still create
                the draft and style the text later.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {templates.map((tmpl) => (
                  <label
                    key={tmpl.id}
                    htmlFor={`template-${tmpl.id}`}
                    className={`relative cursor-pointer rounded-lg border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${
                      selectedTemplate === tmpl.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <input
                      id={`template-${tmpl.id}`}
                      type="radio"
                      name="template"
                      value={tmpl.id}
                      checked={selectedTemplate === tmpl.id}
                      onChange={() => setSelectedTemplate(tmpl.id)}
                      className="sr-only"
                    />
                    {selectedTemplate === tmpl.id && (
                      <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="w-3 h-3" aria-hidden="true" />
                      </span>
                    )}
                    <span
                      className="flex aspect-[5/7] w-full mb-2 rounded bg-muted items-center justify-center overflow-hidden"
                      dangerouslySetInnerHTML={{ __html: sanitizeSvg(tmpl.previewSvg) }}
                    />
                    <span className="block text-xs font-medium text-center truncate">{tmpl.displayName}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="title">Invitation name</Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="For example: Priya and Karthik's wedding"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">Main language</Label>
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
            <p className="text-xs text-muted-foreground">
              This is the language the invitation is written in, chosen by you.
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full rounded-xl text-base" disabled={loading}>
            {loading ? 'Creating...' : 'Create Invitation Draft'}
          </Button>
        </form>
      </main>
    </div>
  );
};

export default CreateProject;
