import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getWeddingDesign,
  updateStyleSettings,
  type WeddingDesign,
} from '@/integrations/supabase/weddings';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Header from '@/components/landing/Header';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { sanitizeSvg } from '@/lib/sanitizeSvg';
import { motion } from 'framer-motion';

interface EditorState {
  font: string;
  fontSize: string;
  color: string;
  alignment: 'left' | 'center' | 'right';
  foilEnabled: boolean;
}

const DEFAULT_EDITOR: EditorState = {
  font: 'Playfair Display',
  fontSize: '24',
  color: '#6b1e2a',
  alignment: 'center',
  foilEnabled: false,
};

const PRESET_COLORS = [
  { name: 'Gold', value: '#c9972f' },
  { name: 'Maroon', value: '#6b1e2a' },
  { name: 'Deep Green', value: '#1f6f52' },
  { name: 'Cream', value: '#fbf6f0' },
  { name: 'Off-white', value: '#fff8f3' },
  { name: 'Black', value: '#1a1a1a' },
];

const FONT_FAMILIES = [
  'Playfair Display',
  'DM Sans',
  'Noto Sans Tamil',
  'Noto Sans Telugu',
  'Noto Sans Kannada',
  'Noto Sans Malayalam',
];

const ALIGNMENTS = ['left', 'center', 'right'] as const;

const isAlignment = (value: unknown): value is EditorState['alignment'] =>
  value === 'left' || value === 'center' || value === 'right';

const oneOf = (value: unknown, choices: readonly string[], fallback: string) =>
  typeof value === 'string' && choices.includes(value) ? value : fallback;

const matching = (value: unknown, pattern: RegExp, fallback: string) =>
  typeof value === 'string' && pattern.test(value) ? value : fallback;

// `style_settings` is a jsonb column: the shape is ours by convention, not by
// constraint, and a migrated row can hold anything its old editor wrote. Each setting
// therefore falls back to the default the UI would have offered, rather than reaching
// the canvas unvalidated — an unusable saved value should degrade the preview, not
// break it.
const editorFrom = (settings: Record<string, unknown>): EditorState => ({
  font: oneOf(settings.font, FONT_FAMILIES, DEFAULT_EDITOR.font),
  fontSize: matching(settings.fontSize, /^\d{1,3}$/, DEFAULT_EDITOR.fontSize),
  color: matching(settings.color, /^#[0-9a-fA-F]{6}$/, DEFAULT_EDITOR.color),
  alignment: isAlignment(settings.alignment) ? settings.alignment : DEFAULT_EDITOR.alignment,
  foilEnabled: typeof settings.foilEnabled === 'boolean' ? settings.foilEnabled : false,
});

const FieldLabel = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <p id={id} className="text-xs font-medium text-foreground">
    {children}
  </p>
);

const EditProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [design, setDesign] = useState<WeddingDesign | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState>(DEFAULT_EDITOR);

  useEffect(() => {
    if (!id || !user) return;
    getWeddingDesign(user.id, id).then(result => {
      if (result.error || !result.data) return;
      setDesign(result.data);
      setEditor(editorFrom(result.data.styleSettings));
    });
  }, [id, user]);

  const handleSave = async () => {
    if (!id || !user) return;
    setSaving(true);
    const { error } = await updateStyleSettings(user.id, id, { ...editor });
    setSaving(false);
    if (error) {
      toast({ title: 'Could not save your design', variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: 'Your styling choices were saved with this draft.' });
    }
  };

  if (!design) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-16 text-center" role="status">
          <p className="animate-pulse text-muted-foreground">Loading design preview…</p>
        </main>
      </div>
    );
  }

  const previewSvg = sanitizeSvg(design.previewSvg);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <h1 className="sr-only">Design preview for {design.title}</h1>

      {/* Preview top bar */}
      <div className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild aria-label="Back to invitation draft">
            <Link to={`/project/${id}/configure`}><ArrowLeft className="w-4 h-4" aria-hidden="true" /></Link>
          </Button>
          <span className="font-display font-semibold text-sm truncate">{design.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={handleSave} disabled={saving}>
            <Save className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row">
        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 md:p-8 bg-muted/30 relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10" aria-hidden="true">
            <span className="text-4xl md:text-6xl font-display font-bold text-foreground/5 rotate-[-30deg] select-none">
              PREVIEW
            </span>
          </div>

          <motion.div
            className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md aspect-[5/7] flex flex-col items-center justify-center p-8 relative overflow-hidden"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            {editor.foilEnabled && (
              <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 via-transparent to-secondary/20 pointer-events-none" aria-hidden="true" />
            )}

            {previewSvg ? (
              <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: previewSvg }} />
            ) : (
              <div className="text-center space-y-4">
                <p
                  className="font-display text-2xl break-words"
                  style={{
                    fontFamily: editor.font,
                    fontSize: `${editor.fontSize}px`,
                    color: editor.color,
                    textAlign: editor.alignment,
                  }}
                >
                  {design.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  Sample preview text. Your styling choices are saved with this draft.
                </p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Styling panel */}
        <aside className="md:w-72 bg-card border-l border-border p-4 space-y-5 overflow-y-auto md:max-h-[calc(100vh-3.5rem)]">
          <h2 className="font-display font-semibold text-sm">Invitation styling</h2>

          <div className="space-y-1.5">
            <FieldLabel id="font-label">Font</FieldLabel>
            <Select value={editor.font} onValueChange={v => setEditor(e => ({ ...e, font: v }))}>
              <SelectTrigger className="h-9 text-xs" aria-labelledby="font-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map(f => (
                  <SelectItem key={f} value={f} className="text-xs">
                    <span style={{ fontFamily: f }}>{f}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="font-size">Font size (px)</Label>
            <Input
              id="font-size"
              type="number"
              min={8}
              max={120}
              value={editor.fontSize}
              onChange={e => setEditor(p => ({ ...p, fontSize: e.target.value }))}
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel id="colour-label">Colour</FieldLabel>
            <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="colour-label">
              {PRESET_COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setEditor(p => ({ ...p, color: c.value }))}
                  aria-label={`Use ${c.name}`}
                  aria-pressed={editor.color === c.value}
                  className={`h-9 w-9 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    editor.color === c.value ? 'border-primary scale-110' : 'border-border'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <Input
              type="color"
              value={editor.color}
              onChange={e => setEditor(p => ({ ...p, color: e.target.value }))}
              aria-label="Custom colour"
              className="h-9 w-full cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel id="alignment-label">Alignment</FieldLabel>
            <div className="flex gap-1" role="group" aria-labelledby="alignment-label">
              {ALIGNMENTS.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setEditor(p => ({ ...p, alignment: a }))}
                  aria-label={`Align text ${a}`}
                  aria-pressed={editor.alignment === a}
                  className={`flex-1 py-2 text-xs border rounded transition-colors capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                    editor.alignment === a ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={editor.foilEnabled}
              onChange={e => setEditor(p => ({ ...p, foilEnabled: e.target.checked }))}
            />
            <span>
              <span className="text-xs font-medium">Foil effect (simulated)</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">
                A screen-only overlay so you can imagine the finish. It is not a
                print effect and nothing prints from this preview.
              </span>
            </span>
          </label>
        </aside>
      </div>
    </div>
  );
};

export default EditProject;
