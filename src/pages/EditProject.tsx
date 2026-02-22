import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
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
import { 
  Type, Image, Palette, Square, QrCode, Languages, 
  Sparkles, Frame, ArrowLeft, Save, Eye
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';

const TOOLBAR_ITEMS = [
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'image', icon: Image, label: 'Image' },
  { id: 'motif', icon: Sparkles, label: 'Motif' },
  { id: 'border', icon: Frame, label: 'Border' },
  { id: 'paper', icon: Square, label: 'Paper' },
  { id: 'foil', icon: Palette, label: 'Foil/Emboss' },
  { id: 'qr', icon: QrCode, label: 'QR' },
  { id: 'language', icon: Languages, label: 'Language' },
];

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

const EditProject = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [project, setProject] = useState<any>(null);
  const [activeTool, setActiveTool] = useState('text');
  const [saving, setSaving] = useState(false);

  // Editor state
  const [selectedFont, setSelectedFont] = useState('Playfair Display');
  const [fontSize, setFontSize] = useState('24');
  const [selectedColor, setSelectedColor] = useState('#6b1e2a');
  const [alignment, setAlignment] = useState('center');
  const [foilEnabled, setFoilEnabled] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    supabase.from('projects').select('*, templates(*)').eq('id', id).eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) setProject(data);
      });
  }, [id, user]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    // Save editor state to project
    await supabase.from('projects').update({
      selected_features: {
        ...(project?.selected_features || {}),
        editor: { font: selectedFont, fontSize, color: selectedColor, alignment, foilEnabled },
      },
    }).eq('id', id);
    setSaving(false);
    toast({ title: 'Saved!', description: 'Your design has been saved.' });
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
          <Button size="sm" className="rounded-lg" asChild>
            <Link to={`/project/${id}/configure`}>
              <Eye className="w-3.5 h-3.5 mr-1.5" />
              Configure & Pay
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row">
        {/* Left toolbar */}
        <div className="md:w-16 bg-card border-r border-border flex md:flex-col items-center gap-1 p-2 overflow-x-auto md:overflow-x-visible">
          {TOOLBAR_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTool(item.id)}
              className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg text-[10px] transition-colors shrink-0 ${
                activeTool === item.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <item.icon className="w-4 h-4 mb-0.5" />
              {item.label}
            </button>
          ))}
        </div>

        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 md:p-8 bg-muted/30 relative">
          {/* Watermark overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-6xl font-display font-bold text-foreground/5 rotate-[-30deg] select-none">
              PREVIEW
            </span>
          </div>

          {/* Template preview */}
          <motion.div
            className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md aspect-[5/7] flex flex-col items-center justify-center p-8 relative overflow-hidden"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            {/* Foil overlay simulation */}
            {foilEnabled && (
              <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 via-transparent to-secondary/20 pointer-events-none" />
            )}

            {project.templates?.preview_svg ? (
              <div
                className="w-full h-full"
                dangerouslySetInnerHTML={{ __html: project.templates.preview_svg }}
              />
            ) : (
              <div className="text-center space-y-4">
                <p
                  className="font-display text-2xl"
                  style={{ fontFamily: selectedFont, fontSize: `${fontSize}px`, color: selectedColor, textAlign: alignment as any }}
                >
                  {project.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  Select elements from the toolbar to customize your invitation
                </p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Right property panel */}
        <div className="md:w-72 bg-card border-l border-border p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)]">
          <h3 className="font-display font-semibold text-sm">Properties</h3>

          {/* Font family */}
          <div className="space-y-1.5">
            <Label className="text-xs">Font Family</Label>
            <Select value={selectedFont} onValueChange={setSelectedFont}>
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

          {/* Font size */}
          <div className="space-y-1.5">
            <Label className="text-xs">Font Size</Label>
            <Input type="number" min={8} max={120} value={fontSize} onChange={e => setFontSize(e.target.value)} className="h-9 text-xs" />
          </div>

          {/* Color picker with swatches */}
          <div className="space-y-1.5">
            <Label className="text-xs">Color</Label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setSelectedColor(c.value)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    selectedColor === c.value ? 'border-primary scale-110' : 'border-border'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
            <Input
              type="color"
              value={selectedColor}
              onChange={e => setSelectedColor(e.target.value)}
              className="h-8 w-full cursor-pointer"
            />
          </div>

          {/* Alignment */}
          <div className="space-y-1.5">
            <Label className="text-xs">Alignment</Label>
            <div className="flex gap-1">
              {['left', 'center', 'right'].map(a => (
                <button
                  key={a}
                  onClick={() => setAlignment(a)}
                  className={`flex-1 py-1.5 text-xs border rounded transition-colors capitalize ${
                    alignment === a ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Foil toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              foilEnabled ? 'bg-secondary border-secondary' : 'border-muted-foreground/30'
            }`}>
              {foilEnabled && (
                <svg className="w-3 h-3 text-secondary-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </div>
            <input type="checkbox" className="sr-only" checked={foilEnabled} onChange={e => setFoilEnabled(e.target.checked)} />
            <div>
              <span className="text-xs font-medium">Foil Effect</span>
              <p className="text-[10px] text-muted-foreground">Simulated gold foil overlay</p>
            </div>
          </label>

          <Separator />

          {/* Active tool panel */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {TOOLBAR_ITEMS.find(t => t.id === activeTool)?.label} Options
            </h4>
            <p className="text-xs text-muted-foreground">
              {activeTool === 'text' && 'Click on the canvas to add or edit text. Use the properties above to style.'}
              {activeTool === 'image' && 'Upload images for your invitation. Supported: JPG, PNG, WebP (max 5MB).'}
              {activeTool === 'motif' && 'Browse temple, mandala, mango, and lotus motifs. Click to place on canvas.'}
              {activeTool === 'border' && 'Choose from traditional South Indian border patterns.'}
              {activeTool === 'paper' && 'Select paper finish. This affects the printed version only.'}
              {activeTool === 'foil' && 'Toggle gold/silver foil or embossing effects for print.'}
              {activeTool === 'qr' && 'Place a QR code on your invite that links to your RSVP page.'}
              {activeTool === 'language' && 'Add multilingual text blocks with transliteration support.'}
            </p>
            {activeTool === 'motif' && (
              <div className="grid grid-cols-3 gap-2">
                {['🪷', '🕌', '🥭', '☸️', '🌺', '🪔'].map((emoji, i) => (
                  <button key={i} className="aspect-square border border-border rounded-lg flex items-center justify-center text-2xl hover:bg-muted transition-colors">
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditProject;
