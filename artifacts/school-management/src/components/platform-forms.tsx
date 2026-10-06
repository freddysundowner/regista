import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProvisionPlatformSchool, useEditPlatformSchool, useCreatePlatformAdmin, useEditPlatformAdmin, useResetPlatformAdminPassword,
  getListPlatformSchoolsQueryKey, getGetPlatformSchoolQueryKey, getGetPlatformOverviewQueryKey, getListPlatformAdminsQueryKey, getListPlatformAuditQueryKey,
  SchoolType, PlatformSchoolUpdateStatus, PlatformSchoolUpdateSubscriptionStatus, type School, type User,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Field, TextInput, NativeSelect, FormError, FormActions, Btn } from "@/components/kit";
import { platformAction } from "@/components/platform-kit";
import { COUNTIES } from "@/pages/auth";
import { errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function useRefreshPlatform() {
  const qc = useQueryClient();
  return (schoolId?: string) => {
    qc.invalidateQueries({ queryKey: getListPlatformSchoolsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey() });
    qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey().slice(0, 1) });
    if (schoolId) {
      qc.invalidateQueries({ queryKey: getGetPlatformSchoolQueryKey(schoolId) });
      qc.invalidateQueries({ queryKey: getListPlatformAdminsQueryKey(schoolId) });
    }
  };
}

function Divider({ children }: { children: string }) {
  return <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>{children}</span><span className="h-px flex-1 bg-border" /></div>;
}

const EMPTY = { schoolName: "", schoolCode: "", county: "", schoolType: "primary" as SchoolType, adminName: "", email: "", phone: "", password: "" };

export function ProvisionForm({ onDone, onCancel }: { onDone: (s: School, signIn: string) => void; onCancel: () => void }) {
  const refresh = useRefreshPlatform();
  const m = useProvisionPlatformSchool();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("The school administrator needs an email or phone to sign in.");
    if (f.password.length < 10 || f.password.length > 128) return setErr("Initial password must be 10 to 128 characters.");
    const signIn = f.email.trim() || f.phone.trim();
    // Submitting Provision school confirms creation; retain the API audit metadata
    // without asking the user to repeat the action in a separate confirmation section.
    m.mutate({ data: { schoolName: f.schoolName.trim(), schoolCode: f.schoolCode.trim().toUpperCase(), county: f.county || undefined, schoolType: f.schoolType, adminName: f.adminName.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, password: f.password, reason: "New school provisioning from the platform console", confirmation: "CONFIRM" } }, {
      onSuccess: (s) => { setF(EMPTY); refresh(s.id); onDone(s, signIn); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School name" required className="sm:col-span-2"><TextInput data-testid="input-new-school-name" required minLength={2} maxLength={180} value={f.schoolName} onChange={set("schoolName")} /></Field>
        <Field label="School code" required hint="Unique; cannot be changed later"><TextInput data-testid="input-new-school-code" required minLength={2} maxLength={40} className="font-mono uppercase" value={f.schoolCode} onChange={set("schoolCode")} /></Field>
        <Field label="Level"><NativeSelect data-testid="select-new-school-type" value={f.schoolType} onChange={set("schoolType")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{cap(t)}</option>)}</NativeSelect></Field>
        <Field label="County"><NativeSelect data-testid="select-new-county" value={f.county} onChange={set("county")}><option value="">Select county</option>{COUNTIES.map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
      </div>
      <Divider>Initial school administrator</Divider>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required><TextInput data-testid="input-new-admin-name" required minLength={2} value={f.adminName} onChange={set("adminName")} /></Field>
        <Field label="Email" hint="Email or phone required"><TextInput data-testid="input-new-admin-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-new-admin-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Initial password" required hint="Share privately; 10 to 128 characters"><TextInput data-testid="input-new-admin-password" type="password" autoComplete="new-password" required value={f.password} onChange={set("password")} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-provision-school" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Provision school</Btn>
        <Btn type="button" variant="ghost" onClick={onCancel}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export function SchoolEditForm({ school, onDone, section = "profile" }: { school: School; onDone: () => void; section?: "profile" | "subscription" }) {
  const refresh = useRefreshPlatform();
  const { toast } = useToast();
  const m = useEditPlatformSchool();
  const [f, setF] = useState({ name: school.name, county: school.county ?? "", type: school.type as string, status: school.status as string, address: school.address ?? "", phone: school.phone ?? "", email: school.email ?? "", plan: school.subscriptionPlan ?? "", subStatus: (school.subscriptionStatus ?? "trial") as string, start: school.subscriptionStartDate?.slice(0, 10) ?? "", end: school.subscriptionEndDate?.slice(0, 10) ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const profile = section === "profile";
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (profile) {
      if (f.name.trim().length < 2) return setErr("School name needs at least 2 characters.");
      if (f.address.trim().length > 250) return setErr("Address must be 250 characters or fewer.");
      if (f.phone.trim().length > 20) return setErr("Phone must be 20 characters or fewer.");
      if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr("Enter a valid email address.");
    } else {
      if (!f.plan.trim()) return setErr("Enter a plan name.");
      if (f.start && f.end && f.end < f.start) return setErr("End date must be on or after the start date.");
    }
    const data = profile
      ? { name: f.name.trim(), county: f.county || null, type: f.type as SchoolType, status: f.status as PlatformSchoolUpdateStatus, address: f.address.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null }
      : { subscriptionPlan: f.plan.trim(), subscriptionStatus: f.subStatus as PlatformSchoolUpdateSubscriptionStatus, subscriptionStartDate: f.start || null, subscriptionEndDate: f.end || null };
    m.mutate({ schoolId: school.id, data: { ...data, ...platformAction(profile ? "School profile updated from platform console" : "School subscription updated from platform console") } }, {
      onSuccess: (s) => { refresh(s.id); toast({ title: profile ? `${s.name} updated` : "Subscription updated" }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      {profile ? <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="School name" required className="sm:col-span-2"><TextInput data-testid="input-school-name" required minLength={2} maxLength={180} value={f.name} onChange={set("name")} /></Field>
          <Field label="County"><NativeSelect data-testid="select-school-county" value={f.county} onChange={set("county")}><option value="">Not set</option>{COUNTIES.map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
          <Field label="Level"><NativeSelect data-testid="select-school-type" value={f.type} onChange={set("type")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{cap(t)}</option>)}</NativeSelect></Field>
        </div>
        <Divider>Contact</Divider>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email"><TextInput data-testid="input-school-email" type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><TextInput data-testid="input-school-phone" type="tel" maxLength={20} value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Address" className="sm:col-span-2"><TextInput data-testid="input-school-address" maxLength={250} value={f.address} onChange={set("address")} /></Field>
        </div>
        <Divider>Access</Divider>
        <Field label="School status" hint="Suspending blocks the school's staff from signing in."><NativeSelect data-testid="select-school-status" value={f.status} onChange={set("status")}>{Object.values(PlatformSchoolUpdateStatus).map((v) => <option key={v} value={v}>{cap(v)}</option>)}</NativeSelect></Field>
      </> : <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan" required><TextInput data-testid="input-subscription-plan" required maxLength={80} value={f.plan} onChange={set("plan")} placeholder="Standard" /></Field>
          <Field label="Subscription"><NativeSelect data-testid="select-subscription-status" value={f.subStatus} onChange={set("subStatus")}>{Object.values(PlatformSchoolUpdateSubscriptionStatus).map((v) => <option key={v} value={v}>{cap(v)}</option>)}</NativeSelect></Field>
          <Field label="Start date"><TextInput data-testid="input-subscription-start" type="date" value={f.start} onChange={set("start")} /></Field>
          <Field label="End date" hint="Renewal due on this date"><TextInput data-testid="input-subscription-end" type="date" value={f.end} onChange={set("end")} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">These are legacy reference fields. For licence-managed schools, access is controlled by timed licences and paid licence-renewal invoices, not these fields.</p>
      </>}
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-school" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{profile ? "Save profile" : "Save subscription"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export function AdminForm({ schoolId, admin, onDone }: { schoolId: string; admin?: User; onDone: () => void }) {
  const refresh = useRefreshPlatform();
  const { toast } = useToast();
  const create = useCreatePlatformAdmin();
  const edit = useEditPlatformAdmin();
  const [f, setF] = useState({ name: admin?.name ?? "", email: admin?.email ?? "", phone: admin?.phone ?? "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pending = create.isPending || edit.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.name.trim().length < 2) return setErr("Name needs at least 2 characters.");
    if (!f.email.trim() && !f.phone.trim()) return setErr("An email or phone is needed to sign in.");
    if (!admin && (f.password.length < 10 || f.password.length > 128)) return setErr("Initial password must be 10 to 128 characters.");
    const base = { name: f.name.trim(), email: f.email.trim() || null, phone: f.phone.trim() || null, ...platformAction(admin ? "Administrator details updated from platform console" : "Administrator added from platform console") };
    const ok = (u: User) => { refresh(schoolId); toast({ title: admin ? `${u.name} updated` : `${u.name} added as school administrator` }); onDone(); };
    if (admin) edit.mutate({ schoolId, userId: admin.id, data: base }, { onSuccess: ok, onError: (x) => setErr(errMsg(x)) });
    else create.mutate({ schoolId, data: { ...base, password: f.password } }, { onSuccess: ok, onError: (x) => setErr(errMsg(x)) });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2"><TextInput data-testid="input-admin-name" required minLength={2} maxLength={160} value={f.name} onChange={set("name")} /></Field>
        <Field label="Email" hint="Email or phone required"><TextInput data-testid="input-admin-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-admin-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        {!admin && <Field label="Initial password" required className="sm:col-span-2" hint="10 to 128 characters; share privately"><TextInput data-testid="input-admin-password" type="password" autoComplete="new-password" required value={f.password} onChange={set("password")} /></Field>}
      </div>
      <p className="text-xs text-muted-foreground">Role is fixed to school administrator.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-admin" type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{admin ? "Save administrator" : "Add administrator"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export function AdminStatusForm({ schoolId, admin, onDone }: { schoolId: string; admin: User; onDone: () => void }) {
  const refresh = useRefreshPlatform();
  const { toast } = useToast();
  const m = useEditPlatformAdmin();
  const [err, setErr] = useState<string | null>(null);
  const next = !admin.isActive;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ schoolId, userId: admin.id, data: { isActive: next, ...platformAction(`Administrator ${next ? "enabled" : "disabled"} from platform console`) } }, {
      onSuccess: (u) => { refresh(schoolId); toast({ title: `${u.name} ${u.isActive ? "enabled" : "disabled"}` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <p className="text-sm">{next ? `${admin.name} will be able to sign in again.` : `${admin.name} will be signed out and blocked from signing in. The last active administrator of a school cannot be disabled.`}</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-admin-status" type="submit" variant={next ? "primary" : "danger"} disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{next ? "Enable administrator" : "Disable administrator"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export function ResetPasswordForm({ schoolId, admin, onDone }: { schoolId: string; admin: User; onDone: () => void }) {
  const refresh = useRefreshPlatform();
  const { toast } = useToast();
  const m = useResetPlatformAdminPassword();
  const [pw, setPw] = useState({ next: "", again: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw.next.length < 10 || pw.next.length > 128) return setErr("Password must be 10 to 128 characters.");
    if (pw.next !== pw.again) return setErr("Passwords do not match.");
    m.mutate({ schoolId, userId: admin.id, data: { password: pw.next, ...platformAction("Administrator password reset from platform console") } }, {
      onSuccess: (r) => { setPw({ next: "", again: "" }); refresh(schoolId); toast({ title: "Password reset", description: r.message || `Share the new password with ${admin.name} privately.` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" required hint="10 to 128 characters"><TextInput data-testid="input-reset-password" type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Repeat password" required><TextInput data-testid="input-reset-password-again" type="password" autoComplete="new-password" required value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">The password is sent once over the encrypted connection and never shown or logged. {admin.name}'s other sessions may be signed out.</p>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-confirm-reset" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Reset password</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}
