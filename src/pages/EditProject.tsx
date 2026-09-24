import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
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

interface ProjectRow {
  id: string;
  title: string;
  selected_features: Record<string, unknown> | null;
  templates: { preview_svg: string | null } | { preview_svg: string | null }[] | null;
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

const templateSvgOf = (project: ProjectRow | null): string | null => {
  if (!project?.templates) return null;
  const t = Array.isArray(project.templates) ? project.templates[0] : project.templates;
  return t?.preview_svg ?? null;
};

const EditProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState>(DEFAULT_EDITOR);

  useEffect(() => {
    if (!id || !user) return;
    supabase
      .from('projects')
      .select('id, title, selected_features, templates(preview_svg)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return;
        const row = data as unknown as ProjectRow;
        setProject(row);
        const saved = (row.selected_features as { editor?: Partial<EditorState> } | null)?.editor;
        if (saved) setEditor({ ...DEFAULT_EDITOR, ...saved });
      });
  }, [id, user]);

  const handleSave = async () => {
    if (!id || !user) return;
    setSaving(true);
    const { error } = await supabase
      .from('projects')
      .update({
        selected_features: {
          ...((project?.selected_features as Record<string, unknown>) || {}),
          editor,
        } as unknown as Json,
      })
      .eq('id', id)
      .eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Could not save your design', variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: 'Your design settings were saved.' });
    }
  };

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <div className="animate-pulse text-muted-foreground">Loading editor...</div>
        </div>
      </div>
    );
  }

  const previewSvg = sanitizeSvg(templateSvgOf(project));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Editor top bar */}
      <div className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/project/${id}/configure`}><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <span className="font-display font-semibold text-sm truncate max-w-[200px]">{project.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={handleSave} disabled={saving}>
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button size="sm" className="rounded-lg" variant="ghost" asChild>
            <Link to={`/project/${id}/configure`}>Back to configure</Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row">
        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 md:p-8 bg-muted/30 relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-6xl font-display font-bold text-foreground/5 rotate-[-30deg] select-none">
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
              <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 via-transparent to-secondary/20 pointer-events-none" />
            )}

            {previewSvg ? (
              <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: previewSvg }} />
            ) : (
              <div className="text-center space-y-4">
                <p
                  className="font-display text-2xl"
                  style={{
                    fontFamily: editor.font,
                    fontSize: `${editor.fontSize}px`,
                    color: editor.color,
                    textAlign: editor.alignment,
                  }}
                >
                  {project.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  Sample preview. Your styling choices are saved with this draft.
                </p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Right property panel */}
        <div className="md:w-72 bg-card border-l border-border p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)]">
          <h3 className="font-display font-semibold text-sm">Text Styling</h3>

          <div className="space-y-1.5">
            <Label className="text-xs">Font Family</Label>
            <Select value={editor.font} onValueChange={v => setEditor(e => ({ ...e, font: v }))}>
              <SelectTrigger className="h-9 text-xs">
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
            <Label className="text-xs">Font Size</Label>
            <Input
              type="number"
              min={8}
              max={120}
              value={editor.fontSize}
              onChange={e => setEditor(p => ({ ...p, fontSize: e.target.value }))}
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Color</Label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setEditor(p => ({ ...p, color: c.value }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    editor.color === c.value ? 'border-primary scale-110' : 'border-border'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
            <Input
              type="color"
              value={editor.color}
              onChange={e => setEditor(p => ({ ...p, color: e.target.value }))}
              className="h-8 w-full cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Alignment</Label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setEditor(p => ({ ...p, alignment: a }))}
                  className={`flex-1 py-1.5 text-xs border rounded transition-colors capitalize ${
                    editor.alignment === a ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <label className="flex items-center gap-2 cursor-pointer">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              editor.foilEnabled ? 'bg-secondary border-secondary' : 'border-muted-foreground/30'
            }`}>
              {editor.foilEnabled && (
                <svg className="w-3 h-3 text-secondary-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={editor.foilEnabled}
              onChange={e => setEditor(p => ({ ...p, foilEnabled: e.target.checked }))}
            />
            <div>
              <span className="text-xs font-medium">Foil Effect (simulated)</span>
              <p className="text-[10px] text-muted-foreground">Preview-only overlay; not a real print finish yet.</p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};

export default EditProject;
