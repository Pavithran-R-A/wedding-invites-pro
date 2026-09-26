import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

// Each route is its own chunk. A guest who opens one shared link gets this file, the
// resolver and the renderer — not the editor, the dashboard, the sign-in forms or the
// landing page, none of which they will ever see. The consequence is measured in
// docs/audits/stage-3-public-invitation.md rather than asserted here.
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CreateProject = lazy(() => import("./pages/CreateProject"));
const ConfigureProject = lazy(() => import("./pages/ConfigureProject"));
const EditProject = lazy(() => import("./pages/EditProject"));
const PublicInvitation = lazy(() => import("./pages/PublicInvitation"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

/** Shown while a route's own module is fetched — a moment before the page decides what
 *  its own loading state should say, so it names no page. */
const RouteFallback = () => (
  <main className="flex min-h-dvh items-center justify-center bg-surface">
    <p role="status" className="text-sm text-ink-muted">
      Loading…
    </p>
  </main>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-of-service" element={<TermsOfService />} />
              <Route path="/cookie-policy" element={<CookiePolicy />} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/create-project" element={<ProtectedRoute><CreateProject /></ProtectedRoute>} />
              <Route path="/project/:id/configure" element={<ProtectedRoute><ConfigureProject /></ProtectedRoute>} />
              <Route path="/project/:id/edit" element={<ProtectedRoute><EditProject /></ProtectedRoute>} />
              {/* Deliberately not wrapped in `ProtectedRoute`: a guest has no account, and
                  the page reads one anonymous RPC. Adding auth here would turn every
                  shared link into a login wall, which is the opposite of the product. */}
              <Route path="/i/:token" element={<PublicInvitation />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
