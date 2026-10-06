import { type ReactNode } from 'react';
import { isConnectionFailure, retryRead } from '@/lib/connection-recovery';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetSetupStatus, useGetCurrentUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { SetupPage, LoginPage } from '@/pages/auth';
import { RegisterPage, RegistrationStatusPage } from '@/pages/register';
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
import PlatformOverview from '@/pages/platform-overview';
import PlatformSchool from '@/pages/platform-school';
import PlatformAuditPage from '@/pages/platform-audit';
import { PlatformRecovery } from '@/components/platform-kit';
import { toast } from '@/hooks/use-toast';
import Account from '@/pages/account';
import Fees from '@/pages/fees';
import Invoices from '@/pages/invoices';
import Payments from '@/pages/payments';
import Approvals from '@/pages/approvals';
import Sponsors from '@/pages/sponsors';
import Jobs from '@/pages/jobs';
import Integrations from '@/pages/integrations';
import Reconciliation from '@/pages/reconciliation';
import PaymentPlans from '@/pages/payment-plans';
import Notifications from '@/pages/notifications';
import Curriculum from '@/pages/curriculum';
import Assessments from '@/pages/assessments';
import ReportCards from '@/pages/report-cards';
import Attendance from '@/pages/attendance';
import Reports from '@/pages/reports';
import MessagingSettingsPage, { PlatformMessagingPage } from '@/pages/messaging-settings';
import { Shell } from '@/components/shell';
import { SessionProvider, usePerms, useAuthSession, errMsg } from '@/lib/session';
import { ErrorState } from '@/components/kit';
import { LicenceAccessGate } from '@/components/licence-gate';
import LicencePlans from '@/pages/licence-plans';
import SubscriptionPage from '@/pages/subscription';

let readOnlySession = false;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: (query) => isConnectionFailure(query.state.error),
      refetchOnReconnect: true,
      retry: retryRead,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchInterval: (query) => isConnectionFailure(query.state.error) ? 10000 : false,
      refetchIntervalInBackground: false,
    },
    mutations: { retry: false },
  },
  mutationCache: new MutationCache({
    onError: (e) => {
      // Global feedback when a read-only support grant blocks a mutation server-side.
      const status = (e as { status?: number } | null)?.status;
      if (readOnlySession && status === 403) toast({ title: 'Read-only support session', description: 'This change was blocked. Exit and re-enter with write access if needed.' });
    },
  }),
});

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

function PlatformRoutes() {
  return (
    <Switch>
      <Route path="/" component={PlatformOverview} />
      <Route path="/schools" component={Schools} />
      <Route path="/schools/:id" component={PlatformSchool} />
      <Route path="/platform/audit" component={PlatformAuditPage} />
      <Route path="/platform/licence-plans" component={LicencePlans} />
      <Route path="/platform/messaging" component={PlatformMessagingPage} />
      <Route path="/account" component={Account} />
      <Route><ErrorState msg="That page belongs to a school workspace. Open a school from the Schools list to enter it with a recorded reason." /></Route>
    </Switch>
  );
}

function TenantOnly({ children }: { children: ReactNode }) {
  const s = useAuthSession();
  if (!s.school) return <div><ErrorState msg="No school is bound to this session. The support grant may have ended." />{s.user.role === 'super_admin' && <PlatformRecovery />}</div>;
  return <>{children}</>;
}

function ModeRoutes() {
  const s = useAuthSession();
  readOnlySession = s.mode === 'tenant' && !!s.tenantAccess && !s.tenantAccess.writeEnabled;
  if (s.mode === 'platform') {
    // Defence in depth: only the platform owner may ever render platform pages.
    if (s.user.role !== 'super_admin') return <ErrorState msg="Your account has no school workspace. Ask your school administrator." />;
    return <PlatformRoutes />;
  }
  return <TenantOnly><AppRoutes /></TenantOnly>;
}

function AppRoutes() {
  const p = usePerms();
  const s = useAuthSession();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/students" component={Students} />
      <Route path="/account" component={Account} />
      <Route path="/students/:id" component={StudentDetail} />
      <Route path="/guardians"><Guard allow={p.viewGuardians}><Guardians /></Guard></Route>
      <Route path="/academics"><Guard allow={p.manageSchool}><Academics /></Guard></Route>
      <Route path="/staff"><Guard allow={p.manageSchool}><Staff /></Guard></Route>
      <Route path="/settings"><Guard allow={p.manageSchool}><SettingsPage /></Guard></Route>
      <Route path="/import"><Guard allow={p.importStudents}><ImportPage /></Guard></Route>
      <Route path="/schools">{s.user.role === 'super_admin' ? <div><ErrorState msg="Platform pages are unavailable inside a school workspace. Exit to the platform console first." /><PlatformRecovery /></div> : <Guard allow={false}><Schools /></Guard>}</Route>
      <Route path="/schools/:id"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/audit"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/licence-plans"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/messaging"><Guard allow={false}><span /></Guard></Route>
      <Route path="/messaging"><Guard allow={p.integrations}><MessagingSettingsPage /></Guard></Route>
      <Route path="/subscription"><Guard allow={s.user.role !== 'super_admin'}><SubscriptionPage /></Guard></Route>
      <Route path="/fees"><Guard allow={p.financeRead}><Fees /></Guard></Route>
      <Route path="/invoices"><Guard allow={p.financeRead}><Invoices /></Guard></Route>
      <Route path="/payments"><Guard allow={p.financeRead}><Payments /></Guard></Route>
      <Route path="/approvals"><Guard allow={p.financeRead}><Approvals /></Guard></Route>
      <Route path="/sponsors"><Guard allow={p.financeRead}><Sponsors /></Guard></Route>
      <Route path="/jobs"><Guard allow={p.financeJobs}><Jobs /></Guard></Route>
      <Route path="/integrations"><Guard allow={p.integrations}><Integrations /></Guard></Route>
      <Route path="/reconciliation"><Guard allow={p.financeRead}><Reconciliation /></Guard></Route>
      <Route path="/payment-plans"><Guard allow={p.financeRead}><PaymentPlans /></Guard></Route>
      <Route path="/notifications"><Guard allow={p.financeRead}><Notifications /></Guard></Route>
      <Route path="/curriculum"><Guard allow={p.academicRead}><Curriculum /></Guard></Route>
      <Route path="/assessments"><Guard allow={p.academicRead}><Assessments /></Guard></Route>
      <Route path="/report-cards"><Guard allow={p.academicRead}><ReportCards /></Guard></Route>
      <Route path="/attendance"><Guard allow={p.academicRead}><Attendance /></Guard></Route>
      <Route path="/reports"><Guard allow={p.reports}><Reports /></Guard></Route>
      <Route path="/audit"><Guard allow={p.viewAudit}><Audit /></Guard></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Gate() {
  const [loc] = useLocation();
  const unauth = loc === '/register' ? <RegisterPage /> : <LoginPage />;
  const setup = useGetSetupStatus();
  const needsSetup = setup.data?.needsSetup;
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), enabled: needsSetup === false, retry: false } });

  if (setup.isLoading) return <Splash />;
  if (setup.isError) return <div className="min-h-[100dvh] bg-background pt-24"><ErrorState msg={errMsg(setup.error, 'Could not reach the server.')} onRetry={() => setup.refetch()} /></div>;
  if (needsSetup) return <SetupPage />;
  if (me.isLoading) return <Splash />;
  if (me.isError) {
    if (me.error?.status === 401) return unauth;
    return <div className="min-h-[100dvh] bg-background pt-24"><ErrorState msg={`${errMsg(me.error, 'Could not load your session.')} Your sign-in is kept; check the connection and retry.`} onRetry={() => me.refetch()} />{me.error?.status === 403 && <PlatformRecovery />}</div>;
  }
  if (!me.data) return unauth;
  if (me.data.mode === 'registration') return <RegistrationStatusPage session={me.data} />;
  return (
    <SessionProvider session={me.data}>
      <Shell>
        <RoutedErrorBoundary><LicenceAccessGate><ModeRoutes /></LicenceAccessGate></RoutedErrorBoundary>
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
