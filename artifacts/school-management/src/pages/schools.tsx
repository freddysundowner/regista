import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListSchools, useCreateSchool, useUpdatePlatformSchool, getListSchoolsQueryKey, getGetCurrentUserQueryKey, getGetSchoolQueryKey, SchoolType, PlatformSchoolUpdateStatus, PlatformSchoolUpdateSubscriptionStatus, type School } from "@workspace/api-client-react";
import { Building2, KeyRound, Loader2, Pencil, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { COUNTIES } from "@/pages/auth";
import { useSession, errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const EMPTY = { schoolName: "", schoolCode: "", county: "", schoolType: "primary" as SchoolType, adminName: "", email: "", phone: "", password: "" };

function ProvisionForm({ onDone }: { onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const m = useCreateSchool();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("The school administrator needs an email or phone to sign in.");
    if (f.password.length < 10) return setErr("Initial password must be at least 10 characters.");
    m.mutate({ data: { schoolName: f.schoolName.trim(), schoolCode: f.schoolCode.trim().toUpperCase(), county: f.county || undefined, schoolType: f.schoolType, adminName: f.adminName.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, password: f.password } }, {
      onSuccess: (s) => { qc.invalidateQueries({ queryKey: getListSchoolsQueryKey() }); onDone(`${s.name} provisioned. ${f.adminName.trim()} signs in with ${f.email.trim() || f.phone.trim()}.`); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School name" required className="sm:col-span-2"><TextInput data-testid="input-new-school-name" required minLength={2} value={f.schoolName} onChange={set("schoolName")} /></Field>
        <Field label="School code" required><TextInput data-testid="input-new-school-code" required minLength={2} className="font-mono uppercase" value={f.schoolCode} onChange={set("schoolCode")} /></Field>
        <Field label="Level"><NativeSelect data-testid="select-new-school-type" value={f.schoolType} onChange={set("schoolType")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="County"><NativeSelect data-testid="select-new-county" value={f.county} onChange={set("county")}><option value="">Select county</option>{COUNTIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
      </div>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>Initial school administrator</span><span className="h-px flex-1 bg-border" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required><TextInput data-testid="input-new-admin-name" required minLength={2} value={f.adminName} onChange={set("adminName")} /></Field>
        <Field label="Email" hint="Email or phone required"><TextInput data-testid="input-new-admin-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-new-admin-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Initial password" required hint="Share privately; at least 10 characters"><TextInput data-testid="input-new-admin-password" type="password" required value={f.password} onChange={set("password")} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-provision-school" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Provision school</Btn>
        <Btn type="button" variant="ghost" onClick={() => onDone("")}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function SubscriptionForm({ school, isMine, onDone }: { school: School; isMine: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdatePlatformSchool();
  const [f, setF] = useState({ status: school.status as string, plan: school.subscriptionPlan ?? "", subStatus: (school.subscriptionStatus ?? "trial") as string, start: school.subscriptionStartDate?.slice(0, 10) ?? "", end: school.subscriptionEndDate?.slice(0, 10) ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (isMine && f.status === "suspended") return setErr("You cannot suspend the school your own session is bound to.");
    if (!f.plan.trim()) return setErr("Enter a plan name.");
    if (f.start && f.end && f.end < f.start) return setErr("End date must be on or after the start date.");
    m.mutate({ schoolId: school.id, data: { status: f.status as PlatformSchoolUpdateStatus, subscriptionPlan: f.plan.trim(), subscriptionStatus: f.subStatus as PlatformSchoolUpdateSubscriptionStatus, subscriptionStartDate: f.start || null, subscriptionEndDate: f.end || null } }, {
      onSuccess: (s) => { qc.invalidateQueries({ queryKey: getListSchoolsQueryKey() }); if (isMine) { qc.invalidateQueries({ queryKey: getGetSchoolQueryKey() }); qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); } toast({ title: `${s.name} updated` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School status" className="sm:col-span-2"><NativeSelect data-testid="select-school-status" value={f.status} onChange={set("status")}>{Object.values(PlatformSchoolUpdateStatus).map((v) => <option key={v} value={v} disabled={isMine && v === "suspended"}>{v[0].toUpperCase() + v.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="Plan" required><TextInput data-testid="input-subscription-plan" required maxLength={80} value={f.plan} onChange={set("plan")} placeholder="Standard" /></Field>
        <Field label="Subscription"><NativeSelect data-testid="select-subscription-status" value={f.subStatus} onChange={set("subStatus")}>{Object.values(PlatformSchoolUpdateSubscriptionStatus).map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="Start date"><TextInput data-testid="input-subscription-start" type="date" value={f.start} onChange={set("start")} /></Field>
        <Field label="End date"><TextInput data-testid="input-subscription-end" type="date" value={f.end} onChange={set("end")} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Operational tracking only; no card billing. Suspending a school blocks its staff from signing in.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-subscription" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save subscription</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export default function Schools() {
  const { school: mine } = useSession();
  const q = useListSchools({ query: { queryKey: getListSchoolsQueryKey() } });
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const editSchool = q.data?.find((s) => s.id === editId);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform owner" title="Schools" meta="Each school is a separate register. Its administrators sign in on their own; there is no switching between schools.">
        {<Btn data-testid="button-new-school" onClick={() => { setCreating(true); setNotice(null); }}><Plus className="h-4 w-4" /> Provision school</Btn>}
      </PageHeader>
      {notice && <div data-testid="text-provision-notice" className="rise flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm"><KeyRound className="mt-0.5 h-4 w-4 text-primary" />{notice}</div>}
      <FormDialog open={creating} onOpenChange={setCreating} size="lg" title="Provision a new school" description="Creates the school and its first school administrator.">
        <ProvisionForm onDone={(msg) => { setCreating(false); if (msg) { setNotice(msg); toast({ title: "School provisioned" }); } }} />
      </FormDialog>
      <FormDialog open={!!editId} onOpenChange={(o) => { if (!o) setEditId(null); }} title={`Status and subscription${editSchool ? `: ${editSchool.name}` : ""}`} description="Operational tracking only; no card billing.">
        {editSchool && <SubscriptionForm key={editSchool.id} school={editSchool} isMine={editSchool.id === mine.id} onDone={() => setEditId(null)} />}
      </FormDialog>
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Building2 className="h-5 w-5" />} title="No schools listed" body="Provisioned schools appear here." /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">School</th><th className="px-3 py-2.5">Code</th><th className="hidden px-3 py-2.5 md:table-cell">County · level</th><th className="hidden px-3 py-2.5 md:table-cell">Registered</th><th className="px-3 py-2.5">Subscription</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{q.data.map((s) => (
              <tr key={s.id} data-testid={`row-school-${s.id}`} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                <td className="px-5 py-3"><span className="font-semibold">{s.name}</span>{s.id === mine.id && <span className="ml-2 text-xs text-muted-foreground">(your school)</span>}{s.email && <div className="text-[11px] text-muted-foreground">{s.email}</div>}</td>
                <td className="px-3 py-3 font-mono text-xs">{s.code}</td>
                <td className="hidden px-3 py-3 capitalize md:table-cell">{s.county ?? "—"} · {s.type}</td>
                <td className="hidden px-3 py-3 font-mono text-xs text-muted-foreground md:table-cell">{fmtDate(s.createdAt)}</td>
                <td className="px-3 py-3 text-xs"><div className="font-semibold">{s.subscriptionPlan || "\u2014"}</div><div className="capitalize text-muted-foreground">{s.subscriptionStatus ?? "\u2014"}{s.subscriptionEndDate && ` · to ${fmtDate(s.subscriptionEndDate)}`}</div></td>
                <td className="px-3 py-3"><Pill tone={s.status === "active" ? "active" : "error"}>{s.status}</Pill></td>
                <td className="px-3 py-3"><button data-testid={`button-edit-school-${s.id}`} aria-label={`Edit status and subscription for ${s.name}`} onClick={() => setEditId(s.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button></td>
              </tr>
              ))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
