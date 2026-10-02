import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateInitialSchool, useLogin, getGetCurrentUserQueryKey, getGetSetupStatusQueryKey, SchoolType, type AuthSession } from "@workspace/api-client-react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Field, TextInput, NativeSelect, FormError, Btn } from "@/components/kit";
import { errMsg } from "@/lib/session";

export const COUNTIES = ["Baringo","Bomet","Bungoma","Busia","Elgeyo-Marakwet","Embu","Garissa","Homa Bay","Isiolo","Kajiado","Kakamega","Kericho","Kiambu","Kilifi","Kirinyaga","Kisii","Kisumu","Kitui","Kwale","Laikipia","Lamu","Machakos","Makueni","Mandera","Marsabit","Meru","Migori","Mombasa","Murang'a","Nairobi","Nakuru","Nandi","Narok","Nyamira","Nyandarua","Nyeri","Samburu","Siaya","Taita-Taveta","Tana River","Tharaka-Nithi","Trans Nzoia","Turkana","Uasin Gishu","Vihiga","Wajir","West Pokot"];

function Frame({ children, side }: { children: ReactNode; side: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 39px, currentColor 39px 40px)" }} />
        <div className="absolute bottom-0 left-16 top-0 w-px bg-sidebar-primary/40" />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-sidebar-primary font-display text-lg font-bold text-sidebar-primary-foreground">R</div>
          <span className="font-display text-xl font-semibold text-sidebar-accent-foreground">Rejista</span>
        </div>
        <div className="relative pl-10">{side}</div>
        <div className="relative pl-10 font-mono text-[11px] uppercase tracking-[0.2em] text-sidebar-foreground/50">Admission register · Guardians · Audit trail</div>
      </aside>
      <div className="flex items-center justify-center px-5 py-10 md:px-12">
        <div className="rise w-full max-w-xl">{children}</div>
      </div>
    </div>
  );
}

function useAuthDone() {
  const qc = useQueryClient();
  return (s: AuthSession) => {
    qc.setQueryData(getGetSetupStatusQueryKey(), { needsSetup: false });
    qc.setQueryData(getGetCurrentUserQueryKey(), s);
  };
}

export function SetupPage() {
  const done = useAuthDone();
  const m = useCreateInitialSchool({ mutation: { onSuccess: done } });
  const [f, setF] = useState({ schoolName: "", schoolCode: "", county: "", schoolType: "primary" as SchoolType, adminName: "", email: "", phone: "", password: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("Add an email or phone number so the administrator can sign in.");
    if (f.password.length < 10) return setErr("Password must be at least 10 characters.");
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    m.mutate({ data: { schoolName: f.schoolName.trim(), schoolCode: f.schoolCode.trim().toUpperCase(), county: f.county || undefined, schoolType: f.schoolType, adminName: f.adminName.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, password: f.password } }, { onError: (x) => setErr(errMsg(x)) });
  };

  return (
    <Frame side={<>
      <p className="font-display text-4xl font-semibold leading-[1.1] text-sidebar-accent-foreground">Open the register.<br /><span className="text-sidebar-primary">Every learner, every guardian,</span><br />on one page.</p>
      <p className="mt-6 max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">First-run setup creates your school and its administrator account. You will add staff, grades and streams once you are inside.</p>
    </>}>
      <div className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">First-run setup</div>
        <h1 className="mt-1 font-display text-4xl font-semibold">Register your school</h1>
      </div>
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="School name" required className="sm:col-span-4"><TextInput data-testid="input-school-name" required minLength={2} value={f.schoolName} onChange={set("schoolName")} placeholder="Kitengela Hills Academy" /></Field>
          <Field label="School code" required className="sm:col-span-2"><TextInput data-testid="input-school-code" required minLength={2} className="font-mono uppercase" value={f.schoolCode} onChange={set("schoolCode")} placeholder="KHA-01" /></Field>
          <Field label="County" className="sm:col-span-3"><NativeSelect data-testid="select-county" value={f.county} onChange={set("county")}><option value="">Select county</option>{COUNTIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
          <Field label="Level" required className="sm:col-span-3"><NativeSelect data-testid="select-school-type" value={f.schoolType} onChange={set("schoolType")}>{Object.values(SchoolType).map((t) => <option key={t} value={t} className="capitalize">{t[0].toUpperCase() + t.slice(1)}</option>)}</NativeSelect></Field>
        </div>
        <div className="rounded-md border border-amber-600/30 bg-accent/50 px-4 py-3 text-sm text-accent-foreground" data-testid="text-platform-owner-note">
          <span className="font-semibold">This first account becomes the platform owner.</span> It manages this school and can provision additional schools later. Each extra school gets its own administrator who signs in separately.
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>Platform owner</span><span className="h-px flex-1 bg-border" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required className="sm:col-span-2"><TextInput data-testid="input-admin-name" required minLength={2} value={f.adminName} onChange={set("adminName")} placeholder="Grace Wanjiru Mwangi" /></Field>
          <Field label="Email" hint="Email or phone is required"><TextInput data-testid="input-email" type="email" value={f.email} onChange={set("email")} placeholder="admin@school.ac.ke" /></Field>
          <Field label="Phone"><TextInput data-testid="input-phone" type="tel" value={f.phone} onChange={set("phone")} placeholder="0712 345 678" /></Field>
          <Field label="Password" required hint="At least 10 characters"><TextInput data-testid="input-password" type="password" required value={f.password} onChange={set("password")} /></Field>
          <Field label="Confirm password" required><TextInput data-testid="input-confirm" type="password" required value={f.confirm} onChange={set("confirm")} /></Field>
        </div>
        <FormError msg={err} />
        <Btn data-testid="button-create-school" type="submit" disabled={m.isPending} className="h-11 w-full text-[15px]">
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create school and sign in <ArrowRight className="h-4 w-4" /></>}
        </Btn>
      </form>
    </Frame>
  );
}

export function LoginPage() {
  const done = useAuthDone();
  const m = useLogin({ mutation: { onSuccess: done } });
  const [identifier, setId] = useState("");
  const [password, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    m.mutate({ data: { identifier: identifier.trim(), password } }, { onError: (x) => setErr(errMsg(x, "Sign-in failed")) });
  };
  return (
    <Frame side={<>
      <p className="font-display text-4xl font-semibold leading-[1.1] text-sidebar-accent-foreground">Karibu tena.</p>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">Sign in with the email or phone number your school administrator registered for you.</p>
    </>}>
      <div className="mx-auto max-w-sm">
        <div className="mb-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">Staff sign-in</div>
          <h1 className="mt-1 font-display text-4xl font-semibold">Welcome back</h1>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email or phone"><TextInput data-testid="input-identifier" required minLength={3} autoFocus value={identifier} onChange={(e) => setId(e.target.value)} placeholder="you@school.ac.ke or 07..." /></Field>
          <Field label="Password"><TextInput data-testid="input-password" type="password" required value={password} onChange={(e) => setPw(e.target.value)} /></Field>
          <FormError msg={err} />
          <Btn data-testid="button-login" type="submit" disabled={m.isPending} className="h-11 w-full">
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
          </Btn>
          <p className="pt-2 text-xs text-muted-foreground">Forgot your password? Ask your school administrator to reset your account.</p>
        </form>
      </div>
    </Frame>
  );
}
