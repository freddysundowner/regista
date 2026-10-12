import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useGetStaffProfile, getGetStaffProfileQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Pencil } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Pill, Btn } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { usePageTitle } from "@/lib/page-title";
import { useSession, ROLE_LABEL, errMsg, initials, fmtDate, fmtDateTime } from "@/lib/session";
import { actionLabel, subjectLabel } from "@/lib/audit-format";
import { StaffForm } from "@/pages/staff";
import { KIND_HELP, KIND_LABEL, KIND_TONE } from "@/lib/assignments";

const role = (r: string) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r;

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-2.5">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-snug tabular-nums">{value}</p>
      {note && <p className="truncate text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** One staff member: account details, where they teach, their workload and their recent activity. */
export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const me = useSession().user;
  const q = useGetStaffProfile(id, { query: { queryKey: getGetStaffProfileQueryKey(id) } });
  const [editing, setEditing] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const d = q.data;
  usePageTitle(d?.user.name ?? "Staff member");
  const back = <Link href="/staff" data-testid="link-back" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Staff</Link>;

  if (q.isLoading) return <div className="space-y-3">{back}<SkeletonRows rows={5} cols={4} /></div>;
  if (q.isError || !d) return <div className="space-y-3">{back}<ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /></div>;

  const u = d.user, s = d.stats;
  const past = d.assignments.filter((a) => !a.isCurrentTerm);
  const shown = showPast ? d.assignments : d.assignments.filter((a) => a.isCurrentTerm);
  return (
    <div className="space-y-4">
      <div>
        {back}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{initials(u.name)}</span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold leading-tight max-md:text-xl">{u.name}{u.id === me.id && <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">(you)</span>}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{role(u.role)}<Pill tone={u.isActive ? "active" : "inactive"}>{u.isActive ? "Active" : "Inactive"}</Pill></div>
          </div>
          <Btn variant="outline" className="h-8" data-testid="button-edit-staff" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
        </div>
      </div>
      <FormDialog phonePage open={editing} onOpenChange={setEditing} title={`Edit ${u.name}`} description="Role changes take effect on their next request.">
        {editing && <StaffForm user={u} onDone={() => { setEditing(false); q.refetch(); }} />}
      </FormDialog>

      <dl className="grid gap-x-6 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="staff-details">
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">Email</dt><dd className="truncate">{u.email ?? "—"}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Phone</dt><dd>{u.phone ?? "—"}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Staff since</dt><dd>{fmtDate(u.createdAt)}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Last sign-in</dt><dd>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</dd></div>
      </dl>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border/60 sm:grid-cols-3 lg:grid-cols-6" data-testid="staff-stats">
        <Stat label="Classes" value={s.classes} note="this term" />
        <Stat label="Learners" value={s.learners} note="in those classes" />
        <Stat label="Subjects" value={s.subjects} note="this term" />
        <Stat label="Attendance marked" value={s.attendanceMarked} note={`${s.registersMarked} registers · 30 days`} />
        <Stat label="Assessments set" value={s.assessments} note="this term" />
        <Stat label="Actions logged" value={s.actions} note={s.lastActivityAt ? `last ${fmtDate(s.lastActivityAt)}` : "none yet"} />
      </div>

      <Panel title="Teaching assignments" action={past.length > 0 ? <button type="button" onClick={() => setShowPast((v) => !v)} className="text-xs font-semibold text-primary hover:underline" data-testid="button-toggle-past">{showPast ? "Hide past terms" : `Show past terms (${past.length})`}</button> : undefined}>
        {!shown.length ? <p className="px-5 py-4 text-sm text-muted-foreground">{["teacher", "class_teacher"].includes(u.role) ? <>No classes assigned. Set a class teacher on <Link href="/classes" className="font-semibold text-primary hover:underline">Classes</Link> or assign them on <Link href="/teacher-assignments" className="font-semibold text-primary hover:underline">Teacher assignments</Link>.</> : "Not a teaching role."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="px-5 py-2 font-medium">Class</th><th className="px-3 py-2 font-medium">Assignment</th><th className="px-3 py-2 font-medium">Term</th><th className="px-3 py-2 font-medium">Since</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">{shown.map((a) => (
                <tr key={a.id} data-testid={`row-staff-assignment-${a.recordId}`} className={a.isCurrentTerm ? "" : "opacity-60"}>
                  <td className="px-5 py-2"><Link href={`/classes/stream/${a.streamId}`} className="font-medium hover:underline">{a.gradeName} {a.streamName}</Link></td>
                  <td className="px-3 py-2"><span title={KIND_HELP[a.kind]} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[a.kind]}`}>{a.kind === "subject" ? a.subject : KIND_LABEL[a.kind]}</span></td>
                  <td className="px-3 py-2 text-muted-foreground">{a.termName ?? "All terms"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(a.assignedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent activity" note={s.actions > d.activity.length ? `Latest ${d.activity.length} of ${s.actions}` : undefined}>
        {!d.activity.length ? <p className="px-5 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p> : (
          <ul className="divide-y divide-border/60 text-sm">{d.activity.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 px-5 py-2">
              <span className="min-w-0 flex-1">{actionLabel(e)}{subjectLabel(e) && <span className="text-muted-foreground"> · {subjectLabel(e)}</span>}</span>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.createdAt}>{fmtDateTime(e.createdAt)}</time>
            </li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}
