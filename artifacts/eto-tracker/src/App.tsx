import { useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import EtoList from "@/pages/EtoList";
import NewEtoRequest from "@/pages/NewEtoRequest";
import EtoDetail from "@/pages/EtoDetail";
import Admin from "@/pages/Admin";
import WorkflowDiagram from "@/pages/WorkflowDiagram";
import AppLayout from "@/components/AppLayout";
import NotFound from "@/pages/not-found";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function SignInPage() {
  const { login } = useAuth();

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <p className="mb-4 text-slate-600">Sign in to ETO Tracker to access your queue.</p>
        <button
          type="button"
          onClick={login}
          className="rounded-lg bg-[#1E3A5F] px-6 py-3 font-medium text-white transition-colors hover:bg-[#162d4a]"
        >
          Sign In
        </button>
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { isLoading, isAuthenticated, login } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return (
      <AppLayout>
        <Dashboard />
      </AppLayout>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-slate-50 p-8">
      <div className="flex items-center gap-3">
        <img src={`${basePath}/logo.svg`} alt="ETO Tracker" className="h-12" />
        <span className="text-2xl font-bold text-slate-900">ETO Tracker</span>
      </div>
      <p className="max-w-sm text-center text-slate-500">
        Engineer-To-Order request tracking for your test lab. Sign in to access your queue.
      </p>
      <button
        type="button"
        onClick={login}
        className="rounded-lg bg-[#1E3A5F] px-6 py-3 font-medium text-white transition-colors hover:bg-[#162d4a]"
      >
        Sign In
      </button>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-500">Loading…</p>
    </div>
  );
}

function AuthenticatedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <SignInPage />;

  return <AppLayout>{children}</AppLayout>;
}

function AuthQueryClientCacheInvalidator() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isLoading) return;
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      qc.clear();
    }
    previousUserId.current = userId;
  }, [isLoading, user?.id, qc]);

  return null;
}

function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryClientCacheInvalidator />
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/dashboard">
          <AuthenticatedRoute><Dashboard /></AuthenticatedRoute>
        </Route>
        <Route path="/eto-requests/new">
          <AuthenticatedRoute><NewEtoRequest /></AuthenticatedRoute>
        </Route>
        <Route path="/eto-requests/:id">
          {(params) => <AuthenticatedRoute><EtoDetail id={Number(params.id)} /></AuthenticatedRoute>}
        </Route>
        <Route path="/eto-requests">
          <AuthenticatedRoute><EtoList /></AuthenticatedRoute>
        </Route>
        <Route path="/admin">
          <AuthenticatedRoute><Admin /></AuthenticatedRoute>
        </Route>
        <Route path="/workflow">
          <AuthenticatedRoute><WorkflowDiagram /></AuthenticatedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <AppRouter />
        <Toaster />
      </WouterRouter>
    </TooltipProvider>
  );
}

export default App;