import { Link, Redirect } from "wouter";
import {
  useGetDashboardSummary, useGetFinanceArrears, getGetFinanceArrearsQueryKey, useGetFinanceSummary, getGetFinanceSummaryQueryKey, useListApprovalInbox, useListPaymentExceptions, useGetSchoolSubscription,
  getListApprovalInboxQueryKey, getListPaymentExceptionsQueryKey, getGetSchoolSubscriptionQueryKey,
  useListPurchaseOrders, getListPurchaseOrdersQueryKey, useListStoreItems, getListStoreItemsQueryKey, useGetLibrarySummary, getGetLibrarySummaryQueryKey,
  useListSupplierInvoices, getListSupplierInvoicesQueryKey,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowRight, BarChart3, BookUp, CalendarCheck, CheckCircle2, ClipboardCheck, ClipboardList, Compass, CreditCard, FileText, Library, Package, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import { ErrorState } from "@/components/kit";
import { useOnboarding } from "@/components/guide";
import { useTermStatus } from "@/pages/term-setup";
import { SETUP_STEPS } from "@/lib/guide";
import { SetupItem, useNextSetupStep } from "@/components/setup-card";
import { GettingStarted, InsightTiles, MoneyInsights, TermStrip, TodayCard } from "@/components/home-panels";
import { useInstallation } from "@/lib/installation";
import { useSession, usePerms, errMsg, fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";
import { kes } from "@/lib/finance";



type Todo = { key: string; icon: typeof Compass; tone: "urgent" | "normal"; title: string; detail?: string; href: string; action: string };

/** Everything that needs this person now, most urgent first. Nothing else. */
function useTodos(): { todos: Todo[]; loading: boolean } {
  const { user, tenantAccess } = useSession();
  const p = usePerms();
  const install = useInstallation();
  const isAdmin = user.role === "school_admin";
  const term = useTermStatus();
  const setup = useOnboarding();
  const approvals = useListApprovalInbox({ query: { queryKey: getListApprovalInboxQueryKey(), enabled: p.financeDecide } });
  const arrears = useGetFinanceArrears({ query: { queryKey: getGetFinanceArrearsQueryKey(), enabled: p.financeRead } });
  const summary = useGetFinanceSummary(undefined, { query: { queryKey: getGetFinanceSummaryQueryKey(), enabled: p.financeRead } });
  const unmatched = useListPaymentExceptions({ query: { queryKey: getListPaymentExceptionsQueryKey(), enabled: p.financeRead } });
  const sub = useGetSchoolSubscription({ query: { queryKey: getGetSchoolSubscriptionQueryKey(), enabled: isAdmin && install.hosted && !tenantAccess } });
  const pendingLpo = { status: "pending" as const };
  const lpos = useListPurchaseOrders(pendingLpo, { query: { queryKey: getListPurchaseOrdersQueryKey(pendingLpo), enabled: p.approveLpo } });
  const stock = useListStoreItems({ query: { queryKey: getListStoreItemsQueryKey(), enabled: p.store } });
  const library = useGetLibrarySummary({ query: { queryKey: getGetLibrarySummaryQueryKey(), enabled: p.library } });
  const unpaidBills = { state: "unpaid" as const };
  const bills = useListSupplierInvoices(unpaidBills, { query: { queryKey: getListSupplierInvoicesQueryKey(unpaidBills), enabled: p.expenses } });
  const todos: Todo[] = [];

  const s = sub.data;
  if (s && !s.accessAllowed) todos.push({ key: "sub", icon: ShieldCheck, tone: "urgent", title: s.status === "expired" && !s.managed ? "Your free trial has ended" : "Your subscription has ended", detail: "Staff can't use the system until you renew.", href: "/subscription", action: "Renew" });
  // Trials (and licences the platform manages) already get the reminder banner at the top of Home; don't repeat it.
  else if (s?.currentEndsAt && s.status === "active" && !s.managed && Date.parse(s.currentEndsAt) - Date.now() < 5 * 86_400_000)
    todos.push({ key: "sub", icon: ShieldCheck, tone: "urgent", title: `Your subscription ends ${fmtDate(s.currentEndsAt)}`, href: "/subscription", action: "Renew" });

  if (p.manageSchool && term) {
    if (term.kind === "term-ended") todos.push({ key: "term", icon: CalendarCheck, tone: "urgent", title: `${term.current.name} has closed. Start ${term.next.name}`, detail: "Then check fees and bill learners for the new term.", href: "/term-setup", action: `Start ${term.next.name}` });
    else if (term.kind === "year-ended") todos.push({ key: "term", icon: CalendarCheck, tone: "urgent", title: "The school year has ended. Start the new one", detail: "Set next year's term dates, then move learners up a grade.", href: "/term-setup?step=calendar&new=1", action: "Start new year" });
    else if (term.kind === "pick-term") todos.push({ key: "term", icon: CalendarCheck, tone: "urgent", title: "No term is in progress", href: "/term-setup", action: "Choose the term" });
    else if (term.kind === "in-term" && term.endsSoon) todos.push({ key: "term", icon: CalendarCheck, tone: "normal", title: `${term.current.name} closes ${fmtDate(term.current.endDate)}`, detail: "Prepare next term's fees now.", href: "/fee-structure", action: "Prepare" });
  }
  // Not part of first-time setup: once classes exist, ask for the register, then (with fees set) for billing.
  const step = (id: string) => setup.data?.steps.find((x) => x.id === id);
  // Admins see these two in the Getting started checklist instead; others get them here.
  if (!p.manageSchool && p.financeRead && step("classes")?.done && !step("learners")?.done)
    todos.push({ key: "learners", icon: UserPlus, tone: "normal", title: "Add your learners", detail: "Upload your register from Excel, or add learners one at a time. Include each parent's phone number.", href: "/students", action: "Add learners" });
  else if (!p.manageSchool && p.financeRead && step("learners")?.done && step("fees")?.done && !step("invoices")?.done)
    todos.push({ key: "billing", icon: Wallet, tone: "normal", title: "Bill learners for this term", detail: "Every learner gets an invoice, so parents can see what they owe and pay against it.", href: "/term-setup?step=billing", action: "Bill learners" });
  // Any active learner without this term's invoice: new admissions after billing, or a term not billed yet.
  // Comes from the learners themselves, not the setup guide, so every finance role sees it.
  const notBilled = arrears.data?.notBilled ?? 0;
  if (p.financeRead && notBilled > 0 && !todos.some((t) => t.key === "billing")) {
    const everyone = notBilled === arrears.data?.rows.length;
    todos.push({ key: "not-billed", icon: Wallet, tone: everyone ? "urgent" : "normal", title: everyone ? `No learner is billed for ${arrears.data?.termName ?? "this term"} yet` : `${notBilled} learner${notBilled === 1 ? " isn't" : "s aren't"} billed for ${arrears.data?.termName ?? "this term"}`, detail: everyone ? `All ${notBilled} learners still need this term's invoice, so parents can't see what they owe.` : "Usually new admissions. Billing again bills only them.", href: p.manageSchool ? "/term-setup?step=billing" : "/balances?show=not-billed", action: p.manageSchool ? "Bill them" : "See who" });
  }
  // Finance Book's warnings, raised here so nobody has to go looking for them.
  const fb = summary.data;
  if (p.financeRead && fb) {
    if (fb.health.verdict === "deficit") todos.push({ key: "deficit", icon: AlertTriangle, tone: "urgent", title: `Spending is ahead of fees by ${kes(String(-Number(fb.health.left)))}`, detail: `${fb.termName}: more has gone out than came in.`, href: "/finances", action: "See why" });
    if (fb.owed.promisesBroken > 0) todos.push({ key: "promises", icon: Wallet, tone: "normal", title: `${fb.owed.promisesBroken} promise${fb.owed.promisesBroken === 1 ? " to pay was" : "s to pay were"} broken`, detail: "The date passed without the payment. Remind them in one go.", href: "/balances", action: "Remind" });
    if (fb.adjustments.flagged.length > 0) todos.push({ key: "flagged", icon: ShieldCheck, tone: "normal", title: `${fb.adjustments.flagged.length} discount${fb.adjustments.flagged.length === 1 ? "" : "s"} or reversal${fb.adjustments.flagged.length === 1 ? "" : "s"} worth a look`, detail: "Large discounts, reversals, refunds or voided expenses this term.", href: "/finances", action: "Review" });
  }
  const pending = approvals.data?.length ?? 0;
  if (pending) todos.push({ key: "approvals", icon: CheckCircle2, tone: "urgent", title: `${pending} request${pending === 1 ? "" : "s"} waiting for your approval`, detail: "Fee changes, waivers or refunds someone else submitted.", href: "/approvals", action: "Review" });
  // LPOs someone else raised, waiting for this person's approval.
  const toApprove = (lpos.data ?? []).filter((o) => o.createdBy !== user.id || isAdmin);
  if (toApprove.length) todos.push({ key: "lpos", icon: ClipboardList, tone: "urgent", title: `${toApprove.length} LPO${toApprove.length === 1 ? "" : "s"} waiting for your approval`, detail: toApprove.slice(0, 3).map((o) => `${o.reference} · ${o.supplierName} · ${kes(o.total)}`).join("; "), href: "/purchases", action: "Review" });
  const lateBills = (bills.data ?? []).filter((b) => b.state === "overdue");
  if (lateBills.length) todos.push({ key: "bills", icon: FileText, tone: "normal", title: `${lateBills.length} supplier invoice${lateBills.length === 1 ? " is" : "s are"} past the due date`, detail: `${kes(String(lateBills.reduce((t, b) => t + Number(b.balance), 0)))} still to pay.`, href: "/supplier-invoices", action: "Pay" });
  const low = (stock.data ?? []).filter((i) => i.low);
  if (low.length) todos.push({ key: "low-stock", icon: Package, tone: "normal", title: `${low.length} store item${low.length === 1 ? " is" : "s are"} running low`, detail: low.slice(0, 4).map((i) => `${i.name} (${Number(i.quantity).toLocaleString("en-KE")} ${i.unit})`).join(", "), href: "/store", action: p.procurement ? "Reorder" : "See stock" });
  const overdueBooks = library.data?.overdue ?? 0;
  if (overdueBooks) todos.push({ key: "overdue-books", icon: Library, tone: "normal", title: `${overdueBooks} library book${overdueBooks === 1 ? " is" : "s are"} overdue`, detail: "Past the date they were due back.", href: "/library/loans?show=overdue", action: "See who" });
  const open = (unmatched.data ?? []).filter((x) => x.status === "open").length;
  if (open) todos.push({ key: "unmatched", icon: Wallet, tone: "normal", title: `${open} payment${open === 1 ? "" : "s"} couldn't be matched to a learner`, detail: "Usually a wrong admission number. Assign each to the right learner.", href: "/payments?show=unmatched", action: "Assign" });


  const loading = approvals.isLoading || unmatched.isLoading || arrears.isLoading || sub.isLoading || term === null;
  return { todos, loading };
}

function QuickActions() {
  const p = usePerms();
  const actions = [
    { show: p.writeStudents, href: "/students?new=1", label: "Admit a learner", icon: UserPlus },
    { show: p.store && !p.financeRead, href: "/store", label: "Issue stock", icon: Package },
    { show: p.library, href: "/library/loans", label: "Lend a book", icon: BookUp },
    { show: p.procurement && !p.store, href: "/purchases?new=1", label: "Raise an LPO", icon: ClipboardList },
    { show: p.collect, href: "/payments", label: "Record a payment", icon: CreditCard },
    { show: p.academicRead, href: "/attendance", label: "Take attendance", icon: CalendarCheck },
    { show: p.academicRead, href: "/assessments", label: "Enter marks", icon: ClipboardCheck },
    { show: p.financeRead, href: "/balances", label: "See who owes", icon: Wallet },
    { show: p.reports, href: "/reports", label: "Reports", icon: BarChart3 },
  ].filter((a) => a.show).slice(0, 4);
  if (!actions.length) return null;
  return (
    // Phone: one row that slides sideways, not a stack of pills.
    <div className="flex flex-wrap gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="quick-actions">
      {actions.map((a) => (
        <Link key={a.href} href={a.href} data-testid={`quick-${a.href.slice(1).split("?")[0]}`} className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-sm font-medium transition hover:border-primary/40 hover:text-primary max-md:h-8 max-md:px-3 max-md:text-[13px]">
          <a.icon className="h-4 w-4 text-primary" />{a.label}
        </Link>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useSession();
  const p = usePerms();
  const q = useGetDashboardSummary();
  const d = q.data;
  const { todos, loading: todosLoading } = useTodos();
  const setup = useNextSetupStep();
  const loading = todosLoading || setup.loading;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Nairobi" }).format(new Date());

  if (setup.loading) return <div className="mx-auto max-w-4xl space-y-4 py-6"><div className="h-2 animate-pulse rounded-full bg-muted" /><div className="h-10 w-2/3 animate-pulse rounded-lg bg-muted" /></div>;

  return (
    <div className="space-y-5 max-md:space-y-3.5">
      {/* The phone's top bar already names the school and the term, so this greeting block is for computers only. */}
      <header className="flex flex-wrap items-end justify-between gap-4 max-md:hidden">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{date}{d?.schoolName ? ` · ${d.schoolName}` : ""}</div>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight max-md:mt-0 max-md:text-xl sm:text-3xl">{greet}, {user.name.split(" ")[0]}</h1>
        </div>
        <TermStrip />
      </header>

      <QuickActions />
      {p.register && <InsightTiles />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {/* With nothing waiting and setup finished, the whole section steps aside. */}
          {(loading || todos.length > 0 || setup.next) && <section aria-labelledby="todo-title" className="overflow-hidden rounded-2xl border border-border bg-card">
            <h2 id="todo-title" className="border-b border-border/60 px-5 py-3.5 font-semibold">What needs you</h2>
            <SetupItem />
            {loading ? <div className="space-y-3 p-5">{[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
              : !todos.length ? setup.next ? null : (
                <div className="flex items-center gap-3 px-5 py-6 text-sm" data-testid="todo-empty"><CheckCircle2 className="h-6 w-6 text-primary" /><span><b>You're all caught up.</b> <span className="text-muted-foreground">Nothing needs you right now.</span></span></div>
              ) : (
                <ul className={cn("divide-y divide-border/60", setup.next && "border-t border-border/60")}>
                  {todos.map((t) => (
                    <li key={t.key} data-testid={`todo-${t.key}`}>
                      <Link href={t.href} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-muted/40">
                        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", t.tone === "urgent" ? "bg-amber-500/15 text-amber-700" : "bg-primary/10 text-primary")}><t.icon className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1"><span className="block font-semibold">{t.title}</span>{t.detail && <span className="block text-sm text-muted-foreground">{t.detail}</span>}</span>
                        <span className="hidden shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground sm:inline-flex">{t.action}<ArrowRight className="h-3.5 w-3.5" /></span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </section>}
          <GettingStarted />
        </div>
        <div className="min-w-0 space-y-5">
          {p.register && <TodayCard />}
        </div>
      </div>
      {p.financeRead && <MoneyInsights />}
      {q.isError && <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} />}
    </div>
  );
}
