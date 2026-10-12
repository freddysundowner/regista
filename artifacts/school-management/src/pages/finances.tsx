import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useGetFinanceSummary, getGetFinanceSummaryQueryKey, useListTerms, getListTermsQueryKey, type FinanceSummary, type MoneyLine } from "@workspace/api-client-react";
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, CircleDollarSign, HeartPulse, Receipt, School, ShieldAlert, Users } from "lucide-react";
import { PageHeader, ErrorState, SkeletonRows } from "@/components/kit";
import { errMsg, fmtDate } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";

/** Whole shillings, the way people say them: "KES 486,000". */
const ks = (v?: string | null) => `KES ${Math.round(Number(v ?? 0)).toLocaleString("en-KE")}`;
const num = (v?: string | null) => Number(v ?? 0);

function Q({ n, icon: Icon, question, answer, children, href, link, tone = "normal", testid }: {
  n: number; icon: typeof Users; question: string; answer: ReactNode; children?: ReactNode; href?: string; link?: string; tone?: "normal" | "good" | "warn" | "bad"; testid: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid={testid}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone === "good" ? "bg-primary/10 text-primary" : tone === "warn" ? "bg-amber-500/15 text-amber-700" : tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-muted-foreground"><span className="mr-1 tabular-nums">{n}.</span>{question}</h2>
          <div className="mt-1 text-lg font-semibold leading-snug sm:text-xl">{answer}</div>
        </div>
      </div>
      {children && <div className="mt-4 sm:pl-12">{children}</div>}
      {href && link && <div className="mt-4 sm:pl-12"><Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">{link}<ArrowRight className="h-3.5 w-3.5" /></Link></div>}
    </section>
  );
}

/** Each line as a labelled bar, widest first, so the biggest item is obvious at a glance. */
function Bars({ lines, empty }: { lines: MoneyLine[]; empty: string }) {
  if (!lines.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...lines.map((l) => num(l.amount)), 1);
  return (
    <ul className="space-y-2.5">
      {lines.map((l) => (
        <li key={l.label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_auto]">
          <span className="truncate">{l.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (num(l.amount) / max) * 100)}%` }} /></span>
          <span className="text-right font-medium tabular-nums">{ks(l.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function Progress({ percent }: { percent: number }) {
  return <div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>;
}

const KIND: Record<string, string> = { voided_expense: "Voided expense", discount: "Discount", waiver: "Waiver", bursary: "Bursary", sponsorship: "Sponsorship", sibling_discount: "Sibling discount", correction: "Correction", reversal: "Reversal", refund: "Refund" };

function Answers({ s }: { s: FinanceSummary }) {
  const term = s.termName ?? "this term";
  const h = s.health, left = num(h.left);
  const health = h.verdict === "no_expenses"
    ? { tone: "warn" as const, text: <>No expenses recorded for {term} yet, so this can't be judged.</>, note: "Record salaries, food and other spending under Expenses, and this answer fills in by itself." }
    : h.verdict === "deficit" ? { tone: "bad" as const, text: <>Not yet: you've spent {ks(String(-left))} more than you received.</>, note: "Collecting what's still owed, or cutting spending, closes the gap." }
    : h.verdict === "tight" ? { tone: "warn" as const, text: <>Tight: only {ks(h.left)} is left after expenses.</>, note: "That's under a tenth of what came in." }
    : { tone: "good" as const, text: <>Yes: {ks(h.left)} is left after expenses.</>, note: undefined };
  const worst = s.classes.find((c) => num(c.owed) > 0);
  return (
    <div className="space-y-4">
      <Q n={1} icon={CircleDollarSign} testid="q-expected" question={`How much should we collect in ${term}?`}
        answer={num(s.expected.billed) > 0 ? <>{ks(s.expected.toCollect)} <span className="font-normal text-muted-foreground">should come in. {s.expected.percentPaid}% has been paid.</span></> : <>Nothing billed yet for {term}.</>}
        href={num(s.expected.billed) > 0 ? "/invoices" : "/balances"} link={num(s.expected.billed) > 0 ? "See invoices" : "See who needs billing"}>
        {num(s.expected.discounts) > 0 && <p className="mb-3 text-sm text-muted-foreground">That's {ks(s.expected.billed)} billed, less {ks(s.expected.discounts)} in discounts and bursaries.</p>}
        {num(s.expected.billed) > 0 ? <>
          <Progress percent={s.expected.percentPaid} />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm"><span>Paid {ks(s.expected.paid)}</span><span className="text-muted-foreground">Still to collect {ks(s.expected.stillToCollect)}</span></div>
        </> : <p className="text-sm text-muted-foreground">Once learners are billed for {term}, this shows what should come in and how much has.</p>}
      </Q>

      <Q n={2} icon={Banknote} testid="q-received" question="How much has actually come in, and where?"
        answer={<>{ks(s.received.total)} <span className="font-normal text-muted-foreground">received in {term}.</span></>} href="/payments" link="See every payment">
        <Bars lines={s.received.byChannel} empty="No payments received yet this term." />
        {Math.abs(num(s.received.total) - num(s.expected.paid)) >= 1 && num(s.received.total) > 0 && <p className="mt-3 text-sm text-muted-foreground">
          {num(s.received.total) > num(s.expected.paid) ? `${ks(String(num(s.received.total) - num(s.expected.paid)))} of it went to past terms' balances or is held as credit for later.` : `Some of this term's fees were paid before ${term} started.`}</p>}
      </Q>

      <Q n={3} icon={Users} testid="q-owed" tone={num(s.owed.total) > 0 ? "warn" : "good"} question="Who owes, and what did they promise?"
        answer={num(s.owed.total) > 0 ? <>{s.owed.learners} {s.owed.learners === 1 ? "learner owes" : "learners owe"} {ks(s.owed.total)}.</> : <>Nobody owes anything.</>} href="/balances" link="See who owes and remind them">
        <ul className="space-y-1.5 text-sm">
          {num(s.owed.fromPastTerms) > 0 && <li><b>{ks(s.owed.fromPastTerms)}</b> of it is from past terms.</li>}
          <li>{s.owed.promisesDue ? <><b>{s.owed.promisesDue}</b> parent{s.owed.promisesDue === 1 ? " has" : "s have"} promised to pay {ks(s.owed.promisedAmount)}.</> : "No open promises to pay."}</li>
          {s.owed.promisesBroken > 0 && <li className="text-destructive"><b>{s.owed.promisesBroken}</b> promise{s.owed.promisesBroken === 1 ? " was" : "s were"} broken: the date passed without the payment.</li>}
        </ul>
      </Q>

      <Q n={4} icon={Receipt} testid="q-spent" question={`How much has been spent in ${term}?`}
        answer={num(s.spent.total) > 0 ? <>{ks(s.spent.total)} <span className="font-normal text-muted-foreground">spent.</span></> : <>Nothing recorded yet.</>} href={s.from && s.to ? `/expenses?from=${s.from}&to=${s.to}` : "/expenses"} link={num(s.spent.total) > 0 ? `See ${term}'s expenses` : "Record an expense"}>
        <Bars lines={s.spent.byCategory} empty="Salaries, food, transport and supplies appear here once they're recorded." />
      </Q>

      <Q n={5} icon={HeartPulse} testid="q-health" tone={health.tone} question="After paying expenses, are we financially healthy?" answer={health.text}>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-xl bg-muted/50 px-3 py-2.5"><div className="text-xs text-muted-foreground">Came in</div><div className="font-semibold tabular-nums">{ks(h.received)}</div></div>
          <div className="rounded-xl bg-muted/50 px-3 py-2.5"><div className="text-xs text-muted-foreground">Went out</div><div className="font-semibold tabular-nums">{ks(h.spent)}</div></div>
          <div className={cn("rounded-xl px-3 py-2.5", left < 0 ? "bg-destructive/10" : "bg-primary/10")}><div className="text-xs text-muted-foreground">{left < 0 ? "Short by" : "Left"}</div><div className="font-semibold tabular-nums">{ks(String(Math.abs(left)))}</div></div>
        </div>
        {health.note && <p className="mt-2 text-sm text-muted-foreground">{health.note}</p>}
        {num(s.expected.stillToCollect) > 0 && <p className="mt-1 text-sm text-muted-foreground">{ks(s.expected.stillToCollect)} of this term's fees is still to come in.</p>}
      </Q>

      <Q n={6} icon={School} testid="q-classes" question="Which classes owe the most?"
        answer={worst ? <>{worst.className} <span className="font-normal text-muted-foreground">owes the most: {ks(worst.owed)}, {worst.percentPaid}% paid.</span></> : <>No class owes anything.</>}>
        {s.classes.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border" data-testid="class-ranking">
            {s.classes.map((c, i) => (
              <li key={c.className} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm sm:grid-cols-[1.5rem_9rem_1fr_7rem_3rem]">
                <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="font-medium">{c.className}<span className="ml-1 text-xs font-normal text-muted-foreground sm:hidden">· {c.percentPaid}% paid</span></span>
                <span className="hidden h-2 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full rounded-full bg-primary" style={{ width: `${c.percentPaid}%` }} /></span>
                <span className="text-right font-semibold tabular-nums">{ks(c.owed)}</span>
                <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">{c.percentPaid}%</span>
              </li>
            ))}
          </ul>
        )}
      </Q>

      <Q n={7} icon={ShieldAlert} testid="q-adjustments" tone={s.adjustments.flagged.length ? "warn" : "good"} question="Any discounts, adjustments or reversals worth a look?"
        answer={s.adjustments.flagged.length ? <>{s.adjustments.flagged.length} worth a look this term.</> : <>Nothing unusual this term.</>} href="/approvals" link="See every request and who approved it">
        <p className="text-sm text-muted-foreground">{s.adjustments.discountsCount ? `${s.adjustments.discountsCount} discount${s.adjustments.discountsCount === 1 ? "" : "s"} or waivers worth ${ks(s.adjustments.discounts)}` : "No discounts or waivers"} · {s.adjustments.reversals} reversal{s.adjustments.reversals === 1 ? "" : "s"} · refunds {ks(s.adjustments.refunds)}. Discounts, reversals and refunds each need a second person's approval.</p>
        {s.adjustments.flagged.length > 0 && (
          <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border text-sm" data-testid="flagged">
            {s.adjustments.flagged.slice(0, 10).map((f) => (
              <li key={f.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{KIND[f.kind] ?? f.kind} of {ks(f.amount)}{f.studentName ? ` for ${f.studentName}` : ""}</div>
                  <div className="text-amber-800">{f.why}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(f.at)}{f.requestedBy ? ` · ${f.kind === "voided_expense" ? "voided" : "asked"} by ${f.requestedBy}` : ""}{f.approvedBy ? ` · approved by ${f.approvedBy}` : f.status === "pending" ? " · waiting for approval" : ""}{f.reason ? ` · "${f.reason}"` : ""}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Q>
    </div>
  );
}

/** The owner's view: seven questions, each answered in a sentence and one number. */
export default function Finances() {
  usePageTitle("Finance Book");
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const [termId, setTermId] = useState("");
  const params = termId ? { termId } : undefined;
  const q = useGetFinanceSummary(params, { query: { queryKey: getGetFinanceSummaryQueryKey(params), refetchInterval: 60_000 } });
  const s = q.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Finance Book" meta={s?.from && s.to ? `${s.termName}: ${fmtDate(s.from)} to ${fmtDate(s.to)}. Every figure is worked out for you.` : "Every figure is worked out for you."}>
        <select aria-label="Term" className="h-10 rounded-md border border-input bg-card px-3 text-sm" value={termId || s?.termId || ""} onChange={(e) => setTermId(e.target.value)} data-testid="finances-term">
          {(terms.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.academicYearName}{t.isCurrent ? " (now)" : ""}</option>)}
        </select>
      </PageHeader>
      {q.isLoading ? <SkeletonRows rows={6} cols={2} /> : q.isError || !s ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} />
        : !s.termName ? <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 text-sm"><CheckCircle2 className="h-5 w-5 text-muted-foreground" />Set up the school year under Terms, and these answers fill in.</div>
        : <Answers s={s} />}
    </div>
  );
}
