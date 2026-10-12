import { useState, type ReactNode } from "react";
import { PromiseForm, PromiseLine } from "@/components/promise";
import { Pager, usePaged } from "@/components/pager";
import { Link, useLocation } from "wouter";
import {
  useGetStudentFinanceHistory, getGetStudentFinanceHistoryQueryKey, useGetAttendanceRegister, getGetAttendanceRegisterQueryKey,
  useListReportCards, getListReportCardsQueryKey, useListPaymentPlans, getListPaymentPlansQueryKey, useGenerateReportCardPdf,
  useListTerms, getListTermsQueryKey, useListFamilies, getListFamiliesQueryKey, useListGuardians, getListGuardiansQueryKey,
  type Student, useGetFinanceArrears, getGetFinanceArrearsQueryKey,
} from "@workspace/api-client-react";
import { BadgePercent, Banknote, CalendarClock, CalendarRange, CalendarX, ChevronDown, Coins, Download, FileText, GraduationCap, MessageCircle, Phone, Plus, ReceiptText, Smartphone, Undo2, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Btn, Pill, SkeletonRows } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { DocumentButton, useDocumentDownload, useSecondApproval } from "@/components/finance-kit";
import { StudentFinancePanel } from "@/components/student-finance";
import { RecordPayment } from "@/pages/payments";
import { NewPlan, PlanTable } from "@/pages/payment-plans";
import { RequestForm } from "@/pages/approvals";
import { Compose } from "@/pages/notifications";
import { StkForm } from "@/components/stk";
import { usePerms, useSession, errMsg, fmtDate, initials } from "@/lib/session";
import { fromCents, kes, rd, str, toCents } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CHANNEL: Record<string, string> = { mpesa_c2b: "M-Pesa", mpesa_stk: "M-Pesa prompt", mpesa: "M-Pesa", bank: "Bank", cash: "Cash", cheque: "Cheque" };
type Dialog = "payment" | "stk" | "plan" | "adjustment" | "refund" | "remind" | "message" | "promise" | null;
type Event = { at: string; icon: typeof Coins; text: ReactNode; amount?: string; credit?: boolean };

function Card({ icon: Icon, title, children, testid }: { icon: typeof Coins; title: string; children: ReactNode; testid: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid={testid}>
      <h2 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="h-4 w-4" />{title}</h2>
      {children}
    </section>
  );
}
const Action = ({ primary, children, ...p }: { primary?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
  <Btn variant={primary ? "primary" : "outline"} className="h-8 px-3 text-xs" {...p}>{children}</Btn>;

/** One child on one page: money, school and family, with the actions for each where they apply, then everything that happened. */
export function LearnerOverview({ student: s, onLinkGuardian }: { student: Student; onLinkGuardian?: () => void }) {
  const p = usePerms();
  const { school } = useSession();
  const { toast } = useToast();
  const [open, setOpen] = useState<Dialog>(null);
  const statement = useDocumentDownload();
  const secondApproval = useSecondApproval();
  const [ledger, setLedger] = useState(false);
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const term = terms.data?.find((t) => t.isCurrent);
  const fin = useGetStudentFinanceHistory(s.id, { query: { queryKey: getGetStudentFinanceHistoryQueryKey(s.id), enabled: p.financeRead } });
  const ap = { studentId: s.id };
  const att = useGetAttendanceRegister(ap, { query: { queryKey: getGetAttendanceRegisterQueryKey(ap), enabled: p.academicRead } });
  const cards = useListReportCards(ap, { query: { queryKey: getListReportCardsQueryKey(ap), enabled: p.academicRead } });
  const plans = useListPaymentPlans({ query: { queryKey: getListPaymentPlansQueryKey(), enabled: p.financeRead } });
  const families = useListFamilies({ query: { queryKey: getListFamiliesQueryKey(), enabled: p.viewGuardians && !!s.familyId } });
  const phone = s.guardianPhones[0];
  const gp = phone ? { search: phone } : undefined;
  const guardians = useListGuardians(gp, { query: { queryKey: getListGuardiansQueryKey(gp), enabled: p.notify && !!phone } });
  const pdf = useGenerateReportCardPdf();
  const arrears = useGetFinanceArrears({ query: { queryKey: getGetFinanceArrearsQueryKey(), enabled: p.financeRead } });
  const promise = arrears.data?.rows.find((r) => r.studentId === s.id)?.promise;

  // Money
  const h = fin.data;
  const balance = h ? toCents(h.balance) : 0n;
  const owing = balance > 0n, credit = balance < 0n;
  const invoices = (h?.records ?? []).filter((r) => r.kind === "invoice" && r.status !== "cancelled");
  const termInvoices = term ? invoices.filter((r) => r.termId === term.id) : [];
  // Zero balance with no invoice this term means not billed yet, not paid up.
  const notBilled = !!term && !termInvoices.length && balance === 0n;
  const [, navigate] = useLocation();
  const billedTerm = termInvoices.reduce((n, r) => n + toCents(r.amount), 0n);
  const dueDate = [...termInvoices].map((r) => rd(r, "dueDate")).filter(Boolean).sort()[0];
  const payments = (h?.records ?? []).filter((r) => r.kind === "payment" && r.status === "posted").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lastPaid = payments[0];
  const myPlans = (plans.data ?? []).filter((x) => x.studentId === s.id);
  const livePlan = myPlans.find((x) => ["proposed", "active"].includes(x.status));
  const nextInstalment = livePlan?.installments.filter((i) => !["paid"].includes(String(i.status))).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];

  // School
  const recs = att.data ?? [];
  const termRecs = term ? recs.filter((r) => r.date >= term.startDate && r.date <= term.endDate) : recs;
  const present = termRecs.filter((r) => r.status === "present" || r.status === "late").length;
  const absent = termRecs.filter((r) => r.status === "absent").length;
  const pct = termRecs.length ? Math.round((present / termRecs.length) * 100) : null;
  const termName = (id?: string | null) => terms.data?.find((t) => t.id === id)?.name ?? "Term";
  const latestCard = [...(cards.data ?? [])].sort((a, b) => String(b.termId).localeCompare(String(a.termId)))[0];

  // Family
  const siblings = (families.data?.find((f) => f.id === s.familyId)?.students ?? []).filter((x) => x.id !== s.id);
  const guardian = guardians.data?.find((g) => g.phone === phone);

  // Everything that happened, newest first.
  const byId = new Map((h?.records ?? []).map((r) => [r.id, r] as const));
  const events: Event[] = [];
  for (const e of h?.ledger ?? []) {
    const type = str(e, "type"), at = str(e, "createdAt") ?? "", rec = byId.get(str(e, "referenceId") ?? "");
    const debit = str(e, "debit") ?? "0", creditAmt = str(e, "credit") ?? "0";
    if (type === "payment") {
      const ch = rec ? CHANNEL[rd(rec, "channel") ?? ""] ?? "Payment" : "Payment";
      const ref = rec ? rd(rec, "originalProviderTxnId") ?? rd(rec, "providerTxnId") : undefined;
      events.push({ at, icon: ch.startsWith("M-Pesa") ? Smartphone : Banknote, text: <>{ch}{ref && ch !== "Cash" ? <span className="font-mono text-xs"> {ref.split(":")[0]}</span> : null} · receipt {str(e, "description")}</>, amount: creditAmt, credit: true });
    } else if (type === "invoice") events.push({ at, icon: ReceiptText, text: <>{termName(rec?.termId)} invoice {rec ? rd(rec, "invoiceNo") ?? "" : ""}{rec && p.financeRead && <span className="ml-2 inline-block align-middle"><DocumentButton type="invoice" referenceId={rec.id} label={`Download invoice ${rd(rec, "invoiceNo") ?? ""}`} fileName={`Invoice-${rd(rec, "invoiceNo") ?? rec.id}`}>PDF</DocumentButton></span>}</>, amount: debit });
    else if (type) events.push({ at, icon: Coins, text: <span className="capitalize">{type.replace(/_/g, " ")}{str(e, "description") ? ` · ${str(e, "description")}` : ""}</span>, amount: toCents(creditAmt) ? creditAmt : debit, credit: !!toCents(creditAmt) });
  }
  for (const r of recs) if (r.status === "absent") events.push({ at: `${r.date}T08:00:00`, icon: CalendarX, text: "Marked absent" });
  for (const c of cards.data ?? []) if (c.status === "published") events.push({ at: String((c as { publishedAt?: string }).publishedAt ?? ""), icon: FileText, text: `${termName(c.termId)} report card published` });
  events.sort((a, b) => b.at.localeCompare(a.at));
  const { rows: shown, pager } = usePaged(events, undefined, 10);

  const reminder = `Dear ${guardian?.name ?? "parent"}, ${s.firstName}'s fee balance at ${school?.name ?? "school"} is ${kes(h?.balance)}${dueDate ? `, due ${fmtDate(dueDate)}` : ""}. Pay to the school paybill with account ${s.admissionNo}. Thank you.`;
  const moneyCard = p.financeRead && (
    <Card icon={Coins} title={term ? `Money · ${term.name}` : "Money"} testid="card-money" key="money">
      {fin.isLoading ? <SkeletonRows rows={2} cols={2} /> : fin.isError ? <p className="text-sm text-destructive">{errMsg(fin.error)}</p> : <>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold tabular-nums max-md:text-xl" data-testid="text-student-balance">{kes(credit ? h!.balance.replace("-", "") : h!.balance)}</span>
          <Pill tone={owing ? "duplicate" : notBilled ? "inactive" : "active"}>{owing ? "owes" : credit ? "in credit" : notBilled ? "not billed" : "paid up"}</Pill>
        </div>
        {/* Phone: lines that only say "nothing yet" are left out; the pill beside the amount already says it. */}
        <p className={cn("mt-1 text-sm text-muted-foreground", !billedTerm && "max-md:hidden")}>
          {billedTerm ? <>Billed {kes(fromCents(billedTerm), false)} this term</> : "Not billed this term"}
          {dueDate && owing ? <> · due {fmtDate(dueDate)}</> : null}
        </p>
        <p className={cn("text-sm text-muted-foreground", !lastPaid && "max-md:hidden")}>{lastPaid ? <>Last paid {kes(lastPaid.amount, false)} on {fmtDate(lastPaid.createdAt)}</> : "No payments yet"}</p>
        {owing && promise && <p className="mt-1"><PromiseLine p={promise} className="text-sm" /></p>}
        {livePlan && <p className="mt-1 text-sm">On a payment plan{livePlan.status === "proposed" ? " (awaiting approval)" : ""}{nextInstalment ? <> · next {kes(String(nextInstalment.amount), false)} on {fmtDate(String(nextInstalment.dueDate))}</> : null}</p>}
        {(() => {
          // One clear next step as a button; everything else waits in "More".
          type Act = { key: string; label: string; icon: typeof Plus; run: () => void; testid: string };
          const acts = ([
            p.financeConfigure && notBilled && s.status === "active" && s.gradeId && { key: "bill", label: `Bill ${term!.name}`, icon: ReceiptText, run: () => navigate(`/invoices?bill=1&term=${term!.id}&grade=${s.gradeId}`), testid: "button-learner-bill" },
            p.bursar && { key: "pay", label: "Record payment", icon: Plus, run: () => setOpen("payment"), testid: "button-learner-pay" },
            p.notify && owing && guardian && { key: "remind", label: "Send reminder", icon: MessageCircle, run: () => setOpen("remind"), testid: "button-learner-remind" },
            p.collect && owing && { key: "stk", label: "M-Pesa prompt", icon: Smartphone, run: () => setOpen("stk"), testid: "button-learner-stk" },
            p.collect && owing && { key: "promise", label: "Promise to pay", icon: CalendarClock, run: () => setOpen("promise"), testid: "button-learner-promise" },
            p.bursar && owing && !livePlan && { key: "plan", label: "Payment plan", icon: CalendarRange, run: () => setOpen("plan"), testid: "button-learner-plan" },
            p.bursar && { key: "adjust", label: "Discount or sponsor", icon: BadgePercent, run: () => setOpen("adjustment"), testid: "button-learner-adjust" },
            p.bursar && credit && { key: "refund", label: "Refund", icon: Undo2, run: () => setOpen("refund"), testid: "button-learner-refund" },
            { key: "statement", label: statement.busy ? "Preparing statement…" : "Fee statement (PDF)", icon: Download, run: () => statement.run("statement", s.id, `Statement-${s.admissionNo}-${s.fullName}`), testid: `button-statement-${s.id}` },
          ].filter(Boolean) as Act[]);
          const [first, ...rest] = acts;
          return (
            <div className="mt-3 flex flex-wrap gap-2">
              <Action primary data-testid={first.testid} onClick={first.run}><first.icon className="h-3.5 w-3.5" />{first.label}</Action>
              {rest.length > 0 && <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" data-testid="button-learner-money-more" className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-card px-3 text-xs font-semibold hover:bg-muted">More<ChevronDown className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-52">
                  {rest.map((m) => <DropdownMenuItem key={m.key} onSelect={m.run} data-testid={m.testid}><m.icon className="h-4 w-4" />{m.label}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
          );
        })()}
      </>}
    </Card>
  );
  const schoolCard = p.academicRead && (
    <Card icon={GraduationCap} title={term ? `School · ${term.name}` : "School"} testid="card-school" key="school">
      {att.isLoading || cards.isLoading ? <SkeletonRows rows={2} cols={2} /> : <>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
          <span className="text-sm text-muted-foreground">{pct === null ? "No register taken yet this term" : `attendance · absent ${absent} day${absent === 1 ? "" : "s"}`}</span>
        </div>
        <p className={cn("mt-1 text-sm text-muted-foreground", !latestCard && "max-md:hidden")}>{latestCard ? <>{termName(latestCard.termId)} report card · {latestCard.status}</> : "No report card yet"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {latestCard && <Action disabled={pdf.isPending} onClick={() => pdf.mutate({ id: latestCard.id }, { onSuccess: (d) => window.open(d.downloadUrl, "_blank", "noopener"), onError: (x) => toast({ title: "Couldn't create the PDF", description: errMsg(x), variant: "destructive" }) })}><Download className="h-3.5 w-3.5" />Report card</Action>}
          <Link href="/attendance" className="inline-flex h-8 items-center px-1 text-xs font-medium text-primary hover:underline">Register</Link>
          <Link href="/assessments" className="inline-flex h-8 items-center px-1 text-xs font-medium text-primary hover:underline">Marks</Link>
        </div>
      </>}
    </Card>
  );
  const familyCard = (
    <Card icon={Users} title="Family" testid="card-family" key="family">
      {s.guardianNames.length === 0 ? <p className="text-sm text-muted-foreground">No parent or guardian linked yet. Parents need to be linked to pay and get messages on WhatsApp.</p> : (
        <ul className="space-y-1.5">
          {s.guardianNames.map((g, i) => (
            <li key={i} className="flex items-center gap-2.5 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">{initials(g)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{g}</span>
              {s.guardianPhones[i] && <a href={`tel:${s.guardianPhones[i]}`} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"><Phone className="h-3 w-3" />{s.guardianPhones[i]}</a>}
            </li>
          ))}
        </ul>
      )}
      {siblings.length > 0 && <p className="mt-2 text-sm text-muted-foreground">Sibling{siblings.length > 1 ? "s" : ""}: {siblings.map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link href={`/students/${x.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{x.name}</Link>{x.gradeName ? ` (${x.gradeName})` : ""}</span>)}</p>}
      {s.siblingCount > 0 && !siblings.length && <p className="mt-2 text-sm text-muted-foreground">{s.siblingCount} sibling{s.siblingCount > 1 ? "s" : ""} in school</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {p.notify && guardian && <Action data-testid="button-learner-message" onClick={() => setOpen("message")}><MessageCircle className="h-3.5 w-3.5" />Message parent</Action>}
        {onLinkGuardian && (s.guardianNames.length === 0
          ? <Action primary data-testid="button-add-guardian" onClick={onLinkGuardian}><Plus className="h-3.5 w-3.5" />Link guardian</Action>
          : <button type="button" data-testid="button-add-guardian" onClick={onLinkGuardian} className="inline-flex h-8 items-center gap-1 px-1 text-xs font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" />Add another guardian</button>)}
      </div>
    </Card>
  );
  // The bursar sees money first; teachers see school first and no money at all.
  const order = p.academicRead && !p.financeRead ? [schoolCard, familyCard] : p.financeRead && !p.academicRead ? [moneyCard, familyCard] : [moneyCard, schoolCard, familyCard];

  const close = () => setOpen(null);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{order}</div>

      <section className="rounded-xl border border-border bg-card" data-testid="learner-history">
        <h2 className="px-4 pt-4 text-xs font-medium text-muted-foreground">History</h2>
        {fin.isLoading && p.financeRead ? <div className="p-4"><SkeletonRows rows={3} cols={3} /></div> : !events.length ? <p className="px-4 py-4 text-sm text-muted-foreground">Nothing recorded yet. Invoices, payments, absences and report cards will appear here.</p> : (
          <ul className="mt-2 divide-y divide-border/60">
            {shown.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{e.at ? fmtDate(e.at) : ""}</span>
                <e.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">{e.text}</span>
                {e.amount && toCents(e.amount) !== 0n && <span className={cn("shrink-0 tabular-nums", e.credit && "text-primary")}>{e.credit ? "+" : ""}{kes(e.amount, false)}</span>}
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
        <div className="flex flex-wrap gap-4 border-t border-border/60 px-4 py-2.5 text-xs">
          {p.financeRead && <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" onClick={() => setLedger(!ledger)} data-testid="button-full-ledger">Full ledger<ChevronDown className={cn("h-3.5 w-3.5 transition", ledger && "rotate-180")} /></button>}
        </div>
      </section>
      {ledger && p.financeRead && <StudentFinancePanel studentId={s.id} />}
      {p.financeRead && myPlans.length > 0 && <section className="rounded-xl border border-border bg-card"><h2 className="px-4 pt-4 text-xs font-medium text-muted-foreground">Payment plans</h2><PlanTable plans={myPlans} decide={p.planDecide} /></section>}

      <FormDialog open={open === "payment"} onOpenChange={(o) => !o && close()} size="lg" title={`Record a payment for ${s.fullName}`} description="Cash or cheque. M-Pesa and bank payments arrive and match on their own."><RecordPayment studentId={s.id} onDone={close} /></FormDialog>
      <FormDialog open={open === "stk"} onOpenChange={(o) => !o && close()} size="lg" title={`Send an M-Pesa prompt for ${s.fullName}`} description="The parent gets a payment prompt on their phone and enters their M-Pesa PIN."><StkForm studentId={s.id} phone={phone} onClose={close} /></FormDialog>
      <FormDialog open={open === "promise"} onOpenChange={(o) => !o && close()} title={`Promise to pay for ${s.fullName}`} description="Record what the parent promised and by when. It shows as kept or broken by itself."><PromiseForm studentId={s.id} suggested={h?.balance} onDone={close} /></FormDialog>
      <FormDialog open={open === "plan"} onOpenChange={(o) => !o && close()} size="lg" title={`Payment plan for ${s.fullName}`} description="Split the balance into dated instalments. A principal or administrator approves it."><NewPlan studentId={s.id} onDone={close} /></FormDialog>
      <FormDialog open={open === "adjustment"} onOpenChange={(o) => !o && close()} size="lg" title={`Discount, bursary or sponsor for ${s.fullName}`} description={secondApproval ? "Sent for approval. Nothing changes the balance until it's approved." : "Applies to the balance as soon as you save."}><RequestForm kind="adjustment" studentId={s.id} onDone={close} /></FormDialog>
      <FormDialog open={open === "refund"} onOpenChange={(o) => !o && close()} size="lg" title={`Refund for ${s.fullName}`} description={secondApproval ? "Sent for approval, then the payout reference is recorded." : "Then record the payout reference once the money is sent."}><RequestForm kind="refund" studentId={s.id} onDone={close} /></FormDialog>
      {guardian && <FormDialog open={open === "remind"} onOpenChange={(o) => !o && close()} size="lg" title="Send a fee reminder" description="Check the message, then send it on WhatsApp."><Compose guardian={guardian} template="fee_reminder" content={reminder} onDone={close} /></FormDialog>}
      {guardian && <FormDialog open={open === "message"} onOpenChange={(o) => !o && close()} size="lg" title={`Message ${guardian.name}`} description="Sent on WhatsApp to the parent's number."><Compose guardian={guardian} template="general" onDone={close} /></FormDialog>}
    </div>
  );
}
