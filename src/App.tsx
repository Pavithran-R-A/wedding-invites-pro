import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

// Each route is its own chunk. A guest who opens one shared link, and a relative who opens a
// review link, each get this file, their own resolver and the renderer — not the editor, the
// dashboard, the sign-in forms or the landing page, none of which they will ever see. The
// consequence is measured in docs/audits/stage-3-public-invitation.md rather than asserted here.
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Support = lazy(() => import("./pages/Support"));
const MyData = lazy(() => import("./pages/MyData"));
const CreateProject = lazy(() => import("./pages/CreateProject"));
const ConfigureProject = lazy(() => import("./pages/ConfigureProject"));
const EditProject = lazy(() => import("./pages/EditProject"));
const PublicInvitation = lazy(() => import("./pages/PublicInvitation"));
const FamilyReview = lazy(() => import("./pages/FamilyReview"));
const GuestDoor = lazy(() => import("./pages/GuestDoor"));
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

/** Every route that answers to a signed-in person, and the only place the session
 *  machinery exists. `AuthProvider` subscribes to `onAuthStateChange` and reads
 *  `getSession()` as soon as it mounts, so a guest who opens a shared link must never render
 *  through it: they have no account, the invitation needs no session to read, and a page that
 *  asks for one is a page that touched a stranger's device for nothing.
 *
 *  `PublicInvitation` and `FamilyReview` are siblings of this component rather than children of
 *  it — see `App`. */
const AccountApplication = () => (
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
        {/* Both of these read only what `auth.uid()` owns, and both write through a door that re-derives the
            same caller — so they belong behind the session like the dashboard does. A signed-out visitor who
            asks for `/support` gets the login page, which is the honest answer: support in this product is a
            thread attached to an account, and there is no anonymous door to a host's own tickets. */}
        <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
        <Route path="/my-data" element={<ProtectedRoute><MyData /></ProtectedRoute>} />
        <Route path="/create-project" element={<ProtectedRoute><CreateProject /></ProtectedRoute>} />
        <Route path="/project/:id/configure" element={<ProtectedRoute><ConfigureProject /></ProtectedRoute>} />
        <Route path="/project/:id/edit" element={<ProtectedRoute><EditProject /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  </AuthProvider>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {/* One router, two halves: the guest's page is matched first and rendered with no
            auth anywhere in its tree; everything else is the account application. */}
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Deliberately outside `AuthProvider` and not wrapped in `ProtectedRoute`: a
                guest has no account, the page reads one anonymous RPC, and adding auth here
                would turn every shared link into a login wall — which is the opposite of
                the product. */}
            <Route path="/i/:token" element={<PublicInvitation />} />
            {/* Stage 7's reviewer is a guest of the same kind: a relative holding a credential,
                with no account and nothing to sign in to. Same reason, same placement — and the
                chunk is separate, because a relative who came to approve an invitation has no
                more use of the editor than a guest does. */}
            <Route path="/r/:token" element={<FamilyReview />} />
            {/* Stage 8's household is a guest of the same third kind: one credential in one header, no
                account, nothing to sign in to. Same reason, same placement — and its own chunk, because a
                family came to read an invitation and answer it, not to see an editor, a dashboard or a
                sign-in form. */}
            <Route path="/g/:token" element={<GuestDoor />} />
            <Route path="/*" element={<AccountApplication />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
