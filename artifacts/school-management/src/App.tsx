import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetSetupStatus, useGetCurrentUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { SetupPage, LoginPage } from '@/pages/auth';
import Dashboard from '@/pages/dashboard';
import Students from '@/pages/students';
import StudentDetail from '@/pages/student-detail';
import Guardians from '@/pages/guardians';
import Academics from '@/pages/academics';
import Staff from '@/pages/staff';
import SettingsPage from '@/pages/settings';
import ImportPage from '@/pages/import';
import Audit from '@/pages/audit';
import Schools from '@/pages/schools';
import { Shell } from '@/components/shell';
import { SessionProvider, usePerms, errMsg } from '@/lib/session';
import { ErrorState } from '@/components/kit';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

function Splash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-sm bg-primary font-display text-lg font-bold text-primary-foreground">R</div>
        <div className="h-1 w-24 overflow-hidden rounded bg-muted"><div className="h-full w-1/2 animate-pulse bg-amber-500" /></div>
      </div>
    </div>
  );
}

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  if (!allow) return <ErrorState msg="Your role does not have access to this page. Ask your school administrator if you need it." />;
  return <>{children}</>;
}

function AppRoutes() {
  const p = usePerms();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/students" component={Students} />
      <Route path="/students/:id" component={StudentDetail} />
      <Route path="/guardians"><Guard allow={p.viewGuardians}><Guardians /></Guard></Route>
      <Route path="/academics"><Guard allow={p.manageSchool}><Academics /></Guard></Route>
      <Route path="/staff"><Guard allow={p.manageSchool}><Staff /></Guard></Route>
      <Route path="/settings"><Guard allow={p.manageSchool}><SettingsPage /></Guard></Route>
      <Route path="/import"><Guard allow={p.importStudents}><ImportPage /></Guard></Route>
      <Route path="/schools"><Guard allow={p.platform}><Schools /></Guard></Route>
      <Route path="/audit"><Guard allow={p.viewAudit}><Audit /></Guard></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Gate() {
  const setup = useGetSetupStatus();
  const needsSetup = setup.data?.needsSetup;
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), enabled: needsSetup === false, retry: false } });

  if (setup.isLoading) return <Splash />;
  if (setup.isError) return <div className="min-h-[100dvh] bg-background pt-24"><ErrorState msg={errMsg(setup.error, 'Could not reach the server.')} onRetry={() => setup.refetch()} /></div>;
  if (needsSetup) return <SetupPage />;
  if (me.isLoading) return <Splash />;
  if (me.isError) {
    if (me.error?.status === 401) return <LoginPage />;
    return <div className="min-h-[100dvh] bg-background pt-24"><ErrorState msg={`${errMsg(me.error, 'Could not load your session.')} Your sign-in is kept; check the connection and retry.`} onRetry={() => me.refetch()} /></div>;
  }
  if (!me.data) return <LoginPage />;
  return (
    <SessionProvider session={me.data}>
      <Shell>
        <RoutedErrorBoundary><AppRoutes /></RoutedErrorBoundary>
      </Shell>
    </SessionProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Gate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
