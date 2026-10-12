import { useEffect, useState, type ReactNode } from "react";
import { APP_INITIAL } from "@/lib/brand";
import { Link } from "wouter";
import { AuthScreen, type AuthPanelMode } from "@/components/auth-flow";
import { VisitorChatWidget } from "@/components/support-chat";
import { useGetPublicPricing, getGetPublicPricingQueryKey } from "@workspace/api-client-react";
import {
  ArrowRight, BadgeCheck, BarChart3, BookOpenCheck, CalendarCheck, Check, ChevronDown, FileSpreadsheet, GraduationCap,
  HandCoins, Library, MessageCircle, ReceiptText, Repeat, Scale, ShieldCheck, ShoppingCart, Smartphone, Users,
} from "lucide-react";

const PILLARS = [
  { icon: Smartphone, title: "Fees that match themselves", body: "M-Pesa and bank payments carrying an admission number post to the right learner and issue a receipt. Only the unclear ones wait for the bursar." },
  { icon: MessageCircle, title: "Parents served on WhatsApp", body: "Guardians check balances, download receipts and report cards, and see attendance without calling the office." },
  { icon: GraduationCap, title: "CBC-ready academics", body: "Assessment grids, CBC rubric scales and report-card PDFs in bulk. Teachers lock an assessment once its marks are final." },
];

const ROLES = [
  { key: "bursar", label: "Bursar", points: ["Fee structures by grade, term and boarding status", "Invoices, receipts and statements as PDFs", "Cash, cheques, refunds and payment plans", "Unmatched-payment queue and bank-statement comparison"] },
  { key: "principal", label: "Principal", points: ["Collections, balances and attendance at a glance", "Approve waivers, refunds and adjustments", "Defaulters and aged-arrears reports", "Full audit trail of every change"] },
  { key: "teacher", label: "Teachers", points: ["See only the streams you are assigned", "Enter marks and CBC ratings in one grid", "Take the daily attendance register on your phone", "Write report-card comments per learner"] },
  { key: "parents", label: "Parents", points: ["Fee balance and full statement on WhatsApp", "Receipts, invoices and report cards as PDFs", "Pay school fees through an M-Pesa prompt", "Siblings handled together under one guardian"] },
];

const FEATURES = [
  { icon: Users, title: "Learners & families", body: "Guardians and siblings linked automatically by phone number." },
  { icon: FileSpreadsheet, title: "Bulk import", body: "Bring your register from Excel or CSV, check it, then commit." },
  { icon: Scale, title: "Second-person approvals", body: "Waivers, refunds and adjustments wait for a second person, unless you switch that off." },
  { icon: HandCoins, title: "Sponsors & bursaries", body: "Split sponsor payments across many learners in one batch." },
  { icon: BookOpenCheck, title: "Report cards", body: "Generate a whole stream's report cards as PDFs at once." },
  { icon: CalendarCheck, title: "Attendance", body: "Daily registers per stream that roll up into report cards." },
  { icon: BarChart3, title: "Ready-made reports", body: "Collections, defaulters, arrears, results and attendance, exported to Excel or PDF." },
  { icon: Repeat, title: "Year-end promotion", body: "Move every learner up a grade with a preview first." },
  { icon: ShieldCheck, title: "Roles & audit trail", body: "Each staff role sees only its own work, and every change is recorded." },
  { icon: ReceiptText, title: "Expenses", body: "Record what the school spends and see what is left after costs each term." },
  { icon: ShoppingCart, title: "Purchasing", body: "Suppliers, LPOs with approval, goods received and supplier invoices." },
  { icon: Library, title: "Store & library", body: "Stock in and out with stock cards, plus a book catalogue and lending." },
];

const STEPS = [
  { title: "Create your account", body: "Your name, email and a password. Add the school's details once you're in." },
  { title: "Set up the year", body: "Create terms, grades, streams and fee structures, then invite staff." },
  { title: "Import learners", body: "Upload your register. Families and siblings link up automatically." },
];

export const FAQ = [
  { q: "Does it work with CBC?", a: "Yes. It ships with 4- and 8-level rubric scales you can edit, or you can define your own. Results export to Excel or CSV with the columns you choose for KNEC returns." },
  { q: "Can we bring our existing records?", a: "Yes. Download the import template, paste your learners and guardians, and Rejista flags any problems before anything is saved." },
  { q: "Who can see fee and learner data?", a: "Only signed-in staff, and only what their role allows. Teachers see their assigned streams and no fees, and every change is recorded in the audit trail." },
  { q: "Can one owner run several schools?", a: "Yes. Each school keeps its own data and administrator, and the owner manages all the schools from one platform account." },
  { q: "Does it work on a phone?", a: "Yes. Every screen works in a phone browser, including attendance and mark entry for teachers." },
];

const card = "rounded-3xl bg-card shadow-[0_1px_2px_hsl(var(--foreground)/.04),0_40px_80px_-40px_hsl(var(--foreground)/.35)] ring-1 ring-foreground/[.06]";

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">{APP_INITIAL}</span>
      <span className="font-display text-xl font-semibold tracking-tight">Rejista</span>
    </span>
  );
}

function Cta({ href, children, variant = "primary", testId }: { href: string; children: ReactNode; variant?: "primary" | "ghost"; testId: string }) {
  const base = "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20";
  const look = variant === "primary"
    ? "bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_hsl(var(--primary)/.8)] hover:-translate-y-px hover:bg-primary/90"
    : "bg-card text-foreground ring-1 ring-foreground/10 hover:bg-muted";
  return <Link href={href} data-testid={testId} className={`${base} ${look}`}>{children}</Link>;
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl">
      <div className="text-sm font-semibold text-primary max-md:text-[13px]">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-semibold tracking-[-0.025em] max-md:mt-1 max-md:text-[1.4rem] max-md:leading-snug sm:text-4xl">{title}</h2>
      {body && <p className="mt-3 text-muted-foreground max-md:mt-2 max-md:text-[15px]">{body}</p>}
    </div>
  );
}

function DashboardPreview() {
  const rows = [
    { name: "Learner A", grade: "Grade 6 · East", status: "Paid", ok: true },
    { name: "Learner B", grade: "Grade 4 · West", status: "KES 4,500", ok: false },
    { name: "Learner C", grade: "Grade 8 · North", status: "Paid", ok: true },
  ];
  return (
    <div aria-hidden className="relative">
      <div className={`${card} p-5 max-md:p-4 sm:p-6`}>
        <div className="mb-5 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">Term 2 overview</div><div className="text-lg font-semibold">Dashboard</div></div>
          <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-muted" /><span className="h-2.5 w-2.5 rounded-full bg-muted" /><span className="h-2.5 w-2.5 rounded-full bg-muted" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[["Learners", "642"], ["Attendance", "96%"], ["Fees paid", "78%"]].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-muted/50 p-3"><div className="truncate text-[11px] text-muted-foreground">{k}</div><div className="mt-1 text-xl font-semibold tracking-tight">{v}</div></div>
          ))}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[78%] rounded-full bg-primary" /></div>
        <ul className="mt-5 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{r.name.slice(-1)}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.name}</div><div className="truncate text-xs text-muted-foreground">{r.grade}</div></div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${r.ok ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/15 text-amber-800"}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="absolute -bottom-7 -left-4 hidden w-72 rounded-2xl bg-card p-4 shadow-[0_24px_48px_-20px_hsl(var(--foreground)/.4)] ring-1 ring-foreground/[.06] sm:block lg:-left-10">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700"><BadgeCheck className="h-5 w-5" /></span>
          <div className="min-w-0"><div className="text-sm font-semibold">M-Pesa payment matched</div><div className="truncate text-xs text-muted-foreground">KES 12,000 · Learner B · receipt issued</div></div>
        </div>
      </div>
    </div>
  );
}

function ChatPreview() {
  const msgs: { me?: boolean; text: string }[] = [
    { me: true, text: "Balance" },
    { text: "Learner B, Grade 4 West\nTerm 2 balance: KES 4,500\nReply 1 for statement, 2 to pay" },
    { me: true, text: "2" },
    { text: "An M-Pesa prompt has been sent to your phone. Enter your PIN to pay KES 4,500." },
    { text: "Payment received. Your receipt is attached." },
  ];
  return (
    <div aria-hidden className={`${card} mx-auto w-full max-w-sm overflow-hidden`}>
      <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-foreground/15 font-display font-bold">{APP_INITIAL}</span>
        <div><div className="text-sm font-semibold">School office</div><div className="text-xs text-primary-foreground/70">WhatsApp</div></div>
      </div>
      <div className="space-y-2.5 bg-muted/50 p-4">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.me ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${m.me ? "rounded-br-md bg-emerald-100 text-emerald-950" : "rounded-bl-md bg-card"}`}>{m.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Roles() {
  const [active, setActive] = useState(ROLES[0].key);
  const role = ROLES.find((r) => r.key === active) ?? ROLES[0];
  return (
    <div className="mt-10 max-md:mt-5">
      <div role="tablist" aria-label="Roles" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
        {ROLES.map((r) => (
          <button key={r.key} role="tab" type="button" aria-selected={active === r.key} data-testid={`tab-role-${r.key}`} onClick={() => setActive(r.key)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition max-md:px-3 max-md:py-1.5 max-md:text-[13px] ${active === r.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{r.label}</button>
        ))}
      </div>
      <ul role="tabpanel" className="mt-6 grid gap-3 max-md:mt-4 max-md:gap-2 sm:grid-cols-2">
        {role.points.map((p) => (
          <li key={p} className="flex items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/[.05] max-md:rounded-xl max-md:p-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" strokeWidth={3} /></span>
            <span className="text-[15px] max-md:text-sm">{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Faq() {
  return (
    <div className="mt-10 divide-y divide-border rounded-3xl bg-card ring-1 ring-foreground/[.05] max-md:mt-5 max-md:rounded-2xl">
      {FAQ.map((f) => (
        <details key={f.q} className="group px-6 py-5 max-md:px-4 max-md:py-3.5 max-md:text-[15px]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
            {f.q}<ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition group-open:rotate-180" />
          </summary>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground max-md:mt-2 max-md:text-sm">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

function PricingStatement({ startHref }: { startHref: string }) {
  const q = useGetPublicPricing({ query: { queryKey: getGetPublicPricingQueryKey(), staleTime: 60_000 } });
  const p = q.data;
  // With packages, the slider runs past the biggest capped one so the unlimited package (if any) can be reached.
  const packages = p?.packages ?? [];
  const biggest = Math.max(0, ...packages.map((k) => k.maxLearners ?? 0));
  const cap = packages.length ? Math.max(biggest, 100) + (packages.some((k) => k.maxLearners === null) ? Math.max(200, Math.round(biggest / 2 / 10) * 10) : 0) : p?.maxLearners ?? 2000;
  const [learners, setLearners] = useState(0);
  useEffect(() => { if (p) setLearners(Math.min(450, cap)); }, [p, cap]);
  if (!p?.configured) return null;
  // The package for the number on the slider: the smallest one that covers it.
  const pkg = packages.find((k) => k.maxLearners === null || k.maxLearners >= learners) ?? null;
  const tiered = packages.length > 0;
  const price = Number(tiered ? pkg?.price ?? packages[packages.length - 1].price : p.price);
  const limit = tiered ? pkg?.maxLearners ?? null : p.maxLearners;
  const periodDays = tiered ? pkg?.durationDays ?? p.periodDays : p.periodDays;
  const perLearner = learners ? price / learners : 0;
  const perDay = learners ? perLearner / periodDays : 0;
  const money = (n: number, dp = 0) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  const included = p.highlights.length ? p.highlights : ["Every module: fees, academics, attendance, reports", "WhatsApp answers for parents", "All staff accounts and roles"];
  const methods = p.paymentMethods.map((m) => m.name);
  return (
    <section id="pricing" className="scroll-mt-20 py-20 max-md:py-11 lg:py-24">
      <div className="mx-auto grid w-[90%] items-center gap-12 max-md:gap-7 lg:grid-cols-[1fr_minmax(0,30rem)] lg:gap-20">
        <div>
          {tiered
            ? <SectionHead eyebrow="Pricing" title="Priced by the size of your school." body={`Every package is the whole system, with no add-ons. Pick the one that fits your learners, renewed every ${p.periodLabel}, and move up a package when you grow, paying only the difference.`} />
            : <SectionHead eyebrow="Pricing" title="One price. Every feature." body={`No tiers and no add-ons. Every school gets the whole system${p.maxLearners ? ` for up to ${p.maxLearners.toLocaleString()} active learners` : ""}, renewed every ${p.periodLabel}.`} />}
          <div className="mt-10 rounded-2xl bg-card p-6 ring-1 ring-foreground/[.05] max-md:mt-5 max-md:p-4">
            <label htmlFor="learner-slider" className="flex items-baseline justify-between gap-4 text-sm font-medium">
              <span>How many learners do you have?</span>
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground" data-testid="text-learner-count">{learners.toLocaleString()}</span>
            </label>
            <input id="learner-slider" data-testid="slider-learners" type="range" min={10} max={cap} step={10} value={learners} onChange={(e) => setLearners(Number(e.target.value))}
              className="mt-4 w-full accent-[hsl(var(--primary))]" />
            <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground max-md:mt-3 max-md:text-sm">
              That's <b className="text-foreground" data-testid="text-per-learner">{money(perLearner, perLearner < 100 ? 2 : 0)}</b> per learner per {p.periodLabel}, or about <b className="text-foreground">{money(perDay, 2)}</b> a day.
            </p>
          </div>
        </div>
        <div aria-label="Price statement" className="relative">
          <div className="rounded-t-3xl bg-card p-7 max-md:p-5 shadow-[0_40px_80px_-40px_hsl(var(--foreground)/.4)] ring-1 ring-foreground/[.06] sm:p-8">
            <div className="flex items-start justify-between gap-4 border-b border-dashed border-border pb-5">
              <div><div className="font-display text-lg font-semibold">Rejista</div><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Fee statement</div></div>
              <div className="text-right text-xs text-muted-foreground"><div>Per {p.periodLabel}</div><div>{periodDays} days</div></div>
            </div>
            <ul className="divide-y divide-dashed divide-border text-sm">
              <li className="flex items-baseline justify-between gap-4 py-4"><span className="font-semibold" data-testid="text-package-name">{tiered && pkg ? `${pkg.name} package` : "Full school system"}</span><span className="font-mono font-semibold" data-testid="text-price">{money(price)}</span></li>
              {included.map((h) => <li key={h} className="flex items-baseline justify-between gap-4 py-3"><span className="flex items-start gap-2 text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={3} />{h}</span><span className="shrink-0 font-mono text-xs text-muted-foreground">included</span></li>)}
              <li className="flex items-baseline justify-between gap-4 py-3 text-muted-foreground"><span>Learner limit</span><span className="font-mono text-xs">{limit ? `up to ${limit.toLocaleString()}` : "unlimited"}</span></li>
            </ul>
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-foreground/80 pt-4">
              <span className="font-semibold">{p.trialDays > 0 ? "Due today" : `Per ${p.periodLabel}`}</span>
              <span className="text-2xl font-semibold tracking-tight">{p.trialDays > 0 ? "KES 0" : money(price)}</span>
            </div>
            {p.trialDays > 0 && <p className="mt-1 text-right text-xs text-muted-foreground">{p.trialDays}-day free trial, then {money(price)} per {p.periodLabel}</p>}
            <Link href={startHref} data-testid="button-pricing-start" className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition hover:bg-primary/90">{p.trialDays > 0 ? "Start free trial" : "Get started"} <ArrowRight className="h-4 w-4" /></Link>
            {methods.length > 0 && <p className="mt-4 text-center text-xs text-muted-foreground">Pay with {methods.join(", ")}, or a prepaid licence key</p>}
          </div>
          <div aria-hidden className="h-3 bg-[radial-gradient(circle_at_8px_0,transparent_7px,hsl(var(--card))_7.5px)] bg-[length:16px_12px] bg-repeat-x drop-shadow-[0_1px_0_hsl(var(--foreground)/.06)]" />
        </div>
      </div>
    </section>
  );
}

export function LandingPage({ panel = null, needsSetup = false }: { panel?: AuthPanelMode | null; needsSetup?: boolean }) {
  // Trial and approval are platform settings, so the page says what is true right now.
  const pricing = useGetPublicPricing({ query: { queryKey: getGetPublicPricingQueryKey(), staleTime: 60_000, enabled: !needsSetup } }).data;
  const trialDays = pricing?.trialDays ?? 0;
  const start = needsSetup ? { href: "/setup", label: "Set up your school" } : { href: "/register", label: trialDays > 0 ? "Start free trial" : "Get started" };
  const closing = needsSetup ? "Create the first school and administrator account."
    : !pricing ? "Create your school's account in a few minutes."
    : pricing.requireApproval ? "Each new school is reviewed before it opens."
    : trialDays > 0 ? `Free for ${trialDays} days. Your school opens as soon as you register.`
    : "Your school opens as soon as you register.";
  useEffect(() => { if (!panel) document.title = "Rejista · School management system for Kenya (CBC, fees, M-Pesa)"; }, [panel]);

  return (
    <div className={`min-h-[100dvh] bg-muted/40 text-foreground ${panel ? "max-md:bg-card" : ""}`}>
      {/* On a phone the sign-in and sign-up screens are one colour from top to bottom, logo bar included. */}
      <header className={`sticky top-0 z-20 bg-muted/40 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 ${panel ? "max-md:!bg-card max-md:backdrop-blur-none" : ""}`}>
        {/* On a phone the sign-in and sign-up screens show just the logo, centred; it still leads home. */}
        <nav className={`mx-auto flex h-16 w-[90%] items-center justify-between ${panel ? "max-md:justify-center" : "max-md:h-14"}`}>
          <Link href="/" aria-label="Rejista home"><Logo /></Link>
          <div className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            <a href="/#features" className="transition hover:text-foreground">Features</a>
            <a href="/#parents" className="transition hover:text-foreground">For parents</a>
            <a href="/#pricing" className="transition hover:text-foreground">Pricing</a>
            <a href="/#faq" className="transition hover:text-foreground">FAQ</a>
            <Link href="/manual" data-testid="link-nav-manual" className="transition hover:text-foreground">Manual</Link>
          </div>
          {!panel && <Link href={start.href} data-testid="link-nav-start" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold max-md:px-3 max-md:py-1.5 max-md:text-[13px] text-primary-foreground transition hover:bg-primary/90">Get started</Link>}
        </nav>
      </header>

      {panel ? <main><AuthScreen mode={panel} needsSetup={needsSetup} /></main> : <main>
        <section className="mx-auto grid w-[90%] items-center gap-14 pb-24 pt-12 max-md:gap-9 max-md:pb-12 max-md:pt-5 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-32 lg:pt-20">
          <div className="rise">
            <h1 className="text-[clamp(2.4rem,5.4vw,4rem)] font-semibold leading-[1.04] tracking-[-0.035em] max-md:text-[1.85rem] max-md:leading-[1.1]">
              Fees collected. Results out. <span className="text-primary">Parents in the loop.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground max-md:mt-3 max-md:text-[15px] max-md:leading-normal">
              Rejista runs admissions, fees, CBC assessments and attendance in one place, matches M-Pesa payments to learners, and answers parents on WhatsApp.
            </p>
            <div className="mt-8 flex flex-col gap-3 max-md:mt-5 max-md:flex-row max-md:gap-2.5 max-md:[&>a]:h-11 max-md:[&>a]:flex-1 max-md:[&>a]:px-3 max-md:[&>a]:text-sm sm:flex-row">
              <Cta href={start.href} testId="button-hero-start">{start.label} <ArrowRight className="h-4 w-4" /></Cta>
              <Cta href="/login" variant="ghost" testId="button-hero-login">Sign in</Cta>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground max-md:mt-5 max-md:gap-x-4 max-md:gap-y-1.5 max-md:text-[13px]">
              {["M-Pesa & bank payments", "CBC report cards", "Works on any phone"].map((t) => (
                <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" strokeWidth={3} />{t}</li>
              ))}
            </ul>
          </div>
          <div className="rise lg:pl-4" style={{ animationDelay: ".08s" }}><DashboardPreview /></div>
        </section>

        <section className="bg-card py-20 max-md:py-11 lg:py-24">
          <div className="mx-auto grid w-[90%] gap-6 max-md:gap-3 md:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl bg-muted/40 p-7 ring-1 ring-foreground/[.05] max-md:flex max-md:gap-3.5 max-md:rounded-2xl max-md:p-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground max-md:h-10 max-md:w-10 max-md:rounded-xl"><Icon className="h-6 w-6 max-md:h-5 max-md:w-5" /></span>
                <div>
                  <h3 className="mt-5 text-lg font-semibold max-md:mt-0 max-md:text-base">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground max-md:mt-1 max-md:text-sm max-md:leading-normal">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-[90%] py-20 max-md:py-11 lg:py-24">
          <SectionHead eyebrow="Built around your staff" title="Everyone gets the screen they need" body="Each role has its own view. Teachers never see fees, and bursars don't have to wade through mark sheets." />
          <Roles />
        </section>

        <section id="parents" className="scroll-mt-20 bg-card py-20 max-md:py-11 lg:py-24">
          <div className="mx-auto grid w-[90%] items-center gap-12 max-md:gap-7 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHead eyebrow="For parents" title="Fewer calls to the office" body="Parents get answers on WhatsApp at any hour, verified with a one-time code sent to their phone." />
              <ul className="mt-8 space-y-3 max-md:mt-5 max-md:space-y-2">
                {["Fee balance and statement on request", "Pay through an M-Pesa prompt, receipt sent back", "Report cards and receipts as PDFs", "Ask for a payment plan without visiting"].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-[15px] max-md:gap-2.5 max-md:text-sm"><Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} />{t}</li>
                ))}
              </ul>
            </div>
            <ChatPreview />
          </div>
        </section>

        <section id="features" className="mx-auto w-[90%] scroll-mt-20 py-20 max-md:py-11 lg:py-24">
          <SectionHead eyebrow="Everything in one register" title="Everything the office needs" body="From admission to the end-of-term report, every module shares the same records, so nothing has to be typed in twice." />
          <div className="mt-12 grid gap-4 max-md:mt-6 max-md:gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/[.05] max-md:gap-3 max-md:rounded-xl max-md:p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                <div><h3 className="font-semibold max-md:text-[15px]">{title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground max-md:mt-0.5 max-md:text-[13px] max-md:leading-normal">{body}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-card py-20 max-md:py-11 lg:py-24">
          <div className="mx-auto w-[90%]">
            <SectionHead eyebrow="Getting started" title="Up and running in an afternoon" />
            <ol className="mt-10 grid gap-6 max-md:mt-6 max-md:gap-3 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-3xl bg-muted/40 p-7 ring-1 ring-foreground/[.05] max-md:flex max-md:gap-3.5 max-md:rounded-2xl max-md:p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground max-md:h-8 max-md:w-8">{i + 1}</span>
                  <div>
                    <h3 className="mt-4 font-semibold max-md:mt-0.5">{s.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground max-md:mt-1 max-md:leading-normal">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <PricingStatement startHref={start.href} />

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-24">
          <SectionHead eyebrow="FAQ" title="Questions schools ask" />
          <Faq />
          <p className="mt-6 text-center text-sm text-muted-foreground">Want the detail? <Link href="/manual" data-testid="link-faq-manual" className="font-semibold text-primary hover:underline">Read the full user manual</Link>.</p>
        </section>

        <section className="pb-20 max-md:pb-24">
          <div className="mx-auto flex w-[90%] flex-col items-start justify-between gap-6 rounded-3xl bg-primary px-6 py-10 text-primary-foreground max-md:gap-4 max-md:rounded-2xl max-md:px-5 max-md:py-6 sm:px-10 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em] max-md:text-xl sm:text-3xl">Ready to open the register?</h2>
              <p className="mt-2 text-primary-foreground/75 max-md:mt-1 max-md:text-sm">{closing}</p>
            </div>
            <Link href={start.href} data-testid="button-cta-start" className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-card px-6 text-[15px] font-semibold text-foreground transition hover:-translate-y-px">{start.label} <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </section>
      </main>}

      {!panel && <VisitorChatWidget />}

      {/* The sign-in and sign-up screens have no footer, on a phone or a computer. */}
      <footer className={`border-t border-border ${panel ? "hidden" : ""}`}>
        <div className="mx-auto flex w-[90%] flex-col gap-3 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <span className="flex flex-wrap gap-x-5 gap-y-1 font-medium">
            <Link href="/manual" data-testid="link-footer-manual" className="hover:text-foreground hover:underline">User manual</Link>
            <Link href="/terms" data-testid="link-footer-terms" className="hover:text-foreground hover:underline">Terms</Link>
            <Link href="/privacy" data-testid="link-footer-privacy" className="hover:text-foreground hover:underline">Privacy</Link>
          </span>
          <span>© {new Date().getFullYear()} Rejista</span>
        </div>
      </footer>
    </div>
  );
}
