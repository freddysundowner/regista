import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAttendanceRegister, useSaveAttendanceRegister, useListStreams, useListStudents, getGetAttendanceRegisterQueryKey, getListStreamsQueryKey, getListStudentsQueryKey, type AttendanceInputEntriesItemStatus } from "@workspace/api-client-react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError } from "@/components/kit";
import { errMsg, fmtDate, localToday } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const OPTS: { v: AttendanceInputEntriesItemStatus; label: string; cls: string }[] = [
  { v: "present", label: "P", cls: "bg-primary text-primary-foreground" }, { v: "absent", label: "A", cls: "bg-destructive text-destructive-foreground" },
  { v: "late", label: "L", cls: "bg-amber-500 text-white" }, { v: "excused", label: "E", cls: "bg-slate-500 text-white" },
];

export default function Attendance() {
  const qc = useQueryClient(); const { toast } = useToast();
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const [streamId, setStreamId] = useState(""); const [date, setDate] = useState(localToday());
  const stream = streams.data?.find((s) => s.id === streamId);
  const sp = stream ? { gradeId: stream.gradeId } : undefined;
  const students = useListStudents(sp, { query: { queryKey: getListStudentsQueryKey(sp), enabled: !!stream } });
  const rp = { streamId, date };
  const reg = useGetAttendanceRegister(rp, { query: { queryKey: getGetAttendanceRegisterQueryKey(rp), enabled: !!streamId } });
  const save = useSaveAttendanceRegister();
  const [marks, setMarks] = useState<Record<string, AttendanceInputEntriesItemStatus>>({});
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const learners = useMemo(() => (students.data ?? []).filter((s) => s.streamId === streamId && s.status === "active").sort((a, b) => a.fullName.localeCompare(b.fullName)), [students.data, streamId]);
  useEffect(() => { setMarks(Object.fromEntries((reg.data ?? []).map((r) => [r.studentId, r.status as AttendanceInputEntriesItemStatus]))); setChecked(false); }, [reg.data]);
  const saved = (reg.data?.length ?? 0) > 0;
  const statusOf = (id: string) => marks[id] ?? "present";
  const counts = OPTS.map((o) => ({ ...o, n: learners.filter((s) => statusOf(s.id) === o.v).length }));
  const submit = () => {
    setErr(null);
    if (!checked) return setErr(`Confirm you have checked all ${learners.length} learners. Every learner is submitted explicitly.`);
    save.mutate({ data: { streamId, date, entries: learners.map((s) => ({ studentId: s.id, status: statusOf(s.id) })) } }, {
      onSuccess: () => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/attendance") }); toast({ title: "Register submitted", description: `${learners.length} learners recorded for ${fmtDate(date)}.` }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Academics" title="Attendance" meta="Daily class register. Learners show as present until you change them, but nothing is recorded until you submit the whole register." />
      <Panel>
        <div className="grid gap-3 border-b border-border/70 p-4 sm:grid-cols-2">
          <Field label="Stream" required><NativeSelect data-testid="select-stream" value={streamId} onChange={(e) => setStreamId(e.target.value)}><option value="">{streams.isLoading ? "Loading" : streams.isError ? "Streams unavailable" : "Select stream"}</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.gradeName} {s.name}</option>)}</NativeSelect></Field>
          <Field label="Date" required><TextInput type="date" data-testid="input-attendance-date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {streams.isError ? <ErrorState msg={errMsg(streams.error)} onRetry={() => streams.refetch()} /> : !streamId ? <Empty icon={<CalendarCheck className="h-5 w-5" />} title="Choose a stream" body="Pick your class and the day to take the register." />
          : reg.isLoading || students.isLoading ? <SkeletonRows cols={2} /> : reg.isError ? <ErrorState msg={errMsg(reg.error)} onRetry={() => reg.refetch()} />
          : !learners.length ? <Empty icon={<CalendarCheck className="h-5 w-5" />} title="No learners" body="No active learners in this stream." /> : <>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-2 text-xs">{saved ? <span className="font-semibold text-primary">Submitted register; editing will resubmit</span> : <span className="font-semibold text-amber-800">Not yet submitted</span>}{counts.map((c) => <span key={c.v} className="capitalize">{c.v} {c.n}</span>)}</div>
            <ul className="divide-y divide-border/60">{learners.map((s) => (
              <li key={s.id} data-testid={`row-attendance-${s.id}`} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1 text-sm"><div className="truncate font-medium">{s.fullName}</div><div className="font-mono text-[11px] text-muted-foreground">{s.admissionNo}</div></div>
                <div className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${s.fullName}`}>{OPTS.map((o) => (
                  <button key={o.v} type="button" role="radio" aria-checked={statusOf(s.id) === o.v} aria-label={o.v} onClick={() => { setMarks({ ...marks, [s.id]: o.v }); setChecked(false); }}
                    className={`h-10 w-10 rounded-md text-sm font-semibold transition-colors sm:h-8 sm:w-8 ${statusOf(s.id) === o.v ? o.cls : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>{o.label}</button>))}</div>
              </li>))}</ul>
            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 space-y-2 md:bottom-0 border-t border-border/70 bg-card/95 p-4 backdrop-blur">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="check-register-confirm" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I have checked all {learners.length} learners for {fmtDate(date)}</label>
              <FormError msg={err} />
              <Btn data-testid="button-submit-register" className="w-full sm:w-auto" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit register ({learners.length})</Btn>
            </div>
          </>}
      </Panel>
    </div>
  );
}
