import { useState } from "react";
import { Link, useParams } from "wouter";
import { useGetPlatformSchool, useListPlatformAdmins, useListPlatformAudit, getGetPlatformSchoolQueryKey, getListPlatformAdminsQueryKey, getListPlatformAuditQueryKey, type User } from "@workspace/api-client-react";
import { RegistrationReviewDialog } from "@/components/registration-review";
import { ArrowLeft, CalendarClock, ClipboardCheck, DoorOpen, KeyRound, Pencil, Plus, Power, ScrollText, UserCog } from "lucide-react";
import { BillingPanel } from "@/components/platform-billing";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { SchoolEditForm, AdminForm, AdminStatusForm, ResetPasswordForm } from "@/components/platform-forms";
import { EnterSchoolDialog } from "@/components/platform-kit";
import { errMsg, fmtDate, fmtDateTime, initials } from "@/lib/session";

type Dlg = { kind: "add" } | { kind: "edit" | "status" | "reset"; admin: User } | null;

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words text-sm capitalize">{v}</dd></div>;
}

export default function PlatformSchool() {
  const { id = "" } = useParams<{ id: string }>();
  const sq = useGetPlatformSchool(id, { query: { queryKey: getGetPlatformSchoolQueryKey(id), enabled: !!id } });
  const aq = useListPlatformAdmins(id, { query: { queryKey: getListPlatformAdminsQueryKey(id), enabled: !!id } });
  const auditParams = { schoolId: id, limit: 8 };
  const lq = useListPlatformAudit(auditParams, { query: { queryKey: getListPlatformAuditQueryKey(auditParams), enabled: !!id } });
  const [editing, setEditing] = useState<"profile" | "subscription" | null>(null);
  const [entering, setEntering] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [reviewing, setReviewing] = useState<"approve" | "reject" | null>(null);
  const s = sq.data;

  if (sq.isLoading) return <div className="space-y-6"><div className="h-16 animate-pulse rounded bg-muted" /><Panel><SkeletonRows rows={4} /></Panel></div>;
  if (sq.isError || !s) return <ErrorState msg={errMsg(sq.error, "School not found.")} onRetry={() => sq.refetch()} />;
  const inReview = s.status === "pending" || s.status === "rejected";
  const activeAdmins = aq.data?.filter((a) => a.isActive).length ?? 0;

  return (
    <div className="space-y-6">
      <Link href="/schools" data-testid="link-back-schools" className="max-md:hidden inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />All schools</Link>
      <PageHeader eyebrow={`School · ${s.code}`} title={s.name} meta={<span className="flex items-center gap-2"><Pill tone={s.status === "active" ? "active" : s.status === "pending" ? "duplicate" : "error"}>{s.status === "pending" ? "pending review" : s.status}</Pill>Registered {fmtDate(s.createdAt)}</span>}>
        {inReview ? (s.status === "pending" ? <>
          <Btn variant="danger" data-testid="button-reject-registration" onClick={() => setReviewing("reject")}>Reject</Btn>
          <Btn data-testid="button-approve-registration" onClick={() => setReviewing("approve")}><ClipboardCheck className="h-4 w-4" />Approve</Btn>
        </> : <Btn data-testid="button-approve-registration" onClick={() => setReviewing("approve")}><ClipboardCheck className="h-4 w-4" />Reconsider and approve</Btn>) : <>
        <Btn variant="outline" data-testid="button-edit-school" onClick={() => setEditing("profile")}><Pencil className="h-4 w-4" />Edit profile</Btn>
        <Btn variant="outline" data-testid="button-enter-school" disabled={s.status !== "active"} title={s.status !== "active" ? "Support access is unavailable while the school is suspended" : "Open an audited support session"} onClick={() => setEntering(true)}><DoorOpen className="h-4 w-4" />Support session</Btn></>}
      </PageHeader>

      <RegistrationReviewDialog school={s} open={!!reviewing} initial={reviewing ?? "approve"} onOpenChange={(o) => { if (!o) setReviewing(null); }} />
      {inReview && <div data-testid="banner-registration" className={s.status === "pending" ? "rounded-md border border-amber-600/35 bg-amber-500/10 px-4 py-3 text-sm" : "rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"}>
        <span className="font-semibold">{s.status === "pending" ? "Self-registered school awaiting review." : "Registration rejected."}</span> {s.status === "pending" ? "Editing and support access open after approval." : `Reason: ${s.registrationNote || "none recorded"}. You can still approve it.`}
      </div>}
      <FormDialog open={!!editing && !inReview} onOpenChange={(o) => !o && setEditing(null)} size="lg" title={editing === "subscription" ? "Edit subscription" : `Edit ${s.name}`} description={editing === "subscription" ? "Plan, status and renewal dates." : "Profile, contact and access status."}>
        {editing && <SchoolEditForm key={editing + s.id} section={editing} school={s} onDone={() => setEditing(null)} />}
      </FormDialog>
      <EnterSchoolDialog school={s} open={entering && s.status === "active"} onOpenChange={setEntering} />
      <FormDialog open={dlg?.kind === "add"} onOpenChange={(o) => !o && setDlg(null)} title="Add school administrator" description={`New administrator for ${s.name}.`}>
        <AdminForm schoolId={s.id} onDone={() => setDlg(null)} />
      </FormDialog>
      <FormDialog open={dlg?.kind === "edit"} onOpenChange={(o) => !o && setDlg(null)} title={`Edit ${dlg && dlg.kind !== "add" ? dlg.admin.name : "administrator"}`}>
        {dlg?.kind === "edit" && <AdminForm schoolId={s.id} admin={dlg.admin} onDone={() => setDlg(null)} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "status"} onOpenChange={(o) => !o && setDlg(null)} size="sm" title={dlg?.kind === "status" ? `${dlg.admin.isActive ? "Disable" : "Enable"} ${dlg.admin.name}` : "Change status"}>
        {dlg?.kind === "status" && <AdminStatusForm schoolId={s.id} admin={dlg.admin} onDone={() => setDlg(null)} />}
      </FormDialog>
      <FormDialog open={dlg?.kind === "reset"} onOpenChange={(o) => !o && setDlg(null)} title={dlg?.kind === "reset" ? `Reset password for ${dlg.admin.name}` : "Reset password"}>
        {dlg?.kind === "reset" && <ResetPasswordForm schoolId={s.id} admin={dlg.admin} onDone={() => setDlg(null)} />}
      </FormDialog>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <BillingPanel school={s} />
          <Panel title="School administrators" note={aq.data ? `${activeAdmins} active of ${aq.data.length}. The last active administrator is protected.` : undefined}
            action={<Btn className="h-8" data-testid="button-add-admin" onClick={() => setDlg({ kind: "add" })}><Plus className="h-4 w-4" />Add</Btn>}>
            {aq.isLoading ? <SkeletonRows rows={3} cols={3} /> : aq.isError ? <ErrorState msg={errMsg(aq.error)} onRetry={() => aq.refetch()} /> : !aq.data?.length ? (
              <Empty icon={<UserCog className="h-5 w-5" />} title="No administrators" body="Add a school administrator so the school can sign in." />
            ) : (
              <ul className="divide-y divide-border/60">{aq.data.map((a) => (
                <li key={a.id} data-testid={`row-admin-${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initials(a.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 break-words text-sm font-semibold">{a.name}<Pill tone={a.isActive ? "active" : "inactive"}>{a.isActive ? "active" : "disabled"}</Pill></div>
                    <div className="truncate text-xs text-muted-foreground">{[a.email, a.phone].filter(Boolean).join(" · ") || "No contact"} · Last sign-in {fmtDateTime(a.lastLoginAt)}</div>
                  </div>
                  <div className="flex w-full flex-wrap gap-1 sm:w-auto">
                    <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid={`button-edit-admin-${a.id}`} onClick={() => setDlg({ kind: "edit", admin: a })}><Pencil className="h-3.5 w-3.5" />Edit</Btn>
                    <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid={`button-reset-admin-${a.id}`} onClick={() => setDlg({ kind: "reset", admin: a })}><KeyRound className="h-3.5 w-3.5" />Reset</Btn>
                    <Btn variant={a.isActive ? "danger" : "outline"} className="h-8 px-2.5 text-xs" data-testid={`button-status-admin-${a.id}`} onClick={() => setDlg({ kind: "status", admin: a })}><Power className="h-3.5 w-3.5" />{a.isActive ? "Disable" : "Enable"}</Btn>
                  </div>
                </li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Recent platform actions" note="Latest audited actions on this school." action={<Link href={`/platform/audit?school=${s.id}`} className="text-xs font-semibold text-primary hover:underline" data-testid="link-school-audit">Full log</Link>}>
            {lq.isLoading ? <SkeletonRows rows={3} cols={3} /> : lq.isError ? <ErrorState msg={errMsg(lq.error)} onRetry={() => lq.refetch()} /> : !lq.data?.length ? (
              <Empty icon={<ScrollText className="h-5 w-5" />} title="No platform actions yet" body="Provisioning, edits and support sessions appear here." />
            ) : (
              <ul className="divide-y divide-border/60">{lq.data.map((e) => (
                <li key={e.id} className="px-5 py-2.5 text-sm"><div className="flex justify-between gap-3"><span className="font-mono text-xs font-semibold">{e.action}</span><span className="font-mono text-[11px] text-muted-foreground">{fmtDateTime(e.createdAt)}</span></div><p className="truncate text-xs text-muted-foreground">{e.reason}</p></li>
              ))}</ul>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-6">
          <Panel title="Profile" action={!inReview ? <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid="button-edit-profile" onClick={() => setEditing("profile")}><Pencil className="h-3.5 w-3.5" />Edit</Btn> : undefined}>
            <dl className="grid grid-cols-2 gap-4 p-5">
              <Fact k="Access" v={<Pill tone={s.status === "active" ? "active" : s.status === "pending" ? "duplicate" : "error"}>{s.status === "pending" ? "pending review" : s.status}</Pill>} />
              <Fact k="Registered" v={fmtDate(s.createdAt)} />
              <Fact k="County" v={s.county ?? "\u2014"} />
              <Fact k="Level" v={s.type} />
              <div className="col-span-2"><Fact k="Email" v={<span className="normal-case break-all">{s.email || "\u2014"}</span>} /></div>
              <Fact k="Phone" v={<span className="normal-case">{s.phone || "\u2014"}</span>} />
              <Fact k="Code" v={<span className="font-mono normal-case">{s.code}</span>} />
              <div className="col-span-2"><Fact k="Address" v={<span className="normal-case">{s.address || "\u2014"}</span>} /></div>
            </dl>
          </Panel>
          <Panel title="Subscription" action={!inReview ? <Btn variant="ghost" className="h-8 px-2.5 text-xs" data-testid="button-edit-subscription" onClick={() => setEditing("subscription")}><CalendarClock className="h-3.5 w-3.5" />Change</Btn> : undefined}>
            <dl className="grid grid-cols-2 gap-4 p-5">
              <Fact k="Plan" v={s.subscriptionPlan || "\u2014"} />
              <Fact k="Status" v={s.subscriptionStatus ? <Pill tone={s.subscriptionStatus === "active" ? "active" : s.subscriptionStatus === "trial" ? "duplicate" : "error"}>{s.subscriptionStatus}</Pill> : "\u2014"} />
              <Fact k="Starts" v={fmtDate(s.subscriptionStartDate)} />
              <Fact k="Renews" v={fmtDate(s.subscriptionEndDate)} />
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
