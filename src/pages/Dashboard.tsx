import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Users, CreditCard } from 'lucide-react';
import Header from '@/components/landing/Header';

const Dashboard = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchProjects = async () => {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setProjects(data || []);
      setLoading(false);
    };
    fetchProjects();
  }, [user]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'fully_paid': return 'bg-accent text-accent-foreground';
      case 'base_paid': return 'bg-secondary text-secondary-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display text-2xl md:text-3xl font-bold">My Invitations</h1>
          <Button asChild className="rounded-xl">
            <Link to="/create-project">
              <Plus className="w-4 h-4 mr-2" />
              Create New Invite
            </Link>
          </Button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6 text-center">
              <FileText className="w-6 h-6 mx-auto mb-2 text-primary" />
              <p className="text-2xl font-bold">{projects.length}</p>
              <p className="text-xs text-muted-foreground">Projects</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <Users className="w-6 h-6 mx-auto mb-2 text-accent" />
              <p className="text-2xl font-bold">0</p>
              <p className="text-xs text-muted-foreground">Total Guests</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <span className="text-2xl">📨</span>
              <p className="text-2xl font-bold mt-1">0</p>
              <p className="text-xs text-muted-foreground">RSVPs</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <CreditCard className="w-6 h-6 mx-auto mb-2 text-secondary" />
              <p className="text-2xl font-bold">0</p>
              <p className="text-xs text-muted-foreground">Orders</p>
            </CardContent>
          </Card>
        </div>

        {/* Project list */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <p className="text-muted-foreground mb-4">No invitations yet. Create your first one!</p>
              <Button asChild className="rounded-xl">
                <Link to="/create-project">
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Invite
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {projects.map(project => (
              <Link key={project.id} to={`/project/${project.id}/configure`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <h3 className="font-medium">{project.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {new Date(project.created_at).toLocaleDateString('en-IN')} · {project.language?.toUpperCase()}
                      </p>
                    </div>
                    <Badge className={statusColor(project.paid_status)}>
                      {project.paid_status?.replace('_', ' ')}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
