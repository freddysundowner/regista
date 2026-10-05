import { Link } from "wouter";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { ArrowUpRight, FileSpreadsheet, GraduationCap, Plus } from "lucide-react";
import { PageHeader, Panel, ErrorState, Empty } from "@/components/kit";
import { FinanceOverviewPanel } from "@/components/finance-overview";
import { ModuleDashboard } from "@/components/module-dashboard";
import { useSession, usePerms, errMsg, fmtDateTime } from "@/lib/session";

export default function Dashboard() {
  const { user } = useSession();
  const p = usePerms();
  const q = useGetDashboardSummary();
  const d = q.data;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const stats = d ? [
    { k: "Active learners", v: d.activeStudents, sub: `of ${d.totalStudents} on register` },
    { k: "Guardians", v: d.guardianCount, sub: `${d.familyCount} families` },
    { k: "Grades", v: d.gradeCount, sub: `${d.streamCount} streams` },
    { k: "Staff", v: d.staffCount, sub: "accounts" },
  ] : [];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={d?.currentAcademicYear ? `Academic year ${d.currentAcademicYear}` : "No current academic year"} title={`${greet}, ${user.name.split(" ")[0]}`} meta={d?.schoolName}>
        {p.writeStudents && <Link href="/students?new=1" data-testid="link-new-student" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /> Admit student</Link>}
        {p.importStudents && <Link href="/import" data-testid="link-import" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3.5 text-sm font-semibold hover:bg-muted"><FileSpreadsheet className="h-4 w-4" /> Import</Link>}
      </PageHeader>
      {(p.financeRead || p.academicRead) && <ModuleDashboard />}

      {q.isError ? <Panel><ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></Panel> : (
        <div className="rise rise-1 grid grid-cols-2 overflow-hidden rounded-lg border border-card-border bg-card lg:grid-cols-4">
          {(q.isLoading ? Array.from({ length: 4 }) : stats).map((s, i) => (
            <div key={i} className="min-w-0 border-b border-r border-border/70 px-3.5 py-3.5 last:border-r-0 md:px-5 md:py-5 lg:border-b-0">
              {s && typeof s === "object" ? (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{(s as typeof stats[0]).k}</div>
                  <div data-testid={`stat-${i}`} className="mt-1 font-display text-3xl font-semibold tabular-nums md:mt-2 md:text-4xl">{(s as typeof stats[0]).v.toLocaleString()}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{(s as typeof stats[0]).sub}</div>
                </>
              ) : <div className="space-y-3"><div className="h-3 w-20 animate-pulse rounded bg-muted" /><div className="h-8 w-16 animate-pulse rounded bg-muted" /></div>}
            </div>
          ))}
        </div>
      )}

      {p.financeRead && <FinanceOverviewPanel />}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Recent activity" note="Latest changes to the register" className="rise-2" action={p.viewAudit ? <Link href="/audit" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Full history <ArrowUpRight className="h-3 w-3" /></Link> : undefined}>
          {q.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" />)}</div> :
            !d?.recentActivity.length ? <Empty icon={<GraduationCap className="h-5 w-5" />} title={p.viewAudit ? "A clean slate" : "Activity is restricted"} body={p.viewAudit ? "Activity appears here as staff add students, guardians and settings." : "Only administrators and the principal can see the change history."} /> :
              <ol className="relative px-5 py-4">
                <span className="absolute bottom-4 left-[27px] top-4 w-px bg-border" />
                {d.recentActivity.slice(0, 10).map((a) => (
                  <li key={a.id} className="relative flex gap-4 py-2">
                    <span className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-card bg-amber-500 ring-1 ring-amber-600/30" />
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{a.userName ?? "System"}</span>{" "}
                      <span className="text-muted-foreground">{a.action.replace(/[._]/g, " ")}</span>{" "}
                      <span className="font-mono text-xs text-foreground/70">{a.entityType}</span>
                    </div>
                    <time className="shrink-0 font-mono text-[11px] text-muted-foreground">{fmtDateTime(a.createdAt)}</time>
                  </li>
                ))}
              </ol>}
        </Panel>
        <Panel title="Getting the register right" className="rise-3">
          <ul className="divide-y divide-border/70 text-sm">
            {[
              { t: "Set the academic year and terms", h: "/academics", ok: !!d?.currentAcademicYear, show: p.manageSchool },
              { t: "Create grades and streams", h: "/academics", ok: (d?.gradeCount ?? 0) > 0, show: p.manageSchool },
              { t: "Invite staff accounts", h: "/staff", ok: (d?.staffCount ?? 0) > 1, show: p.manageSchool },
              { t: "Import or admit students", h: p.importStudents ? "/import" : "/students", ok: (d?.totalStudents ?? 0) > 0, show: p.writeStudents },
            ].filter((x) => x.show).map((x) => (
              <li key={x.t}>
                <Link href={x.h} className="group flex items-center gap-3 px-5 py-3 hover:bg-muted/50">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${x.ok ? "border-primary bg-primary text-primary-foreground" : "border-input text-transparent"}`}>✓</span>
                  <span className={x.ok ? "text-muted-foreground line-through decoration-border" : ""}>{x.t}</span>
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </Link>
              </li>
            ))}
            {p.limitedToAssigned && <li className="px-5 py-4 text-muted-foreground">You see learners in the streams assigned to you. Open Students to view your class list.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
