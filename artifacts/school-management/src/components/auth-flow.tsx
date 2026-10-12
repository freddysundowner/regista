import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCheckEmailAvailable, useCreateInitialSchool, useGetPublicPricing, useGetSetupStatus, useRegisterSchool, getGetPublicPricingQueryKey,
  getGetCurrentUserQueryKey, getGetSetupStatusQueryKey, SchoolType, type AuthSession,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { Btn, FormError } from "@/components/kit";
import { LoginForm, ForgotPasswordForm, ResetPasswordForm, RECOVERY_COPY, COUNTIES } from "@/pages/auth";
import { errMsg } from "@/lib/session";
import { cn } from "@/lib/utils";

export type AuthPanelMode = "login" | "register" | "setup" | "forgot" | "reset";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEVELS = Object.values(SchoolType);
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

const ctl = "h-12 w-full rounded-xl border border-input bg-muted/30 px-4 text-[15px] outline-none transition placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/10";
function Q({ label, hint, children, optional }: { label: string; hint?: string; children: ReactNode; optional?: boolean }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between text-sm font-medium">{label}{optional && <span className="text-xs font-normal text-muted-foreground">Optional</span>}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
function Choice<T extends string>({ value, options, onChange, testid }: { value: T; options: readonly T[]; onChange: (v: T) => void; testid: string }) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} data-testid={`${testid}-${o}`} onClick={() => onChange(o)}
          className={cn("rounded-full px-4 py-2 text-sm font-medium ring-1 transition", value === o ? "bg-primary text-primary-foreground ring-primary" : "bg-card ring-foreground/10 hover:bg-muted")}>{cap(o)}</button>
      ))}
    </div>
  );
}
function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
function Password({ value, onChange, testid, autoFocus }: { value: string; onChange: (v: string) => void; testid: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  const s = strength(value);
  return (
    <div className="space-y-2">
      <div className="relative">
        <input data-testid={testid} className={`${ctl} pr-12`} type={show ? "text" : "password"} autoComplete="new-password" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex gap-1.5" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1 flex-1 rounded-full transition", i < s ? (s < 2 ? "bg-amber-500" : "bg-primary") : "bg-muted")} />)}</div>
      <span className="block text-xs text-muted-foreground">{value.length < 6 ? `${6 - value.length} more character${6 - value.length === 1 ? "" : "s"} needed` : s < 3 ? "Good. Mixing cases, numbers and symbols makes it stronger." : "Strong password"}</span>
    </div>
  );
}

/** `verify` is a check that needs the server (is this email free?); `body` may take a function to jump to another step. */
type Step = { title: string; subtitle: string; body: ReactNode | ((goTo: (step: number) => void) => ReactNode); check: () => string | null; verify?: () => Promise<string | null> };
/** One group of related questions per screen; Enter advances; the last screen submits. */
function Progressive({ steps, submitLabel, busy, error, onSubmit }: { steps: Step[]; submitLabel: string; busy: boolean; error: string | null; onSubmit: () => void }) {
  const [i, setI] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const last = i === steps.length - 1;
  useEffect(() => { top.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus(); }, [i]);
  const [checking, setChecking] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || checking) return;
    const x = steps[i].check();
    if (x) return setErr(x);
    setErr(null);
    if (steps[i].verify) {
      setChecking(true);
      const problem = await steps[i].verify!().finally(() => setChecking(false));
      if (problem) return setErr(problem);
    }
    if (last) onSubmit(); else setI(i + 1);
  };
  const goTo = (step: number) => { setErr(null); setI(step); };
  return (
    <form onSubmit={go} noValidate className="flex min-h-0 flex-1 flex-col">
      {/* On a phone the progress bar runs the full width, lined up with the heading and fields. */}
      <div className="mb-6 flex items-center gap-3 max-md:min-h-9">
        {i > 0 ? <button type="button" onClick={() => { setErr(null); setI(i - 1); }} disabled={busy} data-testid="button-step-back" className="flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-foreground/10 hover:bg-muted" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button> : <span className="h-9 w-9 max-md:hidden" />}
        <div className="flex flex-1 gap-1.5" aria-hidden>{steps.map((_, n) => <span key={n} className={cn("h-1.5 flex-1 rounded-full transition-colors", n <= i ? "bg-primary" : "bg-muted")} />)}</div>
        <span className="h-9 w-9 max-md:hidden" />
      </div>
      <div ref={top} key={i} className="rise flex-1 space-y-5 max-md:flex-none max-md:space-y-7">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] max-md:text-xl">{steps[i].title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{steps[i].subtitle}</p>
        </div>
        {typeof steps[i].body === "function" ? steps[i].body(goTo) : steps[i].body}
      </div>
      <div className="mt-8 space-y-3">
        <FormError msg={err ?? (last ? error : null)} />
        <Btn type="submit" data-testid={last ? "button-flow-submit" : "button-flow-next"} disabled={busy || checking} className="h-12 w-full rounded-xl text-[15px] font-semibold">
          {busy || checking ? <Loader2 className="h-4 w-4 animate-spin" /> : last ? <>{submitLabel} <Check className="h-4 w-4" /></> : <>Continue <ArrowRight className="h-4 w-4" /></>}
        </Btn>
      </div>
    </form>
  );
}
/** The details before they are sent. A row that names a step gets an Edit link back to it. */
function Review({ rows, onEdit }: { rows: [string, string, number?][]; onEdit?: (step: number) => void }) {
  return (
    <dl className="divide-y divide-border/70 rounded-2xl bg-muted/40 ring-1 ring-foreground/[.05]">
      {rows.map(([k, v, step]) => (
        <div key={k} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="truncate text-sm font-medium">{v || "—"}</dd></div>
          {onEdit && step !== undefined && <button type="button" onClick={() => onEdit(step)} data-testid={`button-edit-${k.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="shrink-0 text-sm font-semibold text-primary hover:underline">Edit</button>}
        </div>
      ))}
    </dl>
  );
}

function useSignedIn() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  return (s: AuthSession) => {
    qc.setQueryData(getGetSetupStatusQueryKey(), { needsSetup: false, requiresSetupToken: false });
    // A "who am I" check still in flight from before the sign-in would answer "nobody" and bounce the person back to the landing page, so it is dropped first.
    void qc.cancelQueries({ queryKey: getGetCurrentUserQueryKey() });
    qc.setQueryData(getGetCurrentUserQueryKey(), s);
    navigate("/", { replace: true });
  };
}

function RegisterFlow({ agreed }: { agreed: boolean }) {
  const pricing = useGetPublicPricing({ query: { queryKey: getGetPublicPricingQueryKey(), staleTime: 60_000 } }).data;
  const m = useRegisterSchool();
  const available = useCheckEmailAvailable();
  const signedIn = useSignedIn();
  const [d, setD] = useState({ adminName: "", email: "", password: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [k]: e.target.value }));
  const approval = pricing?.requireApproval ?? true;
  const trial = pricing?.trialDays ?? 7;
  const steps: Step[] = [
    { title: "Create your account", subtitle: "You'll be the school's administrator. You'll set up the school once you're inside.",
      body: <>
        <Q label="Your full name"><input data-testid="input-admin-name" className={ctl} autoComplete="name" maxLength={160} value={d.adminName} onChange={set("adminName")} /></Q>
        <Q label="Email" hint="You'll sign in with this."><input data-testid="input-email" className={ctl} type="email" autoComplete="email" maxLength={180} value={d.email} onChange={set("email")} placeholder="you@school.ac.ke" /></Q>
      </>,
      check: () => d.adminName.trim().length < 2 ? "Enter your full name." : !EMAIL.test(d.email.trim()) ? "Enter a valid email address." : null,
      // Said here, on the first screen, not after the password. If the check itself cannot run, sign-up still catches it.
      verify: () => available.mutateAsync({ data: { email: d.email.trim() } }).then((r) => r.available ? null : "An account with this email already exists. Sign in instead, or use a different email.", () => null) },
    { title: "Secure your account", subtitle: "At least 6 characters. Longer is safer; a short sentence works well.",
      body: <>
        <Q label="Password"><Password testid="input-password" value={d.password} onChange={(v) => setD({ ...d, password: v })} /></Q>
        <Q label="Type it again"><input data-testid="input-confirm" className={ctl} type="password" autoComplete="new-password" value={d.confirm} onChange={set("confirm")} /></Q>
      </>,
      check: () => d.password.length < 6 ? "Use at least 6 characters." : d.password !== d.confirm ? "The passwords don't match." : null },
    { title: "Ready when you are", subtitle: approval ? "We'll review your account and email you when it's approved." : `Your ${trial}-day free trial starts straight away, with every feature.`,
      body: (goTo) => <Review onEdit={goTo} rows={[["Administrator", d.adminName.trim(), 0], ["Sign-in email", d.email.trim(), 0]]} />,
      check: () => agreed ? null : "Tick the box at the bottom to accept the terms." },
  ];
  return <Progressive steps={steps} submitLabel={approval ? "Submit for review" : "Create my account"} busy={m.isPending} error={err}
    onSubmit={() => { setErr(null); m.mutate({ data: { adminName: d.adminName.trim(), email: d.email.trim(), password: d.password, acceptedTerms: true } }, { onSuccess: signedIn, onError: (x) => setErr(errMsg(x, "Registration failed. Your details are kept; check and try again.")) }); }} />;
}

function SetupFlow() {
  const status = useGetSetupStatus().data;
  const needsToken = status?.requiresSetupToken === true;
  const m = useCreateInitialSchool();
  const signedIn = useSignedIn();
  const [d, setD] = useState({ schoolName: "", county: "", schoolType: "primary" as SchoolType, adminName: "", email: "", phone: "", password: "", confirm: "", setupToken: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [k]: e.target.value }));
  const suggested = d.schoolName.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 5);
  // The school code is generated from the name; it is internal and never asked for.
  const code = suggested ? `${suggested}-01` : "SCH-01";
  const steps: Step[] = [
    { title: "Your school", subtitle: "This first school is yours to run. You can add more schools later.",
      body: <>
        <Q label="School name"><input data-testid="input-school-name" className={ctl} value={d.schoolName} onChange={set("schoolName")} placeholder="e.g. Kitengela Hills Academy" /></Q>
        <Q label="Level"><Choice value={d.schoolType} options={LEVELS} onChange={(v) => setD({ ...d, schoolType: v })} testid="choice-level" /></Q>
        <Q label="County" optional><select data-testid="select-county" className={ctl} value={d.county} onChange={set("county")}><option value="">Select county</option>{COUNTIES.map((c) => <option key={c}>{c}</option>)}</select></Q>
      </>,
      check: () => d.schoolName.trim().length < 2 ? "Enter your school's name." : null },
    { title: "About you", subtitle: "You'll be the owner, with full access. Add an email, a phone, or both.",
      body: <>
        <Q label="Your full name"><input data-testid="input-admin-name" className={ctl} autoComplete="name" value={d.adminName} onChange={set("adminName")} /></Q>
        <div className="grid gap-4 sm:grid-cols-2">
          <Q label="Email"><input data-testid="input-email" className={ctl} type="email" autoComplete="email" value={d.email} onChange={set("email")} placeholder="you@school.ac.ke" /></Q>
          <Q label="Phone"><input data-testid="input-phone" className={ctl} type="tel" autoComplete="tel" value={d.phone} onChange={set("phone")} placeholder="0712 345 678" /></Q>
        </div>
      </>,
      check: () => d.adminName.trim().length < 2 ? "Enter your full name." : !d.email.trim() && !d.phone.trim() ? "Add an email or a phone number to sign in with." : d.email.trim() && !EMAIL.test(d.email.trim()) ? "Check the email address." : null },
    { title: "Secure your account", subtitle: "At least 6 characters. Longer is safer; a short sentence works well.",
      body: <>
        {needsToken && <Q label="Setup token" hint="Issued by whoever installed Rejista."><input data-testid="input-setup-token" className={ctl} type="password" autoComplete="off" value={d.setupToken} onChange={set("setupToken")} /></Q>}
        <Q label="Password"><Password testid="input-password" value={d.password} onChange={(v) => setD({ ...d, password: v })} /></Q>
        <Q label="Type it again"><input data-testid="input-confirm" className={ctl} type="password" autoComplete="new-password" value={d.confirm} onChange={set("confirm")} /></Q>
      </>,
      check: () => needsToken && !d.setupToken.trim() ? "Enter the setup token." : d.password.length < 6 ? "Use at least 6 characters." : d.password !== d.confirm ? "The passwords don't match." : null },
    { title: "All set", subtitle: "Check the details, then open your register.",
      body: (goTo) => <Review onEdit={goTo} rows={[["School", d.schoolName.trim(), 0], ["Level", cap(d.schoolType), 0], ["County", d.county, 0], ["Owner", d.adminName.trim(), 1], ["Sign in with", d.email.trim() || d.phone.trim(), 1]]} />,
      check: () => null },
  ];
  return <Progressive steps={steps} submitLabel="Create school and sign in" busy={m.isPending} error={err}
    onSubmit={() => { setErr(null); m.mutate({ data: { ...(needsToken ? { setupToken: d.setupToken.trim() } : {}), schoolName: d.schoolName.trim(), schoolCode: code.trim().toUpperCase(), county: d.county || undefined, schoolType: d.schoolType, adminName: d.adminName.trim(), email: d.email.trim() || undefined, phone: d.phone.trim() || undefined, password: d.password } }, { onSuccess: signedIn, onError: (x) => setErr(errMsg(x)) }); }} />;
}

/** Sign-in and sign-up as their own pages inside the landing layout (header and footer stay). */
export function AuthScreen({ mode, needsSetup }: { mode: AuthPanelMode; needsSetup: boolean }) {
  const [, navigate] = useLocation();
  const createMode: AuthPanelMode = needsSetup ? "setup" : "register";
  const [agreed, setAgreed] = useState(true);
  useEffect(() => {
    document.title = `${mode === "login" ? "Sign in" : mode === "setup" ? "Set up your school" : mode === "forgot" || mode === "reset" ? RECOVERY_COPY[mode].title.replace("?", "") : "Create account"} · Rejista`;
    window.scrollTo({ top: 0 });
  }, [mode]);
  return (
    <section className="mx-auto w-[90%] max-w-4xl py-10 max-md:w-full max-md:py-0 lg:py-16">
      {/* A card on a computer. On a phone there is no card: the screen is one plain sheet, with the button straight under the fields and the switch link resting at the bottom. */}
      <div className="rounded-3xl bg-card p-6 shadow-[0_1px_2px_hsl(var(--foreground)/.04),0_30px_60px_-30px_hsl(var(--foreground)/.25)] ring-1 ring-foreground/[.06] max-md:flex max-md:min-h-[calc(100dvh-4rem)] max-md:flex-col max-md:rounded-none max-md:px-5 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-md:pt-10 max-md:shadow-none max-md:ring-0 sm:p-12">
        {mode === "login" && <div key="login" className="rise mx-auto max-w-xl max-md:w-full max-md:flex-1">
          <h1 className="text-3xl font-semibold tracking-[-0.02em] max-md:text-xl">Welcome back</h1>
          <p className="mb-8 mt-1.5 text-muted-foreground max-md:mb-6 max-md:mt-1 max-md:text-sm">Sign in to continue to your school.</p>
          <LoginForm />
        </div>}
        {(mode === "forgot" || mode === "reset") && <div key={mode} className="rise mx-auto max-w-xl max-md:w-full max-md:flex-1">
          <h1 className="text-3xl font-semibold tracking-[-0.02em] max-md:text-xl">{RECOVERY_COPY[mode].title}</h1>
          <p className="mb-8 mt-1.5 text-muted-foreground max-md:mb-6 max-md:mt-1 max-md:text-sm">{RECOVERY_COPY[mode].subtitle}</p>
          {mode === "forgot" ? <ForgotPasswordForm /> : <ResetPasswordForm />}
        </div>}
        {mode === "register" && <RegisterFlow key="register" agreed={agreed} />}
        {mode === "setup" && <SetupFlow key="setup" />}
        {mode !== "forgot" && mode !== "reset" && <p className="mt-10 text-center text-sm text-muted-foreground max-md:mt-5">
          {mode === "login"
            ? <>{needsSetup ? "First time here? " : "New to Rejista? "}<button type="button" onClick={() => navigate(`/${createMode}`)} className="font-semibold text-primary hover:underline" data-testid="link-switch-create">{needsSetup ? "Set up your school" : "Create an account"}</button></>
            : <>Already have an account? <button type="button" onClick={() => navigate("/login")} className="font-semibold text-primary hover:underline" data-testid="link-switch-login">Sign in</button></>}
        </p>}
        {/* Ticked to begin with, small, and last on the screen. The links open in a new tab so nothing typed is lost. */}
        {mode === "register" && <label className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground max-md:mt-4">
          <input type="checkbox" data-testid="checkbox-terms" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]" />
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener" data-testid="link-terms" className="font-semibold text-primary hover:underline">Terms</a> and <a href="/privacy" target="_blank" rel="noopener" data-testid="link-privacy" className="font-semibold text-primary hover:underline">Privacy Policy</a></span>
        </label>}
      </div>
    </section>
  );
}
