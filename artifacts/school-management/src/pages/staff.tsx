import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListUsers, useCreateUser, useUpdateUser, getListUsersQueryKey, getGetDashboardSummaryQueryKey, UserRole, type User } from "@workspace/api-client-react";
import { Loader2, Pencil, Plus, UserCog } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { useSession, ROLE_LABEL, errMsg, blank, initials, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { TeacherAssignmentsPanel } from "@/components/teacher-assignments";

const ROLES = Object.values(UserRole).filter((r) => r !== "super_admin");

function StaffForm({ user, onDone }: { user?: User; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateUser();
  const upd = useUpdateUser();
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", role: user?.role ?? ("teacher" as UserRole), password: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = (msg: string) => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast({ title: msg }); onDone(); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("Add an email or phone number — staff sign in with one of them.");
    const base = { name: f.name.trim(), email: blank(f.email), phone: blank(f.phone), role: f.role };
    if (user) upd.mutate({ userId: user.id, data: base }, { onSuccess: () => ok("Staff updated"), onError: (x) => setErr(errMsg(x)) });
    else {
      if (f.password.length < 10) return setErr("Temporary password must be at least 10 characters.");
      create.mutate({ data: { ...base, password: f.password } }, { onSuccess: () => ok("Staff account created"), onError: (x) => setErr(errMsg(x)) });
    }
  };
  const pending = create.isPending || upd.isPending;
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Full name" required className="lg:col-span-2"><TextInput data-testid="input-staff-name" required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="Email" hint="Email or phone required"><TextInput data-testid="input-staff-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-staff-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Role" required><NativeSelect data-testid="select-staff-role" value={f.role} onChange={set("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect></Field>
        {!user && <Field label="Temporary password" required hint="Share privately; at least 10 characters" className="lg:col-span-2"><TextInput data-testid="input-staff-password" type="password" required value={f.password} onChange={set("password")} /></Field>}
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-staff" type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{user ? "Save changes" : "Create account"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export default function Staff() {
  const me = useSession().user;
  const q = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const upd = useUpdateUser();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | User | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const toggle = (u: User) => upd.mutate({ userId: u.id, data: { isActive: !u.isActive } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast({ title: u.isActive ? `${u.name} deactivated` : `${u.name} reactivated` }); setConfirmId(null); },
    onError: (x) => toast({ title: "Could not update", description: errMsg(x), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Accounts & roles" title="Staff" meta="Roles decide what each person can see and change.">
        {!mode && <Btn data-testid="button-new-staff" onClick={() => setMode("new")}><Plus className="h-4 w-4" /> Add staff</Btn>}
      </PageHeader>
      {mode && <Panel title={mode === "new" ? "New staff account" : `Edit ${mode.name}`}><StaffForm key={mode === "new" ? "new" : mode.id} user={mode === "new" ? undefined : mode} onDone={() => setMode(null)} /></Panel>}
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<UserCog className="h-5 w-5" />} title="Only you so far" body="Add the principal, bursar and teachers so they can sign in." /> : (
          <ul className="divide-y divide-border/60">{q.data.map((u) => (
            <li key={u.id} data-testid={`row-staff-${u.id}`} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${u.isActive ? "" : "opacity-60"}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initials(u.name)}</span>
              <div className="min-w-[10rem] flex-1"><div className="font-semibold">{u.name}{u.id === me.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}</div><div className="font-mono text-[11px] text-muted-foreground">{[u.email, u.phone].filter(Boolean).join(" · ")}</div><div className="text-[11px] text-muted-foreground">Last sign-in {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</div></div>
              <span className="w-28 text-sm">{ROLE_LABEL[u.role]}</span>
              <Pill tone={u.isActive ? "active" : "inactive"}>{u.isActive ? "Active" : "Inactive"}</Pill>
              <div className="flex items-center gap-1">
                <button data-testid={`button-edit-staff-${u.id}`} aria-label={`Edit ${u.name}`} onClick={() => setMode(u)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                {u.id !== me.id && (confirmId === u.id ? (
                  <span className="flex items-center gap-1"><Btn variant={u.isActive ? "danger" : "outline"} className="h-7 px-2 text-xs" disabled={upd.isPending} data-testid={`button-confirm-toggle-${u.id}`} onClick={() => toggle(u)}>{u.isActive ? "Confirm deactivate" : "Confirm reactivate"}</Btn><Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmId(null)}>Keep</Btn></span>
                ) : <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-toggle-staff-${u.id}`} onClick={() => setConfirmId(u.id)}>{u.isActive ? "Deactivate" : "Reactivate"}</Btn>)}
              </div>
            </li>))}</ul>
        )}
      </Panel>
      <TeacherAssignmentsPanel />
    </div>
  );
}
