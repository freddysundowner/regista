import { useEffect, type ReactNode } from 'react';
import { APP_INITIAL } from '@/lib/brand';
import { isConnectionFailure, retryRead } from '@/lib/connection-recovery';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { Route, Switch, useLocation, Redirect, Router as WouterRouter } from 'wouter';
import { useGetSetupStatus, useGetCurrentUser, getGetCurrentUserQueryKey, getGetOnboardingQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { SetupPage, LoginPage, RecoveryPage } from '@/pages/auth';
import { RegistrationStatusPage } from '@/pages/register';
import type { AuthPanelMode } from '@/components/auth-flow';
import { LandingPage } from '@/pages/landing';
import Dashboard from '@/pages/dashboard';
import Balances from '@/pages/balances';
import Finances from '@/pages/finances';
import Expenses from '@/pages/expenses';
import Purchases from '@/pages/purchases';
import LpoPrint from '@/pages/lpo-print';
import SupplierInvoices from '@/pages/supplier-invoices';
import Suppliers from '@/pages/suppliers';
import Store from '@/pages/store';
import StoreMovements from '@/pages/store-movements';
import LibraryBooks from '@/pages/library';
import LibraryLoans from '@/pages/library-loans';
import { SetupGate } from '@/components/setup-card';
import Students from '@/pages/students';
import StudentDetail from '@/pages/student-detail';
import Guardians from '@/pages/guardians';
import Academics from '@/pages/academics';
import ClassDetail from '@/pages/class-detail';
import Staff from '@/pages/staff';
import TeacherAssignments from '@/pages/teacher-assignments';
import StaffProfile from '@/pages/staff-profile';
import SettingsPage from '@/pages/settings';
import ImportPage from '@/pages/import';
import Audit from '@/pages/audit';
import Schools from '@/pages/schools';
import PlatformOverview from '@/pages/platform-overview';
import PlatformSchool from '@/pages/platform-school';
import PlatformAuditPage from '@/pages/platform-audit';
import PlatformSubscriptions from '@/pages/platform-subscriptions';
import { PlatformRecovery } from '@/components/platform-kit';
import { toast } from '@/hooks/use-toast';
import Account from '@/pages/account';
import Fees from '@/pages/fees';
import FeeStructure from '@/pages/fee-structure';
import FeeStructurePrint from '@/pages/fee-structure-print';
import Invoices from '@/pages/invoices';
import Payments from '@/pages/payments';
import Approvals from '@/pages/approvals';
import Sponsors from '@/pages/sponsors';
import Integrations from '@/pages/integrations';
import MpesaSettingsPage from '@/pages/settings-mpesa';
import BankSettingsPage from '@/pages/settings-bank';
import Reconciliation from '@/pages/reconciliation';
import PaymentPlans from '@/pages/payment-plans';
import Notifications from '@/pages/notifications';
import Curriculum from '@/pages/curriculum';
import Assessments from '@/pages/assessments';
import ReportCards from '@/pages/report-cards';
import Attendance from '@/pages/attendance';
import Reports from '@/pages/reports';
import EmailCampaignsPage from '@/pages/email-campaigns';
import PlatformSettings from '@/pages/platform-settings';
import WhatsappSettingsPage from '@/pages/whatsapp-settings';
import { Shell } from '@/components/shell';
import { SessionProvider, usePerms, useAuthSession, errMsg } from '@/lib/session';
import { ErrorState } from '@/components/kit';
import { LicenceAccessGate } from '@/components/licence-gate';
import SubscriptionPage from '@/pages/subscription';
import { SupportChatPage, PlatformSupportPage } from '@/components/support-chat';
import PlatformKnowledgePage from '@/pages/platform-knowledge';
import ManualPage from '@/pages/manual';
import LegalPage from '@/pages/legal';
import { useVisibleArea } from '@/hooks/use-visible-area';
import LicencePage from '@/pages/licence';
import TermSetup from '@/pages/term-setup';
import { useInstallation } from '@/lib/installation';

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
    // Any saved change may complete a setup step; refresh the guide straight away.
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() }); },
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
        <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-sm bg-primary font-display text-lg font-bold text-primary-foreground">{APP_INITIAL}</div>
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
      <Route path="/login"><Redirect to="/" replace /></Route>
      <Route path="/register"><Redirect to="/" replace /></Route>
      <Route path="/setup"><Redirect to="/" replace /></Route>
      <Route path="/" component={PlatformOverview} />
      <Route path="/schools" component={Schools} />
      <Route path="/schools/:id" component={PlatformSchool} />
      <Route path="/platform/audit" component={PlatformAuditPage} />
      <Route path="/platform/subscriptions" component={PlatformSubscriptions} />
      <Route path="/platform/support" component={PlatformSupportPage} />
      <Route path="/platform/knowledge" component={PlatformKnowledgePage} />
      <Route path="/platform/settings/whatsapp"><WhatsappSettingsPage platform /></Route>
      <Route path="/platform/settings" component={PlatformSettings} />
      <Route path="/platform/licence-plans"><Redirect to="/platform/settings?tab=keys" replace /></Route>
      <Route path="/platform/messaging"><Redirect to="/platform/settings?tab=messaging" replace /></Route>
      <Route path="/platform/emails"><EmailCampaignsPage platform /></Route>
      <Route path="/account" component={Account} />
      <Route path="/licence" component={LicencePage} />
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
  return <TenantOnly><SetupGate><AppRoutes /></SetupGate></TenantOnly>;
}

function AppRoutes() {
  const p = usePerms();
  const s = useAuthSession();
  return (
    <Switch>
      <Route path="/login"><Redirect to="/" replace /></Route>
      <Route path="/register"><Redirect to="/" replace /></Route>
      <Route path="/setup"><Redirect to="/" replace /></Route>
      <Route path="/" component={Dashboard} />
      <Route path="/students"><Guard allow={p.register}><Students /></Guard></Route>
      <Route path="/account" component={Account} />
      <Route path="/support"><Guard allow={!s.tenantAccess}><SupportChatPage /></Guard></Route>
      <Route path="/students/:id"><Guard allow={p.register}><StudentDetail /></Guard></Route>
      <Route path="/guardians"><Guard allow={p.viewGuardians}><Guardians /></Guard></Route>
      <Route path="/classes"><Guard allow={p.manageSchool}><Academics /></Guard></Route>
      <Route path="/classes/:kind/:id"><Guard allow={p.manageSchool}><ClassDetail /></Guard></Route>
      <Route path="/academics"><Redirect to="/classes" replace /></Route>
      <Route path="/staff"><Guard allow={p.manageSchool}><Staff /></Guard></Route>
      <Route path="/staff/:id"><Guard allow={p.manageSchool}><StaffProfile /></Guard></Route>
      <Route path="/teacher-assignments"><Guard allow={p.manageSchool}><TeacherAssignments /></Guard></Route>
      <Route path="/settings/messaging/whatsapp"><Guard allow={p.manageSchool}><WhatsappSettingsPage /></Guard></Route>
      <Route path="/settings/whatsapp"><Redirect to="/settings/messaging/whatsapp" replace /></Route>
      <Route path="/settings/email"><Guard allow={p.manageSchool}><SettingsPage page="email" /></Guard></Route>
      <Route path="/settings/messaging"><Guard allow={p.manageSchool}><SettingsPage page="messaging" /></Guard></Route>
      <Route path="/settings/mpesa"><Guard allow={p.integrations}><MpesaSettingsPage /></Guard></Route>
      <Route path="/settings/bank"><Guard allow={p.integrations}><BankSettingsPage /></Guard></Route>
      <Route path="/settings"><Guard allow={p.manageSchool}><SettingsPage /></Guard></Route>
      <Route path="/import"><Guard allow={p.importStudents}><ImportPage /></Guard></Route>
      <Route path="/schools">{s.user.role === 'super_admin' ? <div><ErrorState msg="Platform pages are unavailable inside a school workspace. Exit to the platform console first." /><PlatformRecovery /></div> : <Guard allow={false}><Schools /></Guard>}</Route>
      <Route path="/schools/:id"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/audit"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/licence-plans"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/messaging"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/subscriptions"><Guard allow={false}><span /></Guard></Route>
      <Route path="/platform/settings"><Guard allow={false}><span /></Guard></Route>
      <Route path="/messaging"><Redirect to="/settings/messaging" replace /></Route>
      <Route path="/emails"><Guard allow={s.user.role === 'school_admin'}><EmailCampaignsPage /></Guard></Route>
      <Route path="/platform/emails"><Guard allow={false}><span /></Guard></Route>
      <Route path="/subscription"><Guard allow={s.user.role !== 'super_admin'}><SubscriptionPage /></Guard></Route>
      <Route path="/licence"><Guard allow={s.user.role === 'school_admin'}><LicencePage /></Guard></Route>
      <Route path="/term-setup"><Guard allow={p.manageSchool}><TermSetup /></Guard></Route>
      <Route path="/fee-structure/templates"><Guard allow={p.financeConfigure}><FeeStructurePrint /></Guard></Route>
      <Route path="/fee-structure/print">{() => <Redirect to={`/fee-structure/templates${window.location.search}`} replace />}</Route>
      <Route path="/fee-structure"><Guard allow={p.financeConfigure}><FeeStructure /></Guard></Route>
      <Route path="/fees"><Guard allow={p.financeRead}><Fees /></Guard></Route>
      <Route path="/finances"><Guard allow={p.financeRead}><Finances /></Guard></Route>
      <Route path="/expenses"><Guard allow={p.financeRead || p.expenses}><Expenses /></Guard></Route>
      <Route path="/purchases/:id/print"><Guard allow={p.purchasing}><LpoPrint /></Guard></Route>
      <Route path="/purchases"><Guard allow={p.purchasing}><Purchases /></Guard></Route>
      <Route path="/supplier-invoices"><Guard allow={p.purchasing}><SupplierInvoices /></Guard></Route>
      <Route path="/suppliers"><Guard allow={p.purchasing}><Suppliers /></Guard></Route>
      <Route path="/store/movements"><Guard allow={p.store || p.procurement}><StoreMovements /></Guard></Route>
      <Route path="/store"><Guard allow={p.store || p.procurement}><Store /></Guard></Route>
      <Route path="/library/loans"><Guard allow={p.library}><LibraryLoans /></Guard></Route>
      <Route path="/library"><Guard allow={p.library}><LibraryBooks /></Guard></Route>
      <Route path="/balances"><Guard allow={p.financeRead}><Balances /></Guard></Route>
      <Route path="/invoices"><Guard allow={p.financeRead}><Invoices /></Guard></Route>
      <Route path="/payments"><Guard allow={p.financeRead}><Payments /></Guard></Route>
      <Route path="/approvals"><Guard allow={p.financeRead}><Approvals /></Guard></Route>
      <Route path="/sponsors"><Guard allow={p.financeRead}><Sponsors /></Guard></Route>
      <Route path="/integrations"><Guard allow={p.integrations}><Integrations /></Guard></Route>
      <Route path="/reconciliation"><Guard allow={p.financeRead}><Reconciliation /></Guard></Route>
      <Route path="/payment-plans"><Guard allow={p.financeRead}><PaymentPlans /></Guard></Route>
      <Route path="/notifications"><Guard allow={p.financeRead}><Notifications /></Guard></Route>
      <Route path="/subjects"><Guard allow={p.academicRead}><Curriculum /></Guard></Route>
      <Route path="/curriculum"><Redirect to="/subjects" replace /></Route>
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
  useVisibleArea();
  const [loc] = useLocation();
  const install = useInstallation();
  // A standalone school server has no marketing page or public sign-up: it opens on sign-in.
  // Hosted: sign-in and sign-up open as a panel over the landing page; any other deep link asks to sign in.
  const recovery = loc === '/forgot-password' ? 'forgot' as const : loc === '/reset-password' ? 'reset' as const : null;
  const panel: AuthPanelMode | null = loc === '/' ? null : recovery ?? (loc === '/register' ? 'register' : loc === '/setup' ? 'setup' : 'login');
  const unauth = install.standalone ? (recovery ? <RecoveryPage mode={recovery} /> : <LoginPage />) : <LandingPage panel={panel === 'setup' ? 'register' : panel} needsSetup={false} />;
  const setup = useGetSetupStatus();
  const needsSetup = setup.data?.needsSetup;
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), enabled: needsSetup === false, retry: false } });

  // Only the public landing page is indexable; sign-in and app screens are private.
  useEffect(() => {
    document.querySelector('meta[name="robots"]')?.setAttribute('content', (loc === '/' && !me.data) || loc === '/manual' || loc === '/terms' || loc === '/privacy' ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow');
  }, [loc, me.data]);
  // The manual is public and the same for everyone, so it never waits on the session.
  if (loc === '/manual') return <ManualPage signedIn={!!me.data} />;
  if (loc === '/terms' || loc === '/privacy') return <LegalPage doc={loc === '/terms' ? 'terms' : 'privacy'} signedIn={!!me.data} />;
  // Keep the pre-rendered landing page on screen while checking for a session, instead of a splash.
  if ((setup.isLoading || install.query.isLoading) && loc === '/') return <LandingPage />;
  if (setup.isLoading || install.query.isLoading) return <Splash />;
  if (me.isLoading && loc === '/' && !install.standalone) return <LandingPage />;
  if (setup.isError) return <div className="min-h-[100dvh] bg-background pt-24"><ErrorState msg={errMsg(setup.error, 'Could not reach the server.')} onRetry={() => setup.refetch()} /></div>;
  if (needsSetup) return install.standalone ? <SetupPage /> : <LandingPage panel={panel === 'register' ? 'setup' : panel} needsSetup />;
  // An emailed reset link must open even when this browser is still signed in as someone.
  if (recovery === 'reset') return unauth;
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
