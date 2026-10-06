import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateInitialSchool, useLogin, useGetSetupStatus, getGetCurrentUserQueryKey, getGetSetupStatusQueryKey, SchoolType, type AuthSession } from "@workspace/api-client-react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Field, TextInput, NativeSelect, FormError, Btn } from "@/components/kit";
import { errMsg } from "@/lib/session";

export const COUNTIES = ["Baringo","Bomet","Bungoma","Busia","Elgeyo-Marakwet","Embu","Garissa","Homa Bay","Isiolo","Kajiado","Kakamega","Kericho","Kiambu","Kilifi","Kirinyaga","Kisii","Kisumu","Kitui","Kwale","Laikipia","Lamu","Machakos","Makueni","Mandera","Marsabit","Meru","Migori","Mombasa","Murang'a","Nairobi","Nakuru","Nandi","Narok","Nyamira","Nyandarua","Nyeri","Samburu","Siaya","Taita-Taveta","Tana River","Tharaka-Nithi","Trans Nzoia","Turkana","Uasin Gishu","Vihiga","Wajir","West Pokot"];

export function Frame({ children, side }: { children: ReactNode; side: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] grid-cols-1 bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
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
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2.5 bg-sidebar px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-sidebar-foreground lg:hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary font-display text-lg font-bold text-sidebar-primary-foreground">R</div>
          <div className="min-w-0"><div className="font-display text-lg font-semibold leading-tight text-sidebar-accent-foreground">Rejista</div><div className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">Admission register · Guardians · Audit</div></div>
        </div>
        <div className="flex flex-1 items-start justify-center px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-8 md:items-center md:px-12 md:py-10">
          <div className="rise min-w-0 w-full max-w-xl">{children}</div>
        </div>
      </div>
    </div>
  );
}

function useAuthDone() {
  const qc = useQueryClient();
  return (s: AuthSession) => {
    qc.setQueryData(getGetSetupStatusQueryKey(), { needsSetup: false, requiresSetupToken: false });
    qc.setQueryData(getGetCurrentUserQueryKey(), s);
  };
}

export function SetupPage() {
  const done = useAuthDone();
  const m = useCreateInitialSchool({ mutation: { onSuccess: done } });
  const status = useGetSetupStatus();
  const needsToken = status.data?.requiresSetupToken === true;
  const [f, setF] = useState({ setupToken: "", schoolName: "", schoolCode: "", county: "", schoolType: "primary" as SchoolType, adminName: "", email: "", phone: "", password: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("Add an email or phone number so the administrator can sign in.");
    if (f.password.length < 10) return setErr("Password must be at least 10 characters.");
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    if (needsToken && !f.setupToken.trim()) return setErr("Enter the setup token provided by your platform operator.");
    m.mutate({ data: { ...(needsToken ? { setupToken: f.setupToken.trim() } : {}), schoolName: f.schoolName.trim(), schoolCode: f.schoolCode.trim().toUpperCase(), county: f.county || undefined, schoolType: f.schoolType, adminName: f.adminName.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, password: f.password } }, { onError: (x) => setErr(errMsg(x)) });
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
        {needsToken && <Field label="Setup token" required hint="Issued by whoever deployed Rejista. Not stored in this browser."><TextInput data-testid="input-setup-token" type="password" autoComplete="off" required maxLength={256} value={f.setupToken} onChange={set("setupToken")} /></Field>}
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

function LoginShell({ children }: { children: ReactNode }) {
  const areas = ["Learners", "Families", "Fees", "Academics"];
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[hsl(42_38%_95%)]">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,hsl(38_88%_62%/.32),transparent_65%)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-56 -left-40 h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,hsl(188_52%_30%/.20),transparent_65%)]" />
      <div className="relative mx-auto grid min-h-[100dvh] max-w-6xl grid-cols-1 gap-10 px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 lg:py-12">
        <header className="flex flex-col lg:h-full lg:justify-between lg:py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-display text-xl font-bold text-primary-foreground shadow-[0_6px_16px_-6px_hsl(188_52%_20%/.6)]">R</div>
            <span className="font-display text-xl font-semibold tracking-tight">Rejista</span>
          </div>
          <div className="mt-10 hidden lg:block">
            <h2 className="text-[clamp(2.75rem,4.6vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-foreground">
              Your school's<br />day, <span className="text-primary">in one place.</span>
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">The shared workspace where staff keep learners, families, fees and academics up to date together.</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {areas.map((a) => <li key={a} className="rounded-full border border-primary/15 bg-card/70 px-3.5 py-1.5 text-sm font-medium text-primary backdrop-blur">{a}</li>)}
            </ul>
          </div>
          <p className="mt-10 hidden text-xs text-muted-foreground lg:block">Karibu tena — welcome back.</p>
        </header>
        <main className="flex items-start justify-center lg:items-center">
          <div className="rise w-full max-w-md rounded-[1.75rem] border border-card-border bg-card/90 p-6 shadow-[0_30px_60px_-30px_hsl(192_40%_15%/.35)] backdrop-blur sm:p-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function LoginPage() {
  const done = useAuthDone();
  const m = useLogin({ mutation: { onSuccess: done } });
  const [identifier, setId] = useState("");
  const [password, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { document.title = "Sign in · Rejista"; }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    m.mutate({ data: { identifier: identifier.trim(), password } }, { onError: (x) => setErr(errMsg(x, "Sign-in failed")) });
  };
  const ctl = "h-12 w-full rounded-xl border border-input bg-background/60 px-4 text-[15px] outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/10";
  return (
    <LoginShell>
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Staff sign-in</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.03em] sm:text-[2.1rem]">Welcome back</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Use the email or phone number your school administrator registered for you.</p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="login-identifier" className="text-sm font-medium">Email or phone</label>
          <input id="login-identifier" name="username" data-testid="input-identifier" className={ctl} required minLength={3} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={identifier} onChange={(e) => setId(e.target.value)} placeholder="you@school.ac.ke or 07..." />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="login-password" className="text-sm font-medium">Password</label>
          <div className="relative">
            <input id="login-password" name="password" data-testid="input-password" className={`${ctl} pr-12`} type={show ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPw(e.target.value)} />
            <button type="button" data-testid="button-toggle-password" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} aria-controls="login-password" className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Forgot your password? Ask your school administrator to reset your account.</p>
        </div>
        <FormError msg={err} />
        <Btn data-testid="button-login" type="submit" disabled={m.isPending} aria-busy={m.isPending} className="h-12 w-full rounded-xl text-[15px] sm:h-12">
          {m.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in</> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
        </Btn>
      </form>
      <div className="mt-8 border-t border-border/70 pt-6 text-sm text-muted-foreground">
        New school? <Link href="/register" data-testid="link-register" className="font-semibold text-primary hover:underline">Register for review</Link>
      </div>
    </LoginShell>
  );
}
