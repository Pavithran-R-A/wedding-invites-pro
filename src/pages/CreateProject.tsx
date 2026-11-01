import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createWedding,
  listDesignOptions,
  type DesignOption,
} from '@/integrations/supabase/weddings';
import { listSelectableTraditionReleases } from '@/integrations/supabase/traditionReleases';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LANGUAGES, packCoverageWords } from '@/lib/i18n';
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
  /**
   * Which languages a reviewed pack in this build can actually render, or why the page does not know.
   * `reading` and `unknown` are separate because the sentence under the picker differs: one is a moment,
   * the other is a failure this build cannot answer around. An empty `codes` with `read` is a real answer
   * — no pack installed — and it is the state this product ships in until a pack clears review.
   */
  const [coverage, setCoverage] = useState<{ state: 'reading' | 'unknown' | 'read'; codes: Set<string> }>(
    { state: 'reading', codes: new Set<string>() },
  );

  useEffect(() => {
    let cancelled = false;
    // The same door the editor's pack panel reads, so a language this page calls uncovered cannot be
    // chosen there as covered. A failure narrows what the page may claim; it never blocks the draft.
    void listSelectableTraditionReleases().then((result) => {
      if (cancelled) return;
      if (result.error !== null || result.data === null) {
        setCoverage({ state: 'unknown', codes: new Set<string>() });
        return;
      }
      const codes = new Set<string>();
      for (const release of result.data) for (const code of release.languages) codes.add(code);
      setCoverage({ state: 'read', codes });
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
          and choose a design. The draft is saved privately to your account. The
          wording, the people, the venues and the styling are all editable later; the
          name and the main language are not, because this build has no screen that
          changes them once a draft exists — so those two are worth getting right now.
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
              {LANGUAGES.map(lang => {
                // The page hands the helper what it actually knows: a set when the read answered, `null`
                // while it is still reading and after a failed read. Both are "not knowing", and the
                // helper's contract is that not knowing never earns a sentence.
                const warning = packCoverageWords(
                  lang.code,
                  coverage.state === 'read' ? coverage.codes : null,
                );
                return (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeLabel} ({lang.label})
                    {/* The uncovered languages stay in the list — a host may want to write the words now
                        and take a reviewed pack later — but the page says what choosing one means today,
                        in the option itself, where the choice is actually being made. It says it about
                        the pack, never about the invitation: a draft with no pack attached is not held
                        back by the freeze door. */}
                    {warning === null ? '' : ' — no reviewed pack speaks this language'}
                  </option>
                );
              })}
            </select>
            <p className="text-xs text-muted-foreground">
              {coverage.state === 'reading'
                ? 'Checking which of these a reviewed pack in this build speaks.'
                : coverage.state === 'unknown'
                  ? 'This is the language the invitation is written in, chosen by you. The list of '
                    + 'reviewed packs could not be read just now, so this page is not claiming any of '
                    + 'these languages can or cannot be published.'
                  : 'This is the language the invitation is written in, chosen by you. A language marked '
                    + 'here has no reviewed pack in this build that speaks it, so there is no approved '
                    + 'wording to draw on — writing it yourself still works, and publishing your own '
                    + 'wording does not need a pack.'}
            </p>
            {coverage.state === 'read' && coverage.codes.size === 0 ? (
              <p className="text-xs text-warning" role="status">
                No reviewed pack is installed in this build at all, so no language has approved wording
                to draw on yet — every invitation here is written by you, and that is enough to publish.
              </p>
            ) : null}
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
