import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Users } from 'lucide-react';
import { LANGUAGES } from '@/lib/i18n';
import Header from '@/components/landing/Header';

interface ProjectRow {
  id: string;
  title: string;
  language: string | null;
  created_at: string;
  guest_count: number | null;
}

const languageLabel = (code: string | null) => {
  const match = LANGUAGES.find((lang) => lang.code === code);
  return match ? `${match.nativeLabel} (${match.label})` : 'Language not chosen';
};

const Dashboard = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchProjects = async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, title, language, created_at, guest_count')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        setLoadError(true);
      } else {
        setProjects((data ?? []) as ProjectRow[]);
      }
      setLoading(false);
    };
    fetchProjects();
  }, [user]);

  const totalGuests = projects.reduce((sum, p) => sum + (p.guest_count ?? 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">My Invitations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Drafts you have started. Nothing here is shared with guests yet.
            </p>
          </div>
          <Button asChild className="rounded-xl">
            <Link to="/create-project">
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              Create Invitation
            </Link>
          </Button>
        </div>

        {/* Quick stats — only metrics backed by this user's real data */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6 text-center">
              <FileText className="w-6 h-6 mx-auto mb-2 text-primary" aria-hidden="true" />
              <p className="text-2xl font-bold">{projects.length}</p>
              <p className="text-xs text-muted-foreground">Invitation drafts</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <Users className="w-6 h-6 mx-auto mb-2 text-accent" aria-hidden="true" />
              <p className="text-2xl font-bold">{totalGuests}</p>
              <p className="text-xs text-muted-foreground">Estimated guests</p>
            </CardContent>
          </Card>
        </div>

        {loadError && (
          <Card className="mb-6 border-destructive/40">
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">We could not load your invitations. Please refresh to try again.</p>
            </CardContent>
          </Card>
        )}

        {/* Invitation list */}
        {loading ? (
          <div className="space-y-4" role="status">
            <p className="sr-only">Loading your invitations…</p>
            {[1, 2].map(i => (
              <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <p className="text-muted-foreground mb-2">
                You have no invitation drafts yet.
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                A draft starts with a name, a language and a design. Everything
                stays private to your account until the product can publish it.
              </p>
              <Button asChild className="rounded-xl">
                <Link to="/create-project">
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  Create Invitation
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {projects.map(project => (
              <li key={project.id}>
                <Link
                  to={`/project/${project.id}/configure`}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="hover:border-primary/30 transition-colors">
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <h2 className="font-medium truncate">{project.title}</h2>
                        <p className="text-sm text-muted-foreground">
                          {new Date(project.created_at).toLocaleDateString('en-IN')}
                          {' · '}
                          {languageLabel(project.language)}
                          {project.guest_count ? ` · ~${project.guest_count} guests` : ''}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">Draft</Badge>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
