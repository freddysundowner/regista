import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Pager, usePaged } from "@/components/pager";
import { useQueryClient } from "@tanstack/react-query";
import { useListUsers, useCreateUser, useUpdateUser, useResetStaffPassword, getListUsersQueryKey, getGetDashboardSummaryQueryKey, UserRole, StaffPermission, type User } from "@workspace/api-client-react";
import { KeyRound, Loader2, Pencil, Plus, Search, UserCog } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill, Fab, Filters, CardTable } from "@/components/kit";
import { useSession, ROLE_LABEL, ROLE_ACCESS, ACCESS_LABEL, errMsg, blank, initials, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const ROLES = Object.values(UserRole).filter((r) => r !== "super_admin");
const ACCESS = Object.values(StaffPermission);
export const ROLE_HINT: Record<string, string> = {
  school_admin: "Everything, including staff, settings and money.",
  principal: "Sees learners, money and reports; approves fee changes and LPOs.",
  bursar: "Fees, payments, expenses and purchasing.",
  teacher: "Marks and attendance for the classes they teach.",
  class_teacher: "Like a teacher, plus their own class register.",
  storekeeper: "Only the store: stock in, stock out, stock counts.",
  librarian: "Only the library: books, lending and returns.",
};

/** What a person can do beyond their role, ticked one by one. */
function AccessPicker({ role, value, onChange }: { role: UserRole; value: StaffPermission[]; onChange: (v: StaffPermission[]) => void }) {
  const own = new Set(ROLE_ACCESS[role]);
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium">Extra access</legend>
      <p className="text-xs text-muted-foreground">On top of the role. E.g. a teacher who also runs the library, or a bursar who keeps the store.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ACCESS.map((a) => {
          const fromRole = own.has(a);
          return (
            <label key={a} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${fromRole ? "border-border/60 bg-muted/40 text-muted-foreground" : "border-border"}`} data-testid={`access-${a}`}>
              <input type="checkbox" className="mt-0.5" disabled={fromRole} checked={fromRole || value.includes(a)} onChange={(e) => onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))} />
              <span><span className="font-medium text-foreground">{ACCESS_LABEL[a].label}</span>{fromRole && <span className="text-xs"> · comes with the role</span>}<span className="block text-xs text-muted-foreground">{ACCESS_LABEL[a].hint}</span></span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Short list of what someone can do outside their role's usual work. */
export function accessSummary(u: Pick<User, "role" | "permissions">) {
  return (u.permissions ?? []).filter((a) => !ROLE_ACCESS[u.role].includes(a)).map((a) => ACCESS_LABEL[a].label);
}

export function StaffForm({ user, onDone }: { user?: User; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateUser();
  const upd = useUpdateUser();
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", role: user?.role ?? ("teacher" as UserRole), password: "" });
  const [extra, setExtra] = useState<StaffPermission[]>(user?.permissions ?? []);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = (msg: string) => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast({ title: msg }); onDone(); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("Add an email or phone number — staff sign in with one of them.");
    const base = { name: f.name.trim(), email: blank(f.email), phone: blank(f.phone), role: f.role, permissions: extra.filter((a) => !ROLE_ACCESS[f.role].includes(a)) };
    if (user) upd.mutate({ userId: user.id, data: base }, { onSuccess: () => ok("Staff updated"), onError: (x) => setErr(errMsg(x)) });
    else {
      if (f.password.length < 6) return setErr("Temporary password must be at least 6 characters.");
      create.mutate({ data: { ...base, password: f.password } }, { onSuccess: () => ok("Staff account created"), onError: (x) => setErr(errMsg(x)) });
    }
  };
  const pending = create.isPending || upd.isPending;
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2"><TextInput data-testid="input-staff-name" required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="Email" hint="Email or phone required"><TextInput data-testid="input-staff-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-staff-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Role" required hint={ROLE_HINT[f.role]}><NativeSelect data-testid="select-staff-role" value={f.role} onChange={set("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect></Field>
        {!user && <Field label="Temporary password" required hint="Share privately; at least 6 characters"><TextInput data-testid="input-staff-password" type="password" required value={f.password} onChange={set("password")} /></Field>}
        {f.role !== "school_admin" && <AccessPicker role={f.role} value={extra} onChange={setExtra} />}
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-staff" type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{user ? "Save changes" : "Create account"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

/** For someone who is locked out: the administrator sets a new temporary password and shares it privately. */
function ResetPasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { toast } = useToast();
  const m = useResetStaffPassword();
  const [pw, setPw] = useState({ next: "", again: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw.next.length < 6) return setErr("Temporary password must be at least 6 characters.");
    if (pw.next !== pw.again) return setErr("The two passwords don't match.");
    m.mutate({ userId: user.id, data: { password: pw.next } }, { onSuccess: () => { toast({ title: `Password reset for ${user.name}`, description: "They have been signed out everywhere." }); onDone(); }, onError: (x) => setErr(errMsg(x)) });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New temporary password" required hint="Share privately; at least 6 characters"><TextInput data-testid="input-reset-staff-password" type="password" required autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Repeat password" required><TextInput data-testid="input-reset-staff-password-again" type="password" required autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-reset-staff" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Reset password</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

/** `embedded` shows only the staff list and an add button, for the setup flow. */
export default function Staff({ embedded = false }: { embedded?: boolean } = {}) {
  const me = useSession().user;
  const q = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const [term, setTerm] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const needle = term.trim().toLowerCase();
  const filtered = (q.data ?? []).filter((u) => (!role || u.role === role) && (!status || (status === "active") === u.isActive)
    && (!needle || [u.name, u.email, u.phone, ROLE_LABEL[u.role]].some((v) => v?.toLowerCase().includes(needle))));
  const { rows, pager } = usePaged(filtered, [term, role, status]);
  const upd = useUpdateUser();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | User | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);

  const toggle = (u: User) => upd.mutate({ userId: u.id, data: { isActive: !u.isActive } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast({ title: u.isActive ? `${u.name} deactivated` : `${u.name} reactivated` }); setConfirmId(null); },
    onError: (x) => toast({ title: "Could not update", description: errMsg(x), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      {embedded ? <Btn data-testid="button-new-staff" onClick={() => setMode("new")}><Plus className="h-4 w-4" /> Add staff</Btn> : (
        <PageHeader eyebrow="Accounts & roles" title="Staff" meta="A role decides what each person can see and change; extra access adds store, library or purchasing work to anyone.">
          {<Btn data-testid="button-new-staff" className="max-md:hidden" onClick={() => setMode("new")}><Plus className="h-4 w-4" /> Add staff</Btn>}
        </PageHeader>
      )}
      <FormDialog phonePage open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }} title={mode === "new" ? "Add a staff account" : mode ? `Edit ${mode.name}` : "Staff"} description={mode === "new" ? "They sign in with the email or phone you enter here." : "Role changes take effect on their next request."}>
        {mode && <StaffForm key={mode === "new" ? "new" : mode.id} user={mode === "new" ? undefined : mode} onDone={() => setMode(null)} />}
      </FormDialog>
      <FormDialog open={!!resetFor} onOpenChange={(o) => { if (!o) setResetFor(null); }} title={resetFor ? `Reset ${resetFor.name}'s password` : "Reset password"} description="Use this when someone has forgotten their password. They are signed out and sign in with the new one.">
        {resetFor && <ResetPasswordForm key={resetFor.id} user={resetFor} onDone={() => setResetFor(null)} />}
      </FormDialog>
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<UserCog className="h-5 w-5" />} title="Only you so far" body="Add the principal, bursar, teachers, storekeeper and librarian so they can sign in." /> : (<>
          <div className="border-b border-border/60 px-4 py-3 sm:px-5">
            <Filters active={(role ? 1 : 0) + (status ? 1 : 0)} onClear={() => { setRole(""); setStatus(""); }} lead={<div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input data-testid="input-staff-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, email, phone or role"
                className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 max-md:h-11 max-md:text-base" />
            </div>}>
              <NativeSelect data-testid="filter-staff-role" value={role} onChange={(e) => setRole(e.target.value)} className="md:w-40"><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect>
              <NativeSelect data-testid="filter-staff-status" value={status} onChange={(e) => setStatus(e.target.value)} className="md:w-36"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></NativeSelect>
            </Filters>
          </div>
          {!filtered.length ? <p className="px-5 py-4 text-sm text-muted-foreground">No staff match these filters.</p> : (
            <CardTable>
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-5 py-2.5 font-medium">Name</th><th className="px-3 py-2.5 font-medium">Contact</th><th className="px-3 py-2.5 font-medium">Role</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Last sign-in</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">{rows.map((u) => (
                  <tr key={u.id} data-testid={`row-staff-${u.id}`} className={u.isActive ? "" : "opacity-60"}>
                    <td className="px-5 py-2.5"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(u.name)}</span><Link href={`/staff/${u.id}`} className="font-medium hover:underline" data-testid={`link-staff-${u.id}`}>{u.name}</Link>{u.id === me.id && <span className="text-xs font-normal text-muted-foreground">(you)</span>}</div></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground"><div>{u.email ?? ""}</div><div>{u.phone ?? ""}</div></td>
                    <td className="px-3 py-2.5">{ROLE_LABEL[u.role]}{accessSummary(u).length > 0 && <div className="text-[11px] text-muted-foreground">+ {accessSummary(u).join(", ")}</div>}</td>
                    <td className="px-3 py-2.5"><Pill tone={u.isActive ? "active" : "inactive"}>{u.isActive ? "Active" : "Inactive"}</Pill></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button data-testid={`button-edit-staff-${u.id}`} aria-label={`Edit ${u.name}`} onClick={() => setMode(u)} className="rounded p-1.5 text-muted-foreground hover:bg-muted max-md:border max-md:border-border max-md:p-3 hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        {u.id !== me.id && <button data-testid={`button-reset-staff-${u.id}`} aria-label={`Reset ${u.name}'s password`} title="Reset password" onClick={() => setResetFor(u)} className="rounded p-1.5 text-muted-foreground hover:bg-muted max-md:border max-md:border-border max-md:p-3 hover:text-foreground"><KeyRound className="h-3.5 w-3.5" /></button>}
                        {u.id !== me.id && (confirmId === u.id ? (
                          <span className="flex items-center gap-1"><Btn variant={u.isActive ? "danger" : "outline"} className="h-7 px-2 text-xs" disabled={upd.isPending} data-testid={`button-confirm-toggle-${u.id}`} onClick={() => toggle(u)}>{u.isActive ? "Confirm deactivate" : "Confirm reactivate"}</Btn><Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmId(null)}>Keep</Btn></span>
                        ) : <Btn variant="ghost" className="h-7 px-2 text-xs" data-testid={`button-toggle-staff-${u.id}`} onClick={() => setConfirmId(u.id)}>{u.isActive ? "Deactivate" : "Reactivate"}</Btn>)}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </CardTable>
          )}
        </>)}
        <Pager {...pager} />
      </Panel>
      {!embedded && <>
        <Fab testid="fab-new-staff" label="Add staff" icon={<Plus className="h-4 w-4" />} onClick={() => setMode("new")} />
      </>}
    </div>
  );
}
