import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useRegisterSchool, useGetCurrentUser, useLogout, getGetCurrentUserQueryKey, getGetSetupStatusQueryKey, SchoolType, type AuthSession } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Check, Clock, Loader2, LogOut, RefreshCw, XCircle } from "lucide-react";
import { Field, TextInput, NativeSelect, FormError, Btn } from "@/components/kit";
import { Frame } from "@/pages/auth";
import { hardReset } from "@/components/platform-kit";
import { errMsg, fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

const STEPS = ["School", "Your account", "Review"] as const;
const label = (t: string) => t[0].toUpperCase() + t.slice(1);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Draft = { schoolName: string; schoolType: SchoolType; adminName: string; email: string; password: string };

function stepError(step: number, d: Draft): string | null {
  if (step === 0) {
    const n = d.schoolName.trim();
    if (n.length < 2) return "Enter the school name (at least 2 characters).";
    if (n.length > 180) return "School name must be 180 characters or fewer.";
  }
  if (step === 1) {
    const a = d.adminName.trim();
    if (a.length < 2 || a.length > 160) return "Enter your full name (2 to 160 characters).";
    if (!EMAIL.test(d.email.trim()) || d.email.trim().length > 180) return "Enter a valid email address. You will sign in with it.";
    if (d.password.length < 10 || d.password.length > 128) return "Password must be 10 to 128 characters.";
  }
  return null;
}

/** Public self-registration wizard. Draft lives in React state only; nothing is persisted to storage. */
export function RegisterPage() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>({ schoolName: "", schoolType: "primary", adminName: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = useRegisterSchool();
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [k]: e.target.value }));

  const next = (e: React.MouseEvent) => {
    e.preventDefault();
    const x = stepError(step, d);
    if (x) return setErr(x);
    setErr(null); setStep((s) => s + 1);
  };
  const back = (e: React.MouseEvent) => { e.preventDefault(); setErr(null); setStep((s) => Math.max(0, s - 1)); };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step !== 2 || m.isPending) return; // Enter key on earlier steps never submits
    for (const s of [0, 1]) { const x = stepError(s, d); if (x) { setStep(s); return setErr(x); } }
    setErr(null);
    m.mutate({ data: { schoolName: d.schoolName.trim(), schoolType: d.schoolType, adminName: d.adminName.trim(), email: d.email.trim(), password: d.password } }, {
      onSuccess: (session: AuthSession) => {
        qc.setQueryData(getGetSetupStatusQueryKey(), { needsSetup: false, requiresSetupToken: false });
        qc.setQueryData(getGetCurrentUserQueryKey(), session);
        navigate("/", { replace: true });
      },
      onError: (x) => setErr(errMsg(x, "Registration failed. Your details are kept; check and try again.")),
    });
  };

  return (
    <Frame side={<>
      <p className="font-display text-4xl font-semibold leading-[1.1] text-sidebar-accent-foreground">Start with two things.<br /><span className="text-sidebar-primary">Your school and you.</span></p>
      <p className="mt-6 max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">County, contacts, logo and the rest wait until you are approved and inside. A platform reviewer checks each new school before it opens.</p>
    </>}>
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          {step > 0 ? <button type="button" key="hdr-back" onClick={back} disabled={m.isPending} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="button-wizard-header-back"><ArrowLeft className="h-3.5 w-3.5" />Back</button>
            : <Link href="/" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-login"><ArrowLeft className="h-3.5 w-3.5" />Sign in</Link>}
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Step {step + 1} of 3</span>
        </div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">School registration</div>
        <h1 className="font-display text-4xl font-semibold">{STEPS[step]}</h1>
        <ol className="mt-5 mb-8 grid grid-cols-3 gap-2" aria-label="Progress">
          {STEPS.map((t, i) => (
            <li key={t} className="space-y-1.5">
              <div className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-muted")} />
              <div className={cn("flex items-center gap-1 text-[11px] font-semibold", i === step ? "text-foreground" : "text-muted-foreground")}>{i < step && <Check className="h-3 w-3 text-primary" />}{t}</div>
            </li>
          ))}
        </ol>

        <form onSubmit={submit} className="space-y-5" noValidate>
          {step === 0 && <div key="s0" className="rise space-y-4">
            <Field label="School name" required><TextInput data-testid="input-school-name" autoFocus maxLength={180} value={d.schoolName} onChange={set("schoolName")} placeholder="Kitengela Hills Academy" /></Field>
            <Field label="Level" required hint="You can refine this later in settings."><NativeSelect data-testid="select-school-type" value={d.schoolType} onChange={set("schoolType")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{label(t)}</option>)}</NativeSelect></Field>
          </div>}
          {step === 1 && <div key="s1" className="rise space-y-4">
            <Field label="Full name" required><TextInput data-testid="input-admin-name" autoFocus autoComplete="name" maxLength={160} value={d.adminName} onChange={set("adminName")} placeholder="Grace Wanjiru Mwangi" /></Field>
            <Field label="Email" required hint="You will sign in with this email."><TextInput data-testid="input-email" type="email" autoComplete="email" maxLength={180} value={d.email} onChange={set("email")} placeholder="admin@school.ac.ke" /></Field>
            <Field label="Password" required hint="At least 10 characters">
              <div className="relative">
                <TextInput data-testid="input-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={128} value={d.password} onChange={set("password")} className="pr-16" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)} className="absolute inset-y-0 right-0 min-w-14 px-3 text-xs font-semibold text-primary">{showPassword ? "Hide" : "Show"}</button>
              </div>
            </Field>
          </div>}
          {step === 2 && <div key="s2" className="rise space-y-4">
            <dl className="divide-y divide-border/60 rounded-md border border-border bg-card">
              {[["School", d.schoolName.trim(), 0], ["Level", label(d.schoolType), 0], ["Administrator", d.adminName.trim(), 1], ["Sign-in email", d.email.trim(), 1], ["Password", "Set (hidden)", 1]].map(([k, v, s]) => (
                <div key={String(k)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{k}</dt><dd className="truncate text-sm font-medium">{v}</dd></div>
                  <button type="button" disabled={m.isPending} onClick={(e) => { e.preventDefault(); setErr(null); setStep(Number(s)); }} className="text-xs font-semibold text-primary hover:underline">Change</button>
                </div>
              ))}
            </dl>
            <p className="rounded-md border border-amber-600/30 bg-accent/50 px-4 py-3 text-sm text-accent-foreground">A school code is generated for you. After submitting, your registration waits for platform review; you can sign in any time to check its status.</p>
          </div>}
          <FormError msg={err} />
          <div className="flex gap-3 pt-1">
            {step > 0 && <Btn key="nav-back" type="button" variant="outline" className="h-11" onClick={back} disabled={m.isPending} data-testid="button-wizard-back"><ArrowLeft className="h-4 w-4" />Back</Btn>}
            {step < 2
              ? <Btn key="nav-next" type="button" className="h-11 flex-1" onClick={next} data-testid="button-wizard-next">Next <ArrowRight className="h-4 w-4" /></Btn>
              : <Btn key="final-submit" type="submit" className="h-11 flex-1" disabled={m.isPending} data-testid="button-submit-registration">{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Submit for review <Check className="h-4 w-4" /></>}</Btn>}
          </div>
        </form>
      </div>
    </Frame>
  );
}

/** Shown for mode=registration sessions. Lives outside Shell: no workspace navigation. */
export function RegistrationStatusPage({ session }: { session: AuthSession }) {
  const qc = useQueryClient();
  const school = session.school;
  const pending = school?.status !== "rejected";
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false, refetchInterval: pending ? 60000 : false } });
  const logout = useLogout({ mutation: { onSuccess: () => { void hardReset(qc); } } });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  useEffect(() => { if (me.dataUpdatedAt) setCheckedAt(new Date(me.dataUpdatedAt).toISOString()); }, [me.dataUpdatedAt]);

  return (
    <Frame side={<>
      <p className="font-display text-4xl font-semibold leading-[1.1] text-sidebar-accent-foreground">{pending ? <>Your school is<br /><span className="text-sidebar-primary">awaiting approval.</span></> : <>Registration<br /><span className="text-sidebar-primary">not approved.</span></>}</p>
      <p className="mt-6 max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">Signed in as {session.user.name}{session.user.email ? ` (${session.user.email})` : ""}.</p>
    </>}>
      <div className="mx-auto max-w-md" data-testid={pending ? "page-registration-pending" : "page-registration-rejected"}>
        <div className={cn("mb-5 flex h-12 w-12 items-center justify-center rounded-full", pending ? "bg-amber-500/15 text-amber-700" : "bg-destructive/10 text-destructive")}>
          {pending ? <Clock className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">{pending ? "Pending review" : "Rejected"}</div>
        <h1 className="mt-1 break-words font-display text-4xl font-semibold" data-testid="text-registration-school">{school?.name ?? "Your school"}</h1>
        {pending ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">A platform reviewer checks every new school before its workspace opens. There is nothing more you need to do right now. This page checks automatically every minute, or you can check now. Once approved, you go straight into your school.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">The platform reviewer did not approve this registration. The workspace stays closed. Reply to the reason below through your usual contact with the platform operator if you think this is a mistake.</p>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3" data-testid="text-registration-note">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-destructive">Reason</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{school?.registrationNote || "No reason was recorded."}</p>
            </div>
          </div>
        )}
        {me.isError && <div className="mt-4"><FormError msg={errMsg(me.error, "Could not check status.")} /></div>}
        <div className="mt-8 flex flex-wrap gap-3">
          <Btn data-testid="button-check-status" className="h-11 flex-1" onClick={() => me.refetch()} disabled={me.isFetching}>{me.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Check status</Btn>
          <Btn data-testid="button-registration-logout" variant="outline" className="h-11" onClick={() => logout.mutate()} disabled={logout.isPending || logout.isSuccess}><LogOut className="h-4 w-4" />Sign out</Btn>
        </div>
        {checkedAt && <p className="mt-3 font-mono text-[11px] text-muted-foreground">Last checked {fmtDateTime(checkedAt)}</p>}
        {logout.isError && <FormError msg="Sign-out failed. Please retry." />}
      </div>
    </Frame>
  );
}
