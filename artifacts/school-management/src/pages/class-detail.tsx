import { useState, type ReactNode } from "react";
import { Pager, usePaged } from "@/components/pager";
import { ListSearch, matches } from "@/components/list-search";
import { Link, useLocation, useParams } from "wouter";
import { useGetClassSummary, getGetClassSummaryQueryKey } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { Panel, SkeletonRows, ErrorState } from "@/components/kit";
import { usePageTitle } from "@/lib/page-title";
import { errMsg } from "@/lib/session";
import { kes } from "@/lib/finance";

const BAND_LABEL: Record<string, string> = { pre_primary: "Pre-primary", lower_primary: "Lower primary", upper_primary: "Upper primary", junior: "Junior school", senior: "Senior school", other: "Other" };

function Stat({ label, value, note, warn }: { label: string; value: ReactNode; note?: ReactNode; warn?: boolean }) {
  return (
    <div className="min-w-0 bg-card px-4 py-2.5">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold leading-snug tabular-nums ${warn ? "text-amber-700" : ""}`}>{value}</p>
      {note && <p className="truncate text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** One class (or a grade run as a single class): teachers, learners, attendance and fees on one compact page. */
export default function ClassDetail() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const [, navigate] = useLocation();
  const params = kind === "grade" ? { gradeId: id } : { streamId: id };
  const q = useGetClassSummary(params, { query: { queryKey: getGetClassSummaryQueryKey(params) } });
  const d = q.data;
  usePageTitle(d?.name ?? "Class");
  const [text, setText] = useState("");
  const found = (d?.students ?? []).filter((s) => matches(text, s.fullName, s.admissionNo));
  const { rows: learners, pager } = usePaged(found, text);
  const back = <Link href="/classes" data-testid="link-back" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Classes</Link>;

  if (q.isLoading) return <div className="space-y-3">{back}<SkeletonRows rows={4} cols={4} /></div>;
  if (q.isError || !d) return <div className="space-y-3">{back}<ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></div>;

  const l = d.learners, a = d.attendance;
  const others = d.teachers.filter((t) => t.id !== d.classTeacher?.id);
  return (
    <div className="space-y-4">
      <div>
        {back}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="font-display text-2xl font-semibold leading-tight max-md:hidden">{d.name}</h1>
          <p className="text-sm text-muted-foreground">{BAND_LABEL[d.levelBand] ?? d.levelBand}{d.kind === "stream" ? ` · ${d.gradeName}` : " · single class"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border/60 lg:grid-cols-4" data-testid="class-stats">
        <Stat label="Learners" value={l.total} note={`${l.female} girls · ${l.male} boys${l.other ? ` · ${l.other} other` : ""} · ${l.boarders} boarding`} />
        <Stat label="Attendance, 30 days" value={a.percent ? `${a.percent}%` : "—"} note={a.days ? `${a.days} ${a.days === 1 ? "day" : "days"} marked` : "Not marked yet"} />
        <Stat label="Today" value={a.todayMarked ? `${a.todayPresent}/${a.todayMarked}` : "—"} note={a.todayMarked ? `${a.todayAbsent} absent` : "Register not marked"} warn={a.todayAbsent > 0} />
        {d.fees ? <Stat label="Fees outstanding" value={kes(d.fees.outstanding)} note={`${d.fees.owing} ${d.fees.owing === 1 ? "learner owes" : "learners owe"}${d.fees.credit !== "0.00" ? ` · ${kes(d.fees.credit)} credit` : ""}`} warn={d.fees.owing > 0} />
          : <Stat label="Day scholars" value={l.day} />}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm" data-testid="class-teachers">
        <div className="flex gap-1.5"><dt className="text-muted-foreground">Class teacher:</dt><dd className="font-medium">{d.classTeacher?.name ?? <span className="font-normal text-muted-foreground">not set</span>}</dd></div>
        <div className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-muted-foreground">Subject teachers:</dt><dd className="min-w-0">{others.length ? others.map((t, i) => <span key={t.id}>{i > 0 && ", "}<span className="font-medium">{t.name}</span>{t.subjects.length > 0 && <span className="text-muted-foreground"> ({t.subjects.join(", ")})</span>}</span>) : <span className="text-muted-foreground">none this term</span>}</dd></div>
        {l.former > 0 && <div className="flex gap-1.5"><dt className="text-muted-foreground">Former learners:</dt><dd className="tabular-nums">{l.former}</dd></div>}
      </dl>

      <Panel title={`Learners (${l.total})`}>
        {d.students.length > 10 && <div className="border-b border-border/70 p-3"><ListSearch value={text} onChange={setText} placeholder="Search learner or admission no." /></div>}
        {!d.students.length ? <p className="px-5 py-4 text-sm text-muted-foreground">No learners in this class yet.</p> : !found.length ? <p className="px-5 py-4 text-sm text-muted-foreground">No learner matches “{text}”.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="px-5 py-2 font-medium">Learner</th><th className="px-3 py-2 font-medium">Adm. no</th><th className="px-3 py-2 font-medium">Gender</th><th className="px-3 py-2 text-right font-medium">Attendance</th>{d.fees && <th className="px-3 py-2 text-right font-medium">Balance</th>}</tr>
              </thead>
              <tbody className="divide-y divide-border/60">{learners.map((s) => (
                <tr key={s.id} data-testid={`row-learner-${s.id}`} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/students/${s.id}`)}>
                  <td className="px-5 py-2"><Link href={`/students/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{s.fullName}</Link>{s.boardingStatus === "boarder" && <span className="ml-2 text-xs text-muted-foreground">Boarder</span>}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.admissionNo}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{s.gender ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.attendancePercent ? `${s.attendancePercent}%` : "—"}</td>
                  {d.fees && <td className={`px-3 py-2 text-right tabular-nums ${s.balance && Number(s.balance) > 0 ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{kes(s.balance)}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pager {...pager} />
      </Panel>
    </div>
  );
}
