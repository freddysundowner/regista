import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { APP_INITIAL } from "@/lib/brand";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSchool, getGetSchoolQueryKey, useListGrades, getListGradesQueryKey, useGetFinanceOverview, getGetFinanceOverviewQueryKey,
  useUpdateOnboarding, getGetOnboardingQueryKey, useUpdateSchool, type OnboardingStepId,
  useListIntegrationStatus, getListIntegrationStatusQueryKey, useListBankAccounts, getListBankAccountsQueryKey,
  useGetSchoolWhatsappSetup, getGetSchoolWhatsappSetupQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Building, Building2, CalendarDays, Check, CircleDollarSign, Loader2, Layers, MessageCircle, ReceiptText, Smartphone, UserCog, Users } from "lucide-react";
import { Btn, SkeletonRows, Field, TextInput, FormError, Pill } from "@/components/kit";
import { BANKS } from "@/lib/banks";
import { StepAction } from "@/components/step-action";
import { useOnboarding } from "@/components/guide";
import { CalendarStep, ClassesStep, FeesStep, BillingStep } from "@/pages/term-setup";
import ImportPage from "@/pages/import";
import Staff from "@/pages/staff";
import { useAuthSession, usePerms, errMsg } from "@/lib/session";
import { kes } from "@/lib/finance";
import { cn } from "@/lib/utils";

/** Remembered per browser session so the home page sends a new school here once, not on every visit. */
export const SETUP_SEEN_KEY = "rejista.setup.seen";

export type FlowStep = Exclude<OnboardingStepId, "curriculum">;
export const FLOW: { id: FlowStep; label: string; title: string; why: string; icon: typeof Building }[] = [
  { id: "profile", label: "Your school", icon: Building, title: "Name your school", why: "It appears on every receipt, statement and report card parents receive. Phone, address and logo can be added later in School settings." },
  { id: "calendar", label: "Terms", icon: CalendarDays, title: "Set the school year", why: "Fees, attendance and results are all recorded per term, so we start with your term dates." },
  { id: "classes", label: "Classes", icon: Layers, title: "Add your classes", why: "Tick the levels you teach and name your streams. Every grade is created at once." },
  { id: "learners", label: "Learners", icon: Users, title: "Add your learners", why: "Upload the register you already keep in Excel. Siblings link up through their parent's phone number." },
  { id: "fees", label: "Fees", icon: CircleDollarSign, title: "Set your fees", why: "Enter each fee item per grade. Until you bill anyone, saved fees take effect at once." },
  { id: "invoices", label: "Bill learners", icon: ReceiptText, title: "Bill learners for this term", why: "Every learner gets an invoice, so parents can see what they owe and pay against it." },
  { id: "collections", label: "Get paid", icon: Smartphone, title: "Connect M-Pesa and your bank", why: "Payments then match to learners automatically and receipts go out without anyone typing them." },
  { id: "parents", label: "WhatsApp", icon: MessageCircle, title: "Connect your WhatsApp number", why: "Parents check balances, pay and get receipts and results on WhatsApp. No app, no password." },
  { id: "staff", label: "Staff", icon: UserCog, title: "Invite your staff", why: "Add the bursar, principal and teachers. Each sees only what their role needs." },
];

/** One row of the "Get paid" summary: what it is, where it stands, and the button that sets it up. */
function CollectionRow({ icon, title, detail, status, href, action }: { icon: ReactNode; title: string; detail: string; status: { label: string; tone: string }; href: string; action: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">{title}<Pill tone={status.tone}>{status.label}</Pill></span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      <Link href={href} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted">{action}<ArrowRight className="h-3.5 w-3.5" /></Link>
    </li>
  );
}

const BANK_STATUS: Record<string, { label: string; tone: string }> = {
  off: { label: "Not connected", tone: "left" }, requested: { label: "Waiting for bank", tone: "duplicate" }, live: { label: "Live", tone: "active" },
};

/**
 * "Get paid" on the home page: a short summary, not the settings themselves. Each line says where M-Pesa or a
 * bank account stands and links to the Settings tab that sets it up.
 */
function CollectionsStep() {
  const integrations = useListIntegrationStatus({ query: { queryKey: getListIntegrationStatusQueryKey() } });
  const banks = useListBankAccounts({ query: { queryKey: getListBankAccountsQueryKey() } });
  if (integrations.isLoading || banks.isLoading) return <SkeletonRows rows={2} cols={2} />;
  const daraja = integrations.data?.find((x) => x.provider === "daraja");
  const accounts = banks.data ?? [];
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card" data-testid="collections-summary">
        <CollectionRow icon={<Smartphone className="h-4 w-4" />} title="M-Pesa paybill or till" detail="Your own Safaricom paybill, connected through Daraja."
          status={daraja?.configured ? { label: daraja.enabled ? "Connected" : "Saved, turned off", tone: daraja.enabled ? "active" : "inactive" } : { label: "Not set up", tone: "left" }}
          href="/settings/mpesa" action={daraja?.configured ? "Manage" : "Set up"} />
        {accounts.map((a) => (
          <CollectionRow key={a.id} icon={<Building2 className="h-4 w-4" />} title={`${BANKS[a.bank] ?? a.bank} ${a.accountNumber}`} detail={a.accountName}
            status={BANK_STATUS[a.notificationStatus] ?? BANK_STATUS.off} href="/settings/bank" action="Manage" />
        ))}
        <CollectionRow icon={<Building2 className="h-4 w-4" />} title={accounts.length ? "Another bank account" : "Bank account"} detail="NCBA or KCB: each payment reaches Rejista as it happens."
          status={{ label: accounts.length ? "Optional" : "Not added", tone: "left" }} href="/settings/bank" action="Add bank" />
      </ul>
      <p className="text-xs text-muted-foreground">Parents pay with the learner's <b>admission number</b> as the reference.</p>
    </div>
  );
}

/**
 * "WhatsApp" on the home page: where the school's number stands, in plain words, with one way forward. The
 * full connection screen (provider, routing, verification codes) lives on Settings → WhatsApp number.
 */
function ParentsStep() {
  const q = useGetSchoolWhatsappSetup({ query: { queryKey: getGetSchoolWhatsappSetupQueryKey() } });
  if (q.isLoading) return <SkeletonRows rows={1} cols={2} />;
  const s = q.data;
  const active = !!s && (s.connectionActive || s.status === "active");
  const inProgress = !!s && ["pending", "awaiting_code", "connected", "submitting"].includes(s.status);
  const status = active ? { label: "Connected", tone: "active" } : inProgress ? { label: "In progress", tone: "duplicate" }
    : s && !s.platformKeyConfigured ? { label: "Not available yet", tone: "inactive" } : { label: "Not set up", tone: "left" };
  const detail = active ? `Parents message ${s!.phoneNumber || "your school number"}.`
    : inProgress ? "Finish connecting your number; WhatsApp may have sent a verification code."
    : s && !s.platformKeyConfigured ? "WhatsApp isn't switched on for Rejista yet. Skip this step for now; it will be here when it is."
    : "Connect the school's WhatsApp number so parents can check balances, pay and get receipts.";
  return (
    <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card" data-testid="parents-summary">
      <CollectionRow icon={<MessageCircle className="h-4 w-4" />} title="School WhatsApp number" detail={detail} status={status}
        href="/settings/messaging/whatsapp" action={active ? "Manage" : inProgress ? "Continue" : "Open"} />
    </ul>
  );
}

/** Just the name: everything else on the school profile can wait until Settings. */
function NameStep({ current, onDone }: { current: string; onDone: () => void }) {
  const qc = useQueryClient();
  const m = useUpdateSchool();
  const [name, setName] = useState(current === "New school" ? "" : current);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ data: { name: name.trim() } }, {
      onSuccess: (s) => { qc.setQueryData(getGetSchoolQueryKey(), s); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form id="setup-name-form" onSubmit={submit} className="flex w-full flex-col gap-3">
      {/* The page heading asks the question, so the label is for screen readers only. */}
      <label htmlFor="input-school-name" className="sr-only">School name</label>
      <div className="group relative">
        <Building2 aria-hidden="true" className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        <input id="input-school-name" data-testid="input-school-name" autoFocus required minLength={2} maxLength={180} autoComplete="organization"
          value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mwangaza Primary School"
          className="h-16 w-full rounded-2xl border border-input bg-card pl-14 pr-5 text-lg font-medium shadow-sm outline-none transition placeholder:font-normal placeholder:text-muted-foreground/70 hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/15 sm:h-[4.5rem] sm:text-xl" />
      </div>
      <FormError msg={err} />
      <StepAction><Btn data-testid="button-save-school" type="submit" form="setup-name-form" disabled={name.trim().length < 2 || m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save and continue</Btn></StepAction>
    </form>
  );
}

export function StepBody({ id, next }: { id: FlowStep; next: () => void }) {
  const school = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  switch (id) {
    case "profile":
      if (!school.data) return <SkeletonRows rows={3} cols={2} />;
      return <NameStep key={school.data.id} current={school.data.name} onDone={next} />;
    case "calendar": return <CalendarStep embedded forceNew={false} onNext={next} />;
    case "classes": return <ClassesStep embedded onNext={next} />;
    case "learners": return <ImportPage embedded onDone={next} />;
    case "fees": return <FeesStep embedded onNext={next} />;
    case "invoices": return <BillingStep embedded onDone={next} />;
    case "collections": return <CollectionsStep />;
    case "parents": return <ParentsStep />;
    case "staff": return <Staff embedded />;
  }
}

function Done({ left, go }: { left: typeof FLOW; go: (id: FlowStep) => void }) {
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const money = useGetFinanceOverview({ query: { queryKey: getGetFinanceOverviewQueryKey() } });
  const s = useAuthSession();
  const learners = (grades.data ?? []).reduce((n, g) => n + g.studentCount, 0);
  const billed = money.data?.term?.billed ?? money.data?.invoiced;
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center" data-testid="setup-done">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-7 w-7" strokeWidth={3} /></span>
      <h2 className="font-display text-2xl font-semibold">{s.school?.name} is ready</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {learners} learner{learners === 1 ? "" : "s"}{billed && Number(billed) > 0 ? <>, billed {kes(billed)}</> : null}.
        {left.length ? " You can finish the rest any time." : " Parents can now pay, check balances and get receipts on WhatsApp."}
      </p>
      {left.length > 0 && (
        <ul className="w-full max-w-md divide-y divide-border/60 rounded-xl border border-border text-left text-sm" data-testid="setup-left">
          {left.map((x) => (
            <li key={x.id}><button type="button" onClick={() => go(x.id)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/50">
              <x.icon className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{x.title}</span><ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button></li>
          ))}
        </ul>
      )}
      <Link href="/" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground" data-testid="button-setup-finish">Go to your school<ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}

function Frame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const s = useAuthSession();
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary font-display text-base font-bold text-primary-foreground">{APP_INITIAL}</div>
        <div className="min-w-0 flex-1"><div className="text-[11px] text-muted-foreground">Setting up</div><div className="truncate font-semibold">{s.school?.name}</div></div>
        <Link href="/" className="text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-setup-later">Finish later</Link>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {aside}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

export default function SchoolSetup() {
  const p = usePerms();
  const qc = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const guide = useOnboarding();
  const update = useUpdateOnboarding();
  useEffect(() => { try { sessionStorage.setItem(SETUP_SEEN_KEY, "1"); } catch { /* storage unavailable: the home page may send them here again */ } }, []);
  // Shown outside the app shell, which normally sets the tab title.
  useEffect(() => { document.title = "Set up your school · Rejista"; }, []);
  if (!p.manageSchool) return <Redirect to="/" replace />;
  const param = new URLSearchParams(search).get("step");
  const steps = guide.data?.steps ?? [];
  const state = (id: FlowStep) => steps.find((x) => x.id === id);
  const firstOpen = FLOW.find((x) => !state(x.id)?.done && !state(x.id)?.skipped)?.id;
  const step: FlowStep | "done" = param === "done" ? "done" : FLOW.some((x) => x.id === param) ? param as FlowStep : firstOpen ?? "done";
  const go = (id: FlowStep | "done") => navigate(`/setup?step=${id}`);
  const index = FLOW.findIndex((x) => x.id === step);
  const next = () => go(FLOW[index + 1]?.id ?? "done");
  const doneCount = FLOW.filter((x) => state(x.id)?.done).length;
  const later = () => {
    const s = state(step as FlowStep);
    // Optional steps are recorded as skipped so the home page stops suggesting them; required ones stay open.
    if (s?.optional && !s.done) update.mutate({ data: { skip: s.id } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getGetOnboardingQueryKey() }) });
    next();
  };

  const aside = (
    <nav aria-label="Setup steps" className="lg:sticky lg:top-6 lg:self-start">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground lg:mb-4"><span>{doneCount} of {FLOW.length} done</span>{index >= 0 && <span className="lg:hidden">Step {index + 1} of {FLOW.length}</span>}</div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted lg:hidden"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((doneCount / FLOW.length) * 100)}%` }} /></div>
      <ol className="hidden space-y-1 lg:block">
        {FLOW.map((x, i) => {
          const s = state(x.id), on = x.id === step;
          return (
            <li key={x.id}>
              <button type="button" onClick={() => go(x.id)} aria-current={on ? "step" : undefined} data-testid={`flow-step-${x.id}`}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition", on ? "bg-primary/10 font-semibold" : "hover:bg-muted")}>
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs", s?.done ? "bg-primary text-primary-foreground" : on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {s?.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{x.label}</span>
                {s?.skipped && !s.done && <span className="text-[11px] text-muted-foreground">later</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  if (!guide.data) return <Frame><SkeletonRows rows={4} cols={2} /></Frame>;
  if (step === "done") return <Frame aside={aside}><Done left={FLOW.filter((x) => !state(x.id)?.done)} go={go} /></Frame>;
  const meta = FLOW[index], s = state(meta.id);
  return (
    <Frame aside={aside}>
      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><meta.icon className="h-4 w-4" />Step {index + 1} of {FLOW.length}{s?.optional && <span>· optional</span>}</div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight" data-testid="setup-step-title">{meta.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{meta.why}</p>
        </div>
        <div className="px-5 py-5 sm:px-6"><StepBody id={meta.id} next={next} /></div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border/70 px-5 py-4 sm:px-6">
          {index > 0 && <Btn variant="ghost" onClick={() => go(FLOW[index - 1].id)} data-testid="button-setup-back"><ArrowLeft className="h-4 w-4" />Back</Btn>}
          <span className="flex-1" />
          {s?.done
            ? <Btn onClick={next} data-testid="button-setup-continue">Continue<ArrowRight className="h-4 w-4" /></Btn>
            : <Btn variant="outline" onClick={later} data-testid="button-setup-later">Do this later<ArrowRight className="h-4 w-4" /></Btn>}
        </div>
      </div>
    </Frame>
  );
}
