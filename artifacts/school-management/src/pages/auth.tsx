import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { APP_INITIAL } from "@/lib/brand";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateInitialSchool, useLogin, useGetSetupStatus, useRequestPasswordReset, useResetPasswordWithLink, getGetCurrentUserQueryKey, getGetSetupStatusQueryKey, SchoolType, type AuthSession } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Field, TextInput, NativeSelect, FormError, Btn } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { useInstallation } from "@/lib/installation";

export const COUNTIES = ["Baringo","Bomet","Bungoma","Busia","Elgeyo-Marakwet","Embu","Garissa","Homa Bay","Isiolo","Kajiado","Kakamega","Kericho","Kiambu","Kilifi","Kirinyaga","Kisii","Kisumu","Kitui","Kwale","Laikipia","Lamu","Machakos","Makueni","Mandera","Marsabit","Meru","Migori","Mombasa","Murang'a","Nairobi","Nakuru","Nandi","Narok","Nyamira","Nyandarua","Nyeri","Samburu","Siaya","Taita-Taveta","Tana River","Tharaka-Nithi","Trans Nzoia","Turkana","Uasin Gishu","Vihiga","Wajir","West Pokot"];

function Brand() {
  return (
    <Link href="/" aria-label="Rejista home" className="mb-7 flex items-center justify-center gap-2.5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-display text-xl font-bold text-primary-foreground shadow-[0_8px_20px_-8px_hsl(var(--primary)/.7)]">{APP_INITIAL}</div>
      <span className="font-display text-2xl font-semibold tracking-tight">Rejista</span>
    </Link>
  );
}

export function Frame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center overflow-hidden bg-muted/40 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:justify-center">
      <div className={`rise relative w-full ${wide ? "max-w-4xl" : "max-w-[26rem]"}`}>
        <Brand />
        <div className="rounded-3xl bg-card p-6 shadow-[0_1px_2px_hsl(var(--foreground)/.04),0_24px_48px_-24px_hsl(var(--foreground)/.18)] ring-1 ring-foreground/[.06] sm:p-9">{children}</div>
      </div>
    </div>
  );
}

function useAuthDone() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  return (s: AuthSession) => {
    navigate("/", { replace: true });
    qc.setQueryData(getGetSetupStatusQueryKey(), { needsSetup: false, requiresSetupToken: false });
    // A "who am I" check still in flight from before the sign-in would answer "nobody" and bounce the person back to the landing page, so it is dropped first.
    void qc.cancelQueries({ queryKey: getGetCurrentUserQueryKey() });
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
    if (f.password.length < 6) return setErr("Password must be at least 6 characters.");
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    if (needsToken && !f.setupToken.trim()) return setErr("Enter the setup token provided by your platform operator.");
    m.mutate({ data: { ...(needsToken ? { setupToken: f.setupToken.trim() } : {}), schoolName: f.schoolName.trim(), schoolCode: f.schoolCode.trim().toUpperCase(), county: f.county || undefined, schoolType: f.schoolType, adminName: f.adminName.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, password: f.password } }, { onError: (x) => setErr(errMsg(x)) });
  };

  useEffect(() => { document.title = "Set up your school · Rejista"; }, []);

  return (
    <Frame wide>
      <div className="mb-6">
        <Link href="/login" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="link-back-login"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Set up your school</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">This first account becomes the platform owner and can add more schools later.</p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        {needsToken && <Field label="Setup token" required hint="Issued by whoever deployed Rejista. Not stored in this browser."><TextInput data-testid="input-setup-token" type="password" autoComplete="off" required maxLength={256} value={f.setupToken} onChange={set("setupToken")} /></Field>}
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-sm font-semibold">School</legend>
          <Field label="School name" required><TextInput data-testid="input-school-name" required minLength={2} value={f.schoolName} onChange={set("schoolName")} placeholder="e.g. Kitengela Hills Academy" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School code" required><TextInput data-testid="input-school-code" required minLength={2} className="font-mono uppercase" value={f.schoolCode} onChange={set("schoolCode")} placeholder="KHA-01" /></Field>
            <Field label="Level" required><NativeSelect data-testid="select-school-type" value={f.schoolType} onChange={set("schoolType")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</NativeSelect></Field>
          </div>
          <Field label="County"><NativeSelect data-testid="select-county" value={f.county} onChange={set("county")}><option value="">Select county</option>{COUNTIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
        </fieldset>
        <fieldset className="space-y-4 border-t border-border pt-5 md:border-l md:border-t-0 md:pl-10 md:pt-0">
          <legend className="mb-3 text-sm font-semibold">Your account</legend>
          <Field label="Full name" required><TextInput data-testid="input-admin-name" required minLength={2} autoComplete="name" value={f.adminName} onChange={set("adminName")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email"><TextInput data-testid="input-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="you@school.ac.ke" /></Field>
            <Field label="Phone"><TextInput data-testid="input-phone" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="0712 345 678" /></Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Enter an email or a phone number. You'll use it to sign in.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" required hint="At least 6 characters"><TextInput data-testid="input-password" type="password" autoComplete="new-password" required value={f.password} onChange={set("password")} /></Field>
            <Field label="Confirm password" required><TextInput data-testid="input-confirm" type="password" autoComplete="new-password" required value={f.confirm} onChange={set("confirm")} /></Field>
          </div>
        </fieldset>
        </div>
        <FormError msg={err} />
        <Btn data-testid="button-create-school" type="submit" disabled={m.isPending} className="h-11 w-full text-[15px]">
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create school and sign in <ArrowRight className="h-4 w-4" /></>}
        </Btn>
      </form>
    </Frame>
  );
}

/** The sign-in form alone, shared by the full page and the landing-page panel. */
export function LoginForm() {
  const done = useAuthDone();
  const m = useLogin({ mutation: { onSuccess: done } });
  const [identifier, setId] = useState("");
  const [password, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    m.mutate({ data: { identifier: identifier.trim(), password } }, { onError: (x) => setErr(errMsg(x, "Sign-in failed")) });
  };
  const ctl = "peer h-12 w-full rounded-xl border border-input bg-muted/30 pl-11 pr-4 text-[15px] outline-none transition placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/10";
  const icon = "pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/70 transition peer-focus:text-primary";
  return (
    <form onSubmit={submit} className="space-y-4 max-md:space-y-7">
      <div className="space-y-2">
        <label htmlFor="login-identifier" className="text-sm font-medium">Email or phone</label>
        <div className="relative">
          <input id="login-identifier" name="username" data-testid="input-identifier" className={ctl} required minLength={3} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={identifier} onChange={(e) => setId(e.target.value)} placeholder="you@school.ac.ke or 07…" />
          <UserRound className={icon} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="login-password" className="text-sm font-medium">Password</label>
          <Link href="/forgot-password" data-testid="link-forgot-password" className="text-xs font-semibold text-primary hover:underline">Forgot password?</Link>
        </div>
        <div className="relative">
          <input id="login-password" name="password" data-testid="input-password" className={`${ctl} pr-12`} type={show ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPw(e.target.value)} placeholder="••••••••••" />
          <LockKeyhole className={icon} />
          <button type="button" data-testid="button-toggle-password" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} aria-controls="login-password" className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <FormError msg={err} />
      <Btn data-testid="button-login" type="submit" disabled={m.isPending} aria-busy={m.isPending} className="!mt-6 h-12 w-full rounded-xl text-[15px] font-semibold shadow-[0_10px_24px_-12px_hsl(var(--primary)/.8)] transition hover:-translate-y-px sm:h-12">
        {m.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in</> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
      </Btn>
    </form>
  );
}

const authInput = "peer h-12 w-full rounded-xl border border-input bg-muted/30 pl-11 pr-4 text-[15px] outline-none transition placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/10";
const authIcon = "pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/70 transition peer-focus:text-primary";
const authButton = "!mt-6 h-12 w-full rounded-xl text-[15px] font-semibold shadow-[0_10px_24px_-12px_hsl(var(--primary)/.8)] transition hover:-translate-y-px sm:h-12";
const backToSignIn = <p className="mt-6 text-center text-sm"><Link href="/login" data-testid="link-back-to-login" className="font-semibold text-primary hover:underline">Back to sign in</Link></p>;

/** Step one of a forgotten password: ask for the email and send a one-time link to it. */
export function ForgotPasswordForm() {
  const m = useRequestPasswordReset();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (m.isSuccess) return (
    <div data-testid="forgot-sent">
      <div className="flex items-start gap-3 rounded-xl bg-primary/5 p-4 text-sm"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>If <b>{email.trim()}</b> has an account, a link to choose a new password is on its way. It works once, for one hour. Check your spam folder if you don't see it.</p></div>
      <p className="mt-4 text-sm text-muted-foreground">No email on your account, or nothing arrives? Ask your school administrator to reset your password from the Staff page.</p>
      {backToSignIn}
    </div>
  );
  return (
    <form className="space-y-4 max-md:space-y-7" onSubmit={(e) => { e.preventDefault(); setErr(null); m.mutate({ data: { email: email.trim() } }, { onError: (x) => setErr(errMsg(x, "Could not send the link.")) }); }}>
      <div className="space-y-2">
        <label htmlFor="forgot-email" className="text-sm font-medium">Email</label>
        <div className="relative">
          <input id="forgot-email" data-testid="input-forgot-email" className={authInput} type="email" required autoFocus autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.ac.ke" />
          <Mail className={authIcon} />
        </div>
      </div>
      <FormError msg={err} />
      <Btn data-testid="button-send-reset" type="submit" disabled={m.isPending} className={authButton}>{m.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending</> : <>Email me a reset link <ArrowRight className="h-4 w-4" /></>}</Btn>
      {backToSignIn}
    </form>
  );
}

/** Step two: the emailed link opens this, carrying its one-time token. */
export function ResetPasswordForm() {
  const m = useResetPasswordWithLink();
  // Read once, then taken out of the address bar so the token isn't left in history or shared by accident.
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  useEffect(() => { if (token) window.history.replaceState(null, "", "/reset-password"); }, [token]);
  const [pw, setPw] = useState({ next: "", again: "" });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!token && !m.isSuccess) return (
    <div data-testid="reset-missing">
      <p className="rounded-xl bg-amber-50/70 p-4 text-sm text-amber-900">This page opens from the link in a password reset email. Ask for a new link and open it from that email.</p>
      <p className="mt-6 text-center text-sm"><Link href="/forgot-password" className="font-semibold text-primary hover:underline">Email me a reset link</Link></p>
    </div>
  );
  if (m.isSuccess) return (
    <div data-testid="reset-done">
      <div className="flex items-start gap-3 rounded-xl bg-primary/5 p-4 text-sm"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>Your password has been changed and every device has been signed out. Sign in with the new password.</p></div>
      {/* A full page load, so a session that was open in this browser is dropped too. */}
      <p className="mt-6 text-center text-sm"><a href="/login" data-testid="link-reset-login" className="font-semibold text-primary hover:underline">Go to sign in</a></p>
    </div>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw.next.length < 6) return setErr("Use at least 6 characters.");
    if (pw.next !== pw.again) return setErr("The two passwords don't match.");
    m.mutate({ data: { token, password: pw.next } }, { onError: (x) => setErr(errMsg(x, "Could not change the password.")) });
  };
  return (
    <form className="space-y-4 max-md:space-y-7" onSubmit={submit}>
      {(["next", "again"] as const).map((k) => (
        <div key={k} className="space-y-2">
          <label htmlFor={`reset-${k}`} className="text-sm font-medium">{k === "next" ? "New password" : "Type it again"}</label>
          <div className="relative">
            <input id={`reset-${k}`} data-testid={`input-reset-${k}`} className={authInput} type={show ? "text" : "password"} required minLength={6} maxLength={128} autoFocus={k === "next"} autoComplete="new-password" value={pw[k]} onChange={(e) => setPw({ ...pw, [k]: e.target.value })} placeholder="At least 6 characters" />
            <LockKeyhole className={authIcon} />
          </div>
        </div>
      ))}
      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      <FormError msg={err} />
      <Btn data-testid="button-reset-password" type="submit" disabled={m.isPending} className={authButton}>{m.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving</> : <>Save new password <ArrowRight className="h-4 w-4" /></>}</Btn>
      {err && <p className="text-center text-sm"><Link href="/forgot-password" className="font-semibold text-primary hover:underline">Email me a new link</Link></p>}
    </form>
  );
}

export const RECOVERY_COPY = {
  forgot: { title: "Forgot your password?", subtitle: "Enter the email on your account and we'll send you a link to choose a new one." },
  reset: { title: "Choose a new password", subtitle: "Pick something you don't use anywhere else." },
} as const;

/** Forgotten-password pages for a standalone school server, which has no landing page around its sign-in. */
export function RecoveryPage({ mode }: { mode: keyof typeof RECOVERY_COPY }) {
  useEffect(() => { document.title = `${RECOVERY_COPY[mode].title.replace("?", "")} · Rejista`; }, [mode]);
  return (
    <Frame>
      <div className="mb-7">
        <h1 className="text-[1.65rem] font-semibold tracking-[-0.02em]">{RECOVERY_COPY[mode].title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{RECOVERY_COPY[mode].subtitle}</p>
      </div>
      {mode === "forgot" ? <ForgotPasswordForm /> : <ResetPasswordForm />}
    </Frame>
  );
}

export function LoginPage() {
  const { standalone } = useInstallation();
  const needsSetup = useGetSetupStatus().data?.needsSetup === true;
  useEffect(() => { document.title = "Sign in · Rejista"; }, []);
  return (
    <Frame>
      <div className="mb-7">
        <h1 className="text-[1.65rem] font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to continue to your school.</p>
      </div>
      <LoginForm />
      {!standalone && <div className="mt-7 text-center text-sm text-muted-foreground">
        {needsSetup
          ? <>First time here? <Link href="/setup" data-testid="link-setup" className="font-semibold text-primary hover:underline">Set up your school</Link></>
          : <>New school? <Link href="/register" data-testid="link-register" className="font-semibold text-primary hover:underline">Register for review</Link></>}
      </div>}
    </Frame>
  );
}
