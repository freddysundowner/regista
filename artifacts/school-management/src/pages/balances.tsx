import { useMemo, useState } from "react";
import { PromiseForm, PromiseLine } from "@/components/promise";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetFinanceArrears, getGetFinanceArrearsQueryKey, useSendFeeReminders, type ArrearsRow, type FeeReminderResult } from "@workspace/api-client-react";
import { AlertTriangle, FileDown, Loader2, MessageCircle, Search, Wallet } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Filters, TextInput, NativeSelect, FormError } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { Pager, usePaged } from "@/components/pager";
import { usePerms, errMsg, fmtDate } from "@/lib/session";
import { kes } from "@/lib/finance";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const n = (v?: string | null) => Number(v ?? 0);
const behind = (r: ArrearsRow) => n(r.threePlusTerms) > 0 ? 3 : n(r.twoTerms) > 0 ? 2 : n(r.oneTerm) > 0 ? 1 : 0;
const BEHIND_LABEL = ["", "1 term behind", "2 terms behind", "3+ terms behind"];
const WEEK = 7 * 86_400_000;

type FilterId = "owing" | "over10k" | "behind" | "promised" | "broken" | "plan" | "sponsored" | "notReminded" | "paid" | "notBilled" | "all";
const FILTERS: { id: FilterId; label: string; test: (r: ArrearsRow) => boolean }[] = [
  { id: "owing", label: "Owes money", test: (r) => n(r.balance) > 0 },
  { id: "over10k", label: "Owes over 10k", test: (r) => n(r.balance) > 10_000 },
  { id: "behind", label: "From past terms", test: (r) => n(r.balance) > 0 && behind(r) > 0 },
  { id: "broken", label: "Promise broken", test: (r) => n(r.balance) > 0 && r.promise?.state === "broken" },
  { id: "promised", label: "Promised to pay", test: (r) => n(r.balance) > 0 && r.promise?.state === "due" },
  { id: "notReminded", label: "Not reminded this week", test: (r) => n(r.balance) > 0 && (!r.lastReminderAt || Date.now() - Date.parse(r.lastReminderAt) > WEEK) },
  { id: "plan", label: "On a plan", test: (r) => r.onPlan },
  { id: "sponsored", label: "Sponsored", test: (r) => r.sponsored },
  { id: "paid", label: "Paid up or in credit", test: (r) => n(r.balance) <= 0 },
  { id: "notBilled", label: "Not billed this term", test: (r) => !r.billedThisTerm },
  { id: "all", label: "Everyone", test: () => true },
];

/** The bursar's main list: who owes, how far behind, and one action to remind them all. */
export default function Balances() {
  usePageTitle("Who owes");
  const p = usePerms();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const q = useGetFinanceArrears({ query: { queryKey: getGetFinanceArrearsQueryKey(), refetchInterval: 60_000 } });
  const send = useSendFeeReminders();
  const show = new URLSearchParams(useSearch()).get("show");
  const [filter, setFilter] = useState<FilterId>(() => show === "not-billed" ? "notBilled" : "owing");
  const [grade, setGrade] = useState("");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [result, setResult] = useState<FeeReminderResult | null>(null);
  const [promising, setPromising] = useState<ArrearsRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  const grades = useMemo(() => [...new Set(rows.map((r) => r.gradeName).filter(Boolean) as string[])], [rows]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter(f.test).length])), [rows]);
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase(), f = FILTERS.find((x) => x.id === filter)!;
    return rows.filter((r) => f.test(r) && (!grade || r.gradeName === grade)
      && (!t || `${r.studentName} ${r.admissionNo} ${r.guardianName ?? ""} ${r.guardianPhone ?? ""}`.toLowerCase().includes(t)))
      .sort((a, b) => n(b.balance) - n(a.balance));
  }, [rows, filter, grade, text]);
  const { rows: pageRows, pager } = usePaged(shown, [filter, grade, text]);
  const owing = rows.filter((r) => n(r.balance) > 0);
  const totalOwed = owing.reduce((s, r) => s + n(r.balance), 0);
  const pastTerms = owing.reduce((s, r) => s + n(r.oneTerm) + n(r.twoTerms) + n(r.threePlusTerms), 0);
  const remindable = (ids: string[]) => ids.filter((id) => { const r = rows.find((x) => x.studentId === id); return r && n(r.balance) > 0; });
  const shownIds = shown.map((r) => r.studentId);
  const allPicked = shownIds.length > 0 && shownIds.every((id) => picked.has(id));
  const toggle = (id: string) => { const s = new Set(picked); s.has(id) ? s.delete(id) : s.add(id); setPicked(s); };
  const sample = rows.find((r) => r.studentId === confirming?.[0]);

  const doSend = (ids: string[]) => {
    setErr(null);
    send.mutate({ data: { studentIds: ids } }, {
      onSuccess: (r) => {
        setConfirming(null); setResult(r); setPicked(new Set());
        void qc.invalidateQueries({ queryKey: getGetFinanceArrearsQueryKey() });
        toast({ title: r.queued ? `${r.queued} reminder${r.queued === 1 ? "" : "s"} sent` : "No reminders sent", description: r.skipped.length ? `${r.skipped.length} skipped. See why below.` : undefined });
      },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const exportRows = shown.map((r) => ({ admissionNo: r.admissionNo, studentName: r.studentName, grade: [r.gradeName, r.streamName].filter(Boolean).join(" "), balance: r.balance, thisTerm: r.current, pastTerms: (n(r.oneTerm) + n(r.twoTerms) + n(r.threePlusTerms)).toFixed(2), lastPaid: r.lastPaidAt ? fmtDate(r.lastPaidAt) : "", parent: r.guardianName ?? "", phone: r.guardianPhone ?? "" }));
  const exportCols = [{ key: "admissionNo", label: "Adm. no" }, { key: "studentName", label: "Learner" }, { key: "grade", label: "Class" }, { key: "balance", label: "Balance" }, { key: "thisTerm", label: "This term" }, { key: "pastTerms", label: "Past terms" }, { key: "lastPaid", label: "Last paid" }, { key: "parent", label: "Parent" }, { key: "phone", label: "Phone" }];
  const nameOf = (id: string) => rows.find((r) => r.studentId === id)?.studentName ?? "Learner";

  return (
    <div className="space-y-5">
      <PageHeader title="Who owes" meta={q.data?.termName ? `${q.data.termName} · balances include every term` : "Balances include every term"}>
        <Btn variant="outline" disabled={!shown.length} onClick={() => void exportXlsx("Who owes", exportCols, exportRows, "who-owes")}><FileDown className="h-4 w-4" />Excel</Btn>
        <Btn variant="outline" disabled={!shown.length} onClick={() => exportCsv(exportCols, exportRows, "who-owes")}><FileDown className="h-4 w-4" />CSV</Btn>
      </PageHeader>

      {!!q.data?.notBilled && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-sm" data-testid="not-billed-banner">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
          <span className="min-w-0 flex-1"><b>{q.data.notBilled} learner{q.data.notBilled === 1 ? " isn't" : "s aren't"} billed for {q.data.termName} yet</b>, so this term's fees don't show for them here. Billing again bills only them; learners already billed are left alone.</span>
          {filter !== "notBilled" && <button type="button" onClick={() => setFilter("notBilled")} className="text-xs font-semibold text-primary underline-offset-2 hover:underline">See who</button>}
          {p.manageSchool ? <Link href="/term-setup?step=billing" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">Bill them</Link>
            : <span className="text-xs text-muted-foreground">Ask the school administrator to bill them.</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Still owed", kes(totalOwed.toFixed(2))], ["Learners owing", String(owing.length)], ["From past terms", kes(pastTerms.toFixed(2))], ["Not reminded this week", String(counts.notReminded ?? 0)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card px-4 py-3"><div className="text-xs text-muted-foreground">{k}</div><div className="mt-1 text-xl font-semibold tabular-nums">{q.isLoading ? "…" : v}</div></div>
        ))}
      </div>

      <Panel>
        <div className="space-y-3 border-b border-border/70 p-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`filter-${f.id}`}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40")}>
                {f.label} <span className="tabular-nums opacity-70">{counts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <Filters active={grade ? 1 : 0} onClear={() => setGrade("")} lead={<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <TextInput aria-label="Search" className="pl-9" placeholder="Learner, admission no., parent or phone" value={text} onChange={(e) => setText(e.target.value)} /></div>}>
            <NativeSelect aria-label="Grade" className="sm:w-44" value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">All grades</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</NativeSelect>
          </Filters>
        </div>

        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !shown.length ? (
          <Empty icon={<Wallet className="h-5 w-5" />} title={rows.length ? "Nobody here" : "No learners yet"} body={rows.length ? "No learner matches this filter." : "Add learners and bill them, and anyone owing appears here."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm" data-testid="table-who-owes">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr className="border-b border-border/70">
                  {p.collect && <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label={`Select all ${shownIds.length}`} className="h-4 w-4 accent-[hsl(var(--primary))]" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shownIds))} data-testid="select-all" /></th>}
                  <th className="px-3 py-2.5">Learner</th><th className="px-3 py-2.5 text-right">Balance</th><th className="px-3 py-2.5">Last paid</th><th className="px-3 py-2.5">Parent</th><th className="px-3 py-2.5">Reminded</th>{p.collect && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const b = behind(r), owes = n(r.balance) > 0;
                  return (
                    <tr key={r.studentId} className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-accent/30" onClick={() => navigate(`/students/${r.studentId}`)} data-testid={`row-owes-${r.studentId}`}>
                      {p.collect && <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.studentName}`} className="h-4 w-4 accent-[hsl(var(--primary))]" checked={picked.has(r.studentId)} onChange={() => toggle(r.studentId)} /></td>}
                      <td className="px-3 py-3">
                        <div className="font-semibold">{r.studentName}</div>
                        <div className="text-[11px] text-muted-foreground">{[r.gradeName, r.streamName].filter(Boolean).join(" ") || "No class"} · {r.admissionNo}
                          {r.onPlan && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-primary">plan</span>}{r.sponsored && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-primary">sponsored</span>}</div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className={cn("font-semibold tabular-nums", owes ? "" : "text-primary")}>{owes ? kes(r.balance, false) : n(r.balance) < 0 ? `${kes(String(-n(r.balance)), false)} credit` : "Paid up"}</div>
                        {owes && b > 0 && <div className="text-[11px] font-medium text-amber-700">{BEHIND_LABEL[b]}</div>}
                        {owes && <div><PromiseLine p={r.promise} /></div>}
                      </td>
                      <td className="px-3 py-3 text-xs">{r.lastPaidAt ? <>{fmtDate(r.lastPaidAt)}<div className="text-muted-foreground">{kes(r.lastPaidAmount, false)}</div></> : <span className="text-muted-foreground">Never</span>}</td>
                      <td className="px-3 py-3 text-xs">{r.guardianName ? <>{r.guardianName}<div className="font-mono text-muted-foreground">{r.guardianPhone}</div></> : <span className="text-amber-700">No parent linked</span>}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{r.lastReminderAt ? fmtDate(r.lastReminderAt) : "Not yet"}</td>
                      {p.collect && <td className="whitespace-nowrap px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>{owes && <Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPromising(r)} data-testid={`promise-${r.studentId}`}>Promise</Btn>}{owes && r.guardianName && <Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirming([r.studentId])} data-testid={`remind-${r.studentId}`}><MessageCircle className="h-3.5 w-3.5" />Remind</Btn>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager {...pager} />
      </Panel>

      {result && result.skipped.length > 0 && (
        <Panel title={`${result.skipped.length} not sent`} note="Fix these, then send again. Learners already reminded today aren't sent twice.">
          <ul className="divide-y divide-border/60 text-sm">{result.skipped.slice(0, 50).map((s) => <li key={s.studentId} className="flex flex-wrap justify-between gap-2 px-5 py-2.5"><span className="font-medium">{nameOf(s.studentId)}</span><span className="text-muted-foreground">{s.reason}</span></li>)}</ul>
        </Panel>
      )}

      {p.collect && picked.size > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg" data-testid="selection-bar">
          <span className="text-sm"><b>{picked.size}</b> selected · {remindable([...picked]).length} owe money</span>
          <Btn variant="ghost" className="h-8 px-3 text-xs" onClick={() => setPicked(new Set())}>Clear</Btn>
          <Btn className="ml-auto" disabled={!remindable([...picked]).length} onClick={() => setConfirming(remindable([...picked]))} data-testid="button-remind-selected"><MessageCircle className="h-4 w-4" />Send WhatsApp reminder to {remindable([...picked]).length}</Btn>
        </div>
      )}

      <FormDialog open={!!promising} onOpenChange={(o) => { if (!o) setPromising(null); }} title={promising ? `Promise to pay for ${promising.studentName}` : "Promise to pay"} description={promising ? `Owes ${kes(promising.balance)}. Record what the parent promised and by when.${promising.promise && ["due", "broken"].includes(promising.promise.state) ? " This replaces their current promise." : ""}` : undefined}>
        {promising && <PromiseForm key={promising.studentId} studentId={promising.studentId} suggested={promising.balance} onDone={() => setPromising(null)} />}
      </FormDialog>
      <FormDialog open={!!confirming} onOpenChange={(o) => { if (!o) { setConfirming(null); setErr(null); } }} title={confirming?.length === 1 ? `Remind ${nameOf(confirming[0])}'s parent` : `Send ${confirming?.length ?? 0} fee reminders`}
        description="Each parent gets their own learner's balance on WhatsApp.">
        <div className="space-y-4 p-5">
          {sample && <div className="rounded-xl bg-muted/50 p-4 text-sm"><div className="mb-1 text-xs font-medium text-muted-foreground">Example message</div>
            Dear {sample.guardianName ?? "parent"}, {sample.studentName.split(" ")[0]}'s fee balance is {kes(sample.balance)}. Pay to the school paybill using account {sample.admissionNo}. Thank you.</div>}
          <p className="text-xs text-muted-foreground">Learners with no parent linked are skipped. Sending again today won't repeat a reminder unless the balance has changed.</p>
          <FormError msg={err} />
          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="ghost" onClick={() => setConfirming(null)}>Cancel</Btn>
            <Btn disabled={send.isPending} onClick={() => confirming && doSend(confirming)} data-testid="button-confirm-remind">{send.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send {confirming?.length === 1 ? "reminder" : `${confirming?.length} reminders`}</Btn>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
