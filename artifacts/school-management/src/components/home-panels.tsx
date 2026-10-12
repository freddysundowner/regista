import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  useListTerms, getListTermsQueryKey, useGetFinanceOverview, getGetFinanceOverviewQueryKey, useGetModuleDashboard, getGetModuleDashboardQueryKey,
  useGetFinanceSummary, getGetFinanceSummaryQueryKey, useGetDashboardSummary,
} from "@workspace/api-client-react";
import { ArrowRight, Banknote, CalendarDays, CheckCircle2, Circle, ClipboardCheck } from "lucide-react";
import { useOnboarding } from "@/components/guide";
import { usePerms, fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";

const ks = (v?: string | number | null) => `KES ${Math.round(Number(v ?? 0)).toLocaleString("en-KE")}`;
const CHANNEL: Record<string, string> = { mpesa_c2b: "M-Pesa", mpesa_stk: "M-Pesa", mpesa: "M-Pesa", bank: "Bank", cash: "Cash", cheque: "Cheque" };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function Card({ title, action, children, testid, className }: { title: string; action?: { href: string; label: string }; children: ReactNode; testid: string; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)} data-testid={testid}>
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <h2 className="font-semibold">{title}</h2>
        {action && <Link href={action.href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">{action.label}<ArrowRight className="h-3.5 w-3.5" /></Link>}
      </div>
      {children}
    </section>
  );
}

/** The current term in a few words ("Term 3 · week 8 of 10"), for the phone's top bar; `fallback` when no term is open. */
export function TermLine({ fallback }: { fallback: string }) {
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const t = terms.data?.find((x) => x.isCurrent);
  if (!t) return <>{fallback}</>;
  const now = today(), length = Math.max(1, days(t.startDate, t.endDate)), weeks = Math.ceil(length / 7);
  const left = days(now, t.endDate), week = Math.min(weeks, Math.floor(Math.max(0, days(t.startDate, now)) / 7) + 1);
  return <>{t.name} · {now < t.startDate ? `opens ${fmtDate(t.startDate)}` : left < 0 ? `closed ${fmtDate(t.endDate)}` : `week ${week} of ${weeks}`}</>;
}

/** Where the school is in the year: the current term, how far through, and how long is left. */
export function TermStrip() {
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const t = terms.data?.find((x) => x.isCurrent);
  if (!t) return null;
  const now = today(), length = Math.max(1, days(t.startDate, t.endDate)), gone = Math.min(length, Math.max(0, days(t.startDate, now)));
  const left = days(now, t.endDate), week = Math.min(Math.ceil(length / 7), Math.floor(gone / 7) + 1), weeks = Math.ceil(length / 7);
  const note = now < t.startDate ? `opens ${fmtDate(t.startDate)}` : left < 0 ? `closed ${fmtDate(t.endDate)}` : left === 0 ? "closes today" : `week ${week} of ${weeks} · ${left < 14 ? `${left} day${left === 1 ? "" : "s"}` : `${Math.round(left / 7)} weeks`} left`;
  return (
    <div className="flex min-w-[14rem] flex-1 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 max-md:hidden sm:max-w-sm" data-testid="term-strip">
      <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm"><b>{t.name}</b><span className="text-xs text-muted-foreground">{note}</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((gone / length) * 100)}%` }} /></div>
      </div>
    </div>
  );
}

/** Today: money in by channel and the register, in one glance. */
export function TodayCard() {
  const p = usePerms();
  const fin = useGetFinanceOverview({ query: { queryKey: getGetFinanceOverviewQueryKey(), enabled: p.financeRead, refetchInterval: 60_000 } });
  const mod = useGetModuleDashboard({ query: { queryKey: getGetModuleDashboardQueryKey(), refetchInterval: 120_000 } });
  const channels = new Map<string, number>();
  for (const c of fin.data?.today.channels ?? []) channels.set(CHANNEL[c.channel] ?? c.channel, (channels.get(CHANNEL[c.channel] ?? c.channel) ?? 0) + Number(c.amount));
  const att = mod.data?.attendance ?? [];
  const count = (s: string) => att.find((a) => a.status === s)?.count ?? 0;
  const marked = att.reduce((n, a) => n + a.count, 0);
  return (
    <Card title="Today" testid="home-today">
      <ul className="divide-y divide-border/60 text-sm">
        {p.financeRead && (
          <li className="flex items-start gap-3 px-5 py-4">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">Money in</div>
              <div className="text-lg font-semibold tabular-nums">{fin.isLoading ? "…" : ks(fin.data?.today.total)}</div>
              <div className="text-xs text-muted-foreground">{channels.size ? [...channels].map(([k, v]) => `${k} ${ks(v)}`).join(" · ") : "No payments yet today"}</div>
            </div>
          </li>
        )}
        <li className="flex items-start gap-3 px-5 py-4">
          <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Attendance</div>
            {mod.isLoading ? <div className="text-lg font-semibold">…</div> : marked ? <>
              <div className="text-lg font-semibold tabular-nums">{count("present") + count("late")} present</div>
              <div className="text-xs text-muted-foreground">{count("absent")} absent{count("late") ? ` · ${count("late")} late` : ""}{count("excused") ? ` · ${count("excused")} excused` : ""}</div>
            </> : <>
              <div className="text-lg font-semibold">No register yet</div>
              <Link href="/attendance" className="text-xs font-semibold text-primary hover:underline">Take today's register</Link>
            </>}
          </div>
        </li>
      </ul>
    </Card>
  );
}

/** For a new school: the jobs that make Rejista useful, ticked off as they happen. */
export function GettingStarted() {
  const p = usePerms();
  const guide = useOnboarding();
  const steps = guide.data?.steps ?? [];
  const done = (id: string) => !!steps.find((s) => s.id === id)?.done;
  const items = [
    { id: "learners", label: "Add your learners", detail: "Upload the register or add them one by one.", href: "/students" },
    { id: "invoices", label: "Bill learners for this term", detail: "So parents can see what they owe.", href: "/term-setup?step=billing" },
    { id: "collections", label: "Connect M-Pesa or your bank", detail: "Payments then match to learners by themselves.", href: "/settings/mpesa" },
    { id: "parents", label: "Connect your WhatsApp number", detail: "Parents check balances and get receipts there.", href: "/settings/messaging/whatsapp" },
    { id: "staff", label: "Invite your staff", detail: "Bursar, principal and teachers.", href: "/staff" },
  ];
  if (!p.manageSchool || !guide.data || items.every((i) => done(i.id))) return null;
  const count = items.filter((i) => done(i.id)).length;
  return (
    <Card title={`Getting started · ${count} of ${items.length}`} testid="home-getting-started">
      <ul className="divide-y divide-border/60">{items.map((i) => (
        <li key={i.id}>
          <Link href={i.href} className={cn("flex items-center gap-3 px-5 py-3 hover:bg-muted/40", done(i.id) && "opacity-60")}>
            {done(i.id) ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1"><span className={cn("block text-sm font-medium", done(i.id) && "line-through")}>{i.label}</span><span className="block text-xs text-muted-foreground">{i.detail}</span></span>
            {!done(i.id) && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </Link>
        </li>
      ))}</ul>
    </Card>
  );
}


/** Four numbers that say how the term is going, each a door into the detail. */
export function InsightTiles() {
  const p = usePerms();
  const fin = useGetFinanceSummary(undefined, { query: { queryKey: getGetFinanceSummaryQueryKey(), enabled: p.financeRead, refetchInterval: 120_000 } });
  const dash = useGetDashboardSummary();
  const mod = useGetModuleDashboard({ query: { queryKey: getGetModuleDashboardQueryKey(), enabled: !p.financeRead, refetchInterval: 120_000 } });
  const tile = "block rounded-xl border border-border bg-card px-4 py-3.5 transition hover:border-primary/40 max-md:px-3 max-md:py-2.5";
  const Tile = ({ k, v, sub, href, tone }: { k: string; v: string; sub?: string; href: string; tone?: "good" | "bad" }) => (
    <Link href={href} className={tile}>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums max-md:mt-0.5 max-md:text-lg sm:text-2xl", tone === "bad" && "text-destructive", tone === "good" && "text-primary")}>{v}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </Link>
  );
  if (p.financeRead) {
    const s = fin.data;
    if (fin.isLoading || !s) return <div className="grid grid-cols-2 gap-3 max-md:gap-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[5.5rem] animate-pulse rounded-xl bg-muted" />)}</div>;
    const left = Number(s.health.left), noCosts = s.health.verdict === "no_expenses";
    return (
      <div className="grid grid-cols-2 gap-3 max-md:gap-2 lg:grid-cols-4" data-testid="home-insights">
        <Tile k={`Collected · ${s.termName ?? "this term"}`} v={Number(s.expected.billed) > 0 ? `${s.expected.percentPaid}%` : "Not billed"} sub={Number(s.expected.billed) > 0 ? `${ks(s.expected.paid)} of ${ks(s.expected.toCollect)}` : "Bill learners to start"} href="/finances" />
        <Tile k="Still owed" v={ks(s.owed.total)} sub={`${s.owed.learners} learner${s.owed.learners === 1 ? "" : "s"}${s.owed.promisesBroken ? ` · ${s.owed.promisesBroken} broken promise${s.owed.promisesBroken === 1 ? "" : "s"}` : ""}`} href="/balances" />
        <Tile k="Spent this term" v={ks(s.spent.total)} sub={s.spent.byCategory[0] ? `Most on ${s.spent.byCategory[0].label.toLowerCase()}` : "No expenses recorded"} href={s.from && s.to ? `/expenses?from=${s.from}&to=${s.to}` : "/expenses"} />
        <Tile k={left < 0 ? "Short by" : "Left after costs"} v={noCosts ? "—" : ks(Math.abs(left))} sub={noCosts ? "Record expenses to see this" : `${ks(s.health.received)} in, ${ks(s.health.spent)} out`} href="/finances" tone={noCosts ? undefined : left < 0 ? "bad" : "good"} />
      </div>
    );
  }
  const d = dash.data, att = mod.data?.attendance ?? [];
  const present = att.filter((a) => ["present", "late"].includes(a.status)).reduce((n, a) => n + a.count, 0), marked = att.reduce((n, a) => n + a.count, 0);
  return (
    <div className="grid grid-cols-2 gap-3 max-md:gap-2 lg:grid-cols-4" data-testid="home-insights">
      <Tile k="Learners" v={d ? d.activeStudents.toLocaleString("en-KE") : "…"} href="/students" />
      <Tile k="Present today" v={marked ? `${present} of ${marked}` : "No register"} sub={marked ? `${marked - present} not in` : "Take today's register"} href="/attendance" />
      <Tile k="Assessments this term" v={String(mod.data?.academics.assessments ?? "…")} sub={mod.data ? `${mod.data.academics.locked} marked and locked` : undefined} href="/assessments" />
      <Tile k="Report cards published" v={String(mod.data?.academics.publishedReportCards ?? "…")} href="/report-cards" />
    </div>
  );
}

/** Where this term's money came from, and which classes are furthest behind, side by side. */
export function MoneyInsights() {
  const q = useGetFinanceSummary(undefined, { query: { queryKey: getGetFinanceSummaryQueryKey(), refetchInterval: 120_000 } });
  const s = q.data;
  if (!s?.termName || Number(s.expected.billed) <= 0) return null;
  const channels = s.received.byChannel, max = Math.max(1, ...channels.map((c) => Number(c.amount)));
  const behind = s.classes.filter((c) => Number(c.owed) > 0).slice(0, 4);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title={`Money in · ${s.termName}`} action={{ href: "/payments", label: "Payments" }} testid="home-money-in">
        <div className="space-y-3 p-5">
          <div className="text-2xl font-semibold tabular-nums">{ks(s.received.total)}</div>
          {!channels.length ? <p className="text-sm text-muted-foreground">Nothing received yet this term.</p> : (
            <ul className="space-y-2 text-sm">{channels.map((c) => (
              <li key={c.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
                <span className="truncate">{c.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (Number(c.amount) / max) * 100)}%` }} /></span>
                <span className="tabular-nums text-muted-foreground">{ks(c.amount)}</span>
              </li>))}</ul>
          )}
        </div>
      </Card>
      <Card title="Classes furthest behind" action={{ href: "/finances", label: "Finance Book" }} testid="home-classes-behind">
        {!behind.length ? <p className="px-5 py-5 text-sm text-muted-foreground">Every class is paid up.</p> : (
          <ul className="space-y-2.5 p-5 text-sm">{behind.map((c) => (
            <li key={c.className} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
              <span className="truncate font-medium">{c.className}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${Math.max(3, c.percentPaid)}%` }} /></span>
              <span className="tabular-nums text-muted-foreground">{c.percentPaid}% · {ks(c.owed)}</span>
            </li>))}</ul>
        )}
      </Card>
    </div>
  );
}
