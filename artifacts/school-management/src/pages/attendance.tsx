import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAttendanceRegister, useSaveAttendanceRegister, useListStudents, getGetAttendanceRegisterQueryKey, getListStudentsQueryKey, type AttendanceInputEntriesItemStatus } from "@workspace/api-client-react";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, FormError } from "@/components/kit";
import { ClassBar, useClassContext } from "@/components/class-bar";
import { errMsg, fmtDate, localToday } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Status = AttendanceInputEntriesItemStatus;
const OPTS: { v: Status; label: string; on: string }[] = [
  { v: "present", label: "Present", on: "bg-emerald-600 text-white border-emerald-600" },
  { v: "absent", label: "Absent", on: "bg-rose-600 text-white border-rose-600" },
  { v: "late", label: "Late", on: "bg-amber-500 text-white border-amber-500" },
  { v: "excused", label: "Excused", on: "bg-slate-500 text-white border-slate-500" },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (day: string, by: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + by); return iso(d); };
/** The school week around a day: Monday to Friday. */
const weekOf = (day: string) => { const d = new Date(`${day}T12:00:00`); const mon = shift(day, -((d.getDay() + 6) % 7)); return [0, 1, 2, 3, 4].map((i) => shift(mon, i)); };

/** Daily register for one class: pick the day, tap each learner's status, submit the whole register. */
export default function Attendance() {
  const qc = useQueryClient(); const { toast } = useToast();
  const ctx = useClassContext(); const streamId = ctx.stream?.id ?? "";
  const today = localToday();
  const [date, setDate] = useState(today);
  const sp = { streamId };
  const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp), enabled: !!streamId } });
  const rp = { streamId, date };
  const reg = useGetAttendanceRegister(rp, { query: { queryKey: getGetAttendanceRegisterQueryKey(rp), enabled: !!streamId } });
  const hp = { streamId };
  const history = useGetAttendanceRegister(hp, { query: { queryKey: getGetAttendanceRegisterQueryKey(hp), enabled: !!streamId } });
  const save = useSaveAttendanceRegister();
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const learners = useMemo(() => (students.data ?? []).filter((s) => s.status === "active").sort((a, b) => a.fullName.localeCompare(b.fullName)), [students.data]);
  useEffect(() => { setMarks(Object.fromEntries((reg.data ?? []).map((r) => [r.studentId, r.status as Status]))); setChecked(false); setErr(null); }, [reg.data]);
  const markedDays = useMemo(() => new Set((history.data ?? []).map((r) => r.date.slice(0, 10))), [history.data]);
  const saved = (reg.data?.length ?? 0) > 0;
  const statusOf = (id: string) => marks[id] ?? "present";
  const counts = OPTS.map((o) => ({ ...o, n: learners.filter((s) => statusOf(s.id) === o.v).length }));
  const set = (id: string, v: Status) => { setMarks((m) => ({ ...m, [id]: v })); setChecked(false); };
  const submit = () => {
    setErr(null);
    if (!checked) return setErr(`Tick the box to confirm you have checked all ${learners.length} learners.`);
    save.mutate({ data: { streamId, date, entries: learners.map((s) => ({ studentId: s.id, status: statusOf(s.id) })) } }, {
      onSuccess: () => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/attendance") }); toast({ title: "Register submitted", description: `${ctx.stream?.gradeName} ${ctx.stream?.name}, ${fmtDate(date)}: ${counts[0].n} present, ${counts[1].n} absent.` }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Attendance" meta="Take the daily register for your class. Everyone starts as present; change only those who are not." />
      <ClassBar ctx={ctx} />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 max-md:flex-nowrap max-md:gap-0.5 max-md:border-0 max-md:bg-transparent max-md:p-0" data-testid="attendance-days">
        <Btn variant="ghost" className="h-8 w-8 p-0" aria-label="Previous day" onClick={() => setDate(shift(date, -1))}><ChevronLeft className="h-4 w-4" /></Btn>
        <div className="flex flex-1 gap-1 overflow-x-auto">{weekOf(date).map((d) => {
          const on = d === date, done = markedDays.has(d), future = d > today;
          return (
            <button key={d} type="button" disabled={future} onClick={() => setDate(d)} aria-pressed={on} data-testid={`day-${d}`}
              className={cn("flex min-w-[4.25rem] flex-1 flex-col items-center rounded-md px-2 py-1.5 text-xs transition max-md:!min-h-0 max-md:min-w-[3.5rem] max-md:py-1", on ? "bg-primary text-primary-foreground" : "hover:bg-muted", future && "opacity-40")}>
              <span className="font-semibold">{new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}</span>
              <span className={on ? "text-primary-foreground/80" : "text-muted-foreground"}>{new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", done ? (on ? "bg-primary-foreground" : "bg-emerald-600") : "bg-transparent")} title={done ? "Register taken" : undefined} />
            </button>
          );
        })}</div>
        <Btn variant="ghost" className="h-8 w-8 p-0" aria-label="Next day" disabled={date >= today} onClick={() => setDate(shift(date, 1))}><ChevronRight className="h-4 w-4" /></Btn>
        {date !== today && <Btn variant="outline" className="h-8" onClick={() => setDate(today)}>Today</Btn>}
      </div>

      {/* Phone: the card has no heading (the day strip above already says which day); one slim line under it carries
          the status, the tally and "All present". */}
      <Panel className="max-md:[&>div:first-child]:hidden" title={`${fmtDate(date)}${date === today ? " · today" : ""}`} note={!streamId ? undefined : saved ? "Register taken. Changes here resubmit it." : "Not taken yet."}
        action={learners.length > 0 ? <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="attendance-counts">{counts.map((c) => <span key={c.v} className={cn("rounded-full border px-2 py-0.5 font-semibold", c.n ? c.on : "border-border text-muted-foreground")}>{c.n} {c.label.toLowerCase()}</span>)}</div> : undefined}>
        {ctx.loading ? <SkeletonRows cols={2} /> : !streamId ? <Empty icon={<CalendarCheck className="h-5 w-5" />} title="No class to show" body="Add classes on the Classes page, or ask to be assigned to one." />
          : reg.isLoading || students.isLoading ? <SkeletonRows cols={2} /> : reg.isError ? <ErrorState msg={errMsg(reg.error)} onRetry={() => reg.refetch()} />
          : !learners.length ? <Empty icon={<CalendarCheck className="h-5 w-5" />} title="No learners" body="This class has no active learners yet." /> : <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground max-md:flex-nowrap max-md:px-3 max-md:py-1.5">
              <span className="max-md:hidden">Quick:</span>
              <span className="min-w-0 flex-1 truncate md:hidden" data-testid="attendance-summary"><b className={saved ? "text-primary" : "text-foreground"}>{saved ? "Taken" : "Not taken"}</b> · {counts.filter((c, i) => i === 0 || c.n > 0).map((c) => `${c.n} ${c.label.toLowerCase()}`).join(", ")}</span>
              <Btn variant="outline" className="h-7 px-2 text-xs max-md:!min-h-0 max-md:shrink-0" data-testid="button-all-present" onClick={() => { setMarks({}); setChecked(false); }}><Check className="h-3.5 w-3.5" /><span className="max-md:hidden">Everyone present</span><span className="md:hidden">All present</span></Btn>
            </div>
            <ol className="divide-y divide-border/60">{learners.map((s, i) => (
              <li key={s.id} data-testid={`row-attendance-${s.id}`} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 max-md:flex-nowrap max-md:px-3", statusOf(s.id) === "absent" && "bg-rose-50/60")}>
                <span className="w-6 text-right text-xs tabular-nums text-muted-foreground max-md:hidden">{i + 1}</span>
                <div className="flex min-w-[9rem] flex-1 items-baseline gap-2 truncate text-sm max-md:min-w-0"><span className="truncate font-medium">{s.fullName}</span><span className="shrink-0 font-mono text-[11px] text-muted-foreground max-md:hidden">{s.admissionNo}</span></div>
                <div className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${s.fullName}`}>{OPTS.map((o) => {
                  const on = statusOf(s.id) === o.v;
                  return <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => set(s.id, o.v)} data-testid={`att-${o.v}-${s.id}`}
                    className={cn("h-8 rounded-md border px-2.5 text-xs font-semibold transition-colors max-md:h-9 max-md:w-9 max-md:px-0 sm:px-3", on ? o.on : "border-border bg-card text-muted-foreground hover:bg-muted")}>
                    <span className="sm:hidden">{o.label[0]}</span><span className="max-sm:hidden">{o.label}</span>
                  </button>;
                })}</div>
              </li>))}</ol>
            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur max-md:px-3 max-md:py-2 md:bottom-0">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="check-register-confirm" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> <span className="max-md:hidden">I have checked all {learners.length} learners</span><span className="md:hidden">Checked all {learners.length}</span></label>
              <Btn data-testid="button-submit-register" className="ml-auto" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{saved ? "Resubmit register" : "Submit register"}</Btn>
              <div className="basis-full empty:hidden"><FormError msg={err} /></div>
            </div>
          </>}
      </Panel>
    </div>
  );
}
