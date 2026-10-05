import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useListGrades, useListStreams, useListGuardians, getListGradesQueryKey, getListStreamsQueryKey, getListGuardiansQueryKey, StudentStatus, BoardingStatus, type GuardianLinkInput } from "@workspace/api-client-react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Phone, Plus, Search, Star, Trash2, UserPlus, Users, X } from "lucide-react";
import { Field, TextInput, NativeSelect, FormError, Btn } from "@/components/kit";
import { fromStudent, toPayload, type StudentFormValues } from "@/components/student-form";
import { initials, nairobiToday } from "@/lib/session";
import { cn } from "@/lib/utils";

const RELATIONSHIPS = ["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Aunt", "Uncle", "Other"];
const STEPS = [
  { key: "learner", label: "Learner" },
  { key: "placement", label: "Placement" },
  { key: "guardians", label: "Guardians" },
  { key: "review", label: "Review" },
] as const;
const MAX_GUARDIANS = 10;

/** Kenyan phone to a comparable key: 0712…, 712…, +254712…, 254712… all become 254712…. */
export function normalizeKePhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("254")) return d;
  if (d.startsWith("0") && d.length === 10) return "254" + d.slice(1);
  if (d.length === 9 && /^[17]/.test(d)) return "254" + d;
  return d;
}

type GuardianDraft = { key: string; source: "existing" | "new"; guardianId?: string; name: string; phone: string; relationship: string; isPrimary: boolean; receivesNotifications: boolean };
type Errors = Record<string, string>;

export type AdmissionPayload = ReturnType<typeof toPayload> & { guardians?: GuardianLinkInput[] };

export function StudentAdmissionWizard({ pending, error, canSearchGuardians, onSubmit, onCancel, onClearError }: {
  pending: boolean; error?: string | null; canSearchGuardians: boolean;
  onSubmit: (data: AdmissionPayload) => void; onCancel: () => void; onClearError: () => void;
}) {
  const [step, setStep] = useState(0);
  const [v, setV] = useState<StudentFormValues>(() => fromStudent());
  const [guardians, setGuardians] = useState<GuardianDraft[]>([]);
  const [skipGuardians, setSkipGuardians] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const gp = v.gradeId ? { gradeId: v.gradeId } : undefined;
  const streams = useListStreams(gp, { query: { queryKey: getListStreamsQueryKey(gp), enabled: !!v.gradeId } });
  const set = (k: keyof StudentFormValues) => (e: { target: { value: string } }) => {
    setV((o) => ({ ...o, [k]: e.target.value, ...(k === "gradeId" ? { streamId: "" } : {}) }));
    setErrors((x) => { if (!x[k]) return x; const n = { ...x }; delete n[k]; return n; });
  };

  // Move focus to the step heading on step change so screen readers and phones land at the top.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    headRef.current?.focus({ preventScroll: true });
    headRef.current?.scrollIntoView({ block: "start" });
  }, [step]);

  const validate = (i: number): Errors => {
    const e: Errors = {};
    if (i === 0) {
      if (!v.admissionNo.trim()) e.admissionNo = "Enter the admission number.";
      if (!v.firstName.trim()) e.firstName = "Enter the first name.";
      if (!v.lastName.trim()) e.lastName = "Enter the last name.";
      if (v.dateOfBirth && v.dateOfBirth > nairobiToday()) e.dateOfBirth = "Date of birth cannot be in the future.";
    }
    if (i === 2) {
      if (!guardians.length && !skipGuardians) e.guardians = "Connect at least one guardian, or choose to add guardians later.";
      if (guardians.length && !guardians.some((g) => g.isPrimary)) e.guardians = "Mark one guardian as primary.";
      guardians.forEach((g) => {
        if (g.source !== "new") return;
        if (g.name.trim().length < 2) e[`g-name-${g.key}`] = "Enter the guardian's name.";
        const n = normalizeKePhone(g.phone);
        if (!/^(?:\+254|254|0)?[71]\d{8}$/.test(g.phone.replace(/[\s()-]/g, ""))) e[`g-phone-${g.key}`] = "Enter a valid Kenyan phone, e.g. 0712 345 678.";
        else if (guardians.some((o) => o.key !== g.key && normalizeKePhone(o.phone) === n)) e[`g-phone-${g.key}`] = "This phone is already connected above.";
        if (!g.relationship.trim()) e[`g-rel-${g.key}`] = "Choose a relationship.";
      });
    }
    return e;
  };

  const focusFirstError = (e: Errors) => {
    requestAnimationFrame(() => {
      const k = Object.keys(e)[0];
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-err="${k}"]`);
      el?.focus(); el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const next = () => {
    if (pending) return;
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length) { focusFirstError(e); return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { if (!pending) { setErrors({}); setStep((s) => Math.max(0, s - 1)); } };
  const goto = (i: number) => {
    if (pending || i === step) return;
    if (i < step) { setErrors({}); setStep(i); return; }
    for (let s = step; s < i; s++) { const e = validate(s); if (Object.keys(e).length) { setStep(s); setErrors(e); focusFirstError(e); return; } }
    setStep(i);
  };

  const payload = (): AdmissionPayload => ({
    ...toPayload(v),
    guardians: guardians.length ? guardians.map((g) => ({ name: g.name.trim(), phone: g.phone.trim(), relationship: g.relationship.trim(), isPrimary: g.isPrimary, receivesNotifications: g.receivesNotifications })) : undefined,
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Only the explicit Save button on the review step persists; Enter elsewhere advances.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    if (step < STEPS.length - 1) { next(); return; }
    if (submitter?.dataset.action !== "save" || pending) return;
    for (let s = 0; s < STEPS.length - 1; s++) { const x = validate(s); if (Object.keys(x).length) { setStep(s); setErrors(x); focusFirstError(x); return; } }
    onSubmit(payload());
  };
  const onKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.tagName === "A") return;
    if (t.closest("[data-enter-local]")) return; // search box handles its own Enter
    e.preventDefault();
    if (step < STEPS.length - 1) next();
  };

  // Guardian helpers
  const upd = (key: string, patch: Partial<GuardianDraft>) => {
    setGuardians((list) => list.map((g) => (g.key === key ? { ...g, ...patch } : patch.isPrimary ? { ...g, isPrimary: false } : g)));
    setErrors((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.endsWith(key) && k !== "guardians")));
  };
  const remove = (key: string) => setGuardians((list) => {
    const n = list.filter((g) => g.key !== key);
    if (n.length && !n.some((g) => g.isPrimary)) n[0] = { ...n[0], isPrimary: true };
    return n;
  });
  const add = (g: Omit<GuardianDraft, "key" | "isPrimary">) => {
    setSkipGuardians(false);
    setErrors((x) => { const n = { ...x }; delete n.guardians; return n; });
    setGuardians((list) => list.length >= MAX_GUARDIANS ? list : [...list, { ...g, key: Math.random().toString(36).slice(2, 9), isPrimary: list.length === 0 }]);
  };

  const gradeName = grades.data?.find((g) => g.id === v.gradeId)?.name;
  const streamName = streams.data?.find((s) => s.id === v.streamId)?.name;
  const last = step === STEPS.length - 1;
  const err = (k: string) => errors[k] ? <span role="alert" className="text-[11px] font-medium text-destructive">{errors[k]}</span> : null;
  const inv = (k: string) => errors[k] ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "";

  return (
    <form ref={rootRef} onSubmit={submit} onKeyDown={onKey} onChange={() => { if (error) onClearError(); }} noValidate aria-busy={pending} className="flex min-h-full flex-col" data-testid="form-admission-wizard">
      {/* Progress */}
      <nav aria-label="Admission steps" className="sticky top-0 z-10 border-b border-border/70 bg-card/95 px-4 pb-3 pt-3 backdrop-blur sm:px-6">
        <ol className="grid grid-cols-4 gap-1.5">
          {STEPS.map((s, i) => {
            const done = i < step, cur = i === step;
            return (
              <li key={s.key}>
                <button type="button" onClick={() => goto(i)} disabled={pending} aria-current={cur ? "step" : undefined} data-testid={`step-${s.key}`}
                  className="group flex w-full min-w-0 flex-col items-start gap-1.5 text-left disabled:cursor-not-allowed">
                  <span className={cn("h-1 w-full rounded-full transition-colors", done ? "bg-primary" : cur ? "bg-sidebar-primary" : "bg-muted")} />
                  <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] font-semibold sm:text-xs", cur ? "text-foreground" : done ? "text-primary" : "text-muted-foreground")}>
                    <span className={cn("hidden h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] min-[400px]:flex", done ? "border-primary bg-primary text-primary-foreground" : cur ? "border-sidebar-primary bg-sidebar-primary/15 text-foreground" : "border-border")}>
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex-1 space-y-5 px-4 py-5 sm:px-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700/80">Step {step + 1} of {STEPS.length}</div>
          <h3 ref={headRef} tabIndex={-1} className="scroll-mt-24 font-display text-xl font-semibold outline-none">
            {["Who is joining?", "Where will they learn?", "Who looks after them?", "Check and save"][step]}
          </h3>
        </div>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Admission no." required className="sm:col-span-2 sm:max-w-xs">
              <TextInput data-testid="input-admission-no" data-err="admissionNo" aria-invalid={!!errors.admissionNo} className={cn("font-mono", inv("admissionNo"))} value={v.admissionNo} onChange={set("admissionNo")} placeholder="ADM/2025/014" autoFocus autoComplete="off" />
              {err("admissionNo")}
            </Field>
            <Field label="First name" required><TextInput data-testid="input-first-name" data-err="firstName" aria-invalid={!!errors.firstName} className={inv("firstName")} value={v.firstName} onChange={set("firstName")} autoComplete="off" autoCapitalize="words" />{err("firstName")}</Field>
            <Field label="Last name" required><TextInput data-testid="input-last-name" data-err="lastName" aria-invalid={!!errors.lastName} className={inv("lastName")} value={v.lastName} onChange={set("lastName")} autoComplete="off" autoCapitalize="words" />{err("lastName")}</Field>
            <Field label="Middle name"><TextInput data-testid="input-middle-name" value={v.middleName} onChange={set("middleName")} autoComplete="off" autoCapitalize="words" /></Field>
            <Field label="Gender"><NativeSelect data-testid="select-gender" value={v.gender} onChange={set("gender")}><option value="">Not set</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></NativeSelect></Field>
            <Field label="Date of birth"><TextInput data-testid="input-dob" data-err="dateOfBirth" type="date" className={inv("dateOfBirth")} value={v.dateOfBirth} onChange={set("dateOfBirth")} />{err("dateOfBirth")}</Field>
            <Field label="UPI" hint="NEMIS unique personal identifier"><TextInput data-testid="input-upi" className="font-mono" value={v.upi} onChange={set("upi")} autoComplete="off" /></Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Grade"><NativeSelect data-testid="select-grade" value={v.gradeId} onChange={set("gradeId")}><option value="">Unassigned</option>{grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect></Field>
              <Field label="Stream"><NativeSelect data-testid="select-stream" disabled={!v.gradeId} value={v.streamId} onChange={set("streamId")}><option value="">{v.gradeId ? "No stream" : "Pick grade first"}</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
              <Field label="Admission date"><TextInput data-testid="input-admission-date" type="date" value={v.admissionDate} onChange={set("admissionDate")} /></Field>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-foreground/80">Boarding</legend>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-input bg-background/60 p-1" role="radiogroup">
                  {Object.values(BoardingStatus).map((b) => (
                    <label key={b} className={cn("flex h-9 cursor-pointer items-center justify-center rounded text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30", v.boardingStatus === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                      <input type="radio" name="boarding" value={b} checked={v.boardingStatus === b} onChange={set("boardingStatus")} className="sr-only" data-testid={`radio-boarding-${b}`} />
                      {b === "day" ? "Day scholar" : "Boarder"}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="border-t border-dashed border-border pt-3">
              <button type="button" aria-expanded={moreOpen} aria-controls="admission-more" onClick={() => setMoreOpen((o) => !o)} data-testid="button-toggle-more-details"
                className="flex w-full items-center justify-between gap-2 py-1 text-left text-sm font-semibold text-primary">
                <span>More details <span className="font-normal text-muted-foreground">· status, pathway, transport</span></span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
              </button>
              <div id="admission-more" className={cn(moreOpen ? "grid" : "hidden", "mt-3 gap-4 sm:grid-cols-3")}>
                <Field label="Status"><NativeSelect data-testid="select-status" value={v.status} onChange={set("status")}>{Object.values(StudentStatus).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</NativeSelect></Field>
                <Field label="Pathway" hint="Senior school CBC pathway"><TextInput data-testid="input-pathway" maxLength={100} value={v.pathway} onChange={set("pathway")} placeholder="STEM" /></Field>
                <Field label="Transport route ref."><TextInput data-testid="input-transport-route" maxLength={100} className="font-mono" value={v.transportRouteId} onChange={set("transportRouteId")} /></Field>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">Guardians are linked when you save. A phone number already on file connects that guardian; their details are not changed.</p>
            {canSearchGuardians && <GuardianPicker taken={guardians} disabled={pending || guardians.length >= MAX_GUARDIANS}
              onPick={(g) => add({ source: "existing", guardianId: g.id, name: g.name, phone: g.phone, relationship: g.relationship && RELATIONSHIPS.includes(g.relationship) ? g.relationship : "Guardian", receivesNotifications: true })} />}

            {guardians.length > 0 && (
              <ul className="divide-y divide-border/70 border-y border-border/70" data-testid="list-wizard-guardians">
                {guardians.map((g) => (
                  <li key={g.key} className="space-y-3 py-4" data-testid={`wizard-guardian-${g.key}`}>
                    <div className="flex items-start gap-3">
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", g.source === "existing" ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground")}>{g.name.trim() ? initials(g.name) : <UserPlus className="h-4 w-4" />}</span>
                      <div className="min-w-0 flex-1">
                        {g.source === "existing" ? (<>
                          <div className="truncate text-sm font-semibold">{g.name}</div>
                          <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground"><Phone className="h-3 w-3" />{g.phone}<span className="ml-1 font-sans">· on file</span></div>
                        </>) : <div className="text-sm font-semibold">New guardian</div>}
                      </div>
                      <button type="button" aria-label={`Remove ${g.name || "guardian"}`} onClick={() => remove(g.key)} disabled={pending} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {g.source === "new" && <>
                        <Field label="Full name" required><TextInput data-err={`g-name-${g.key}`} data-testid="input-guardian-name" className={inv(`g-name-${g.key}`)} value={g.name} maxLength={160} onChange={(e) => upd(g.key, { name: e.target.value })} autoCapitalize="words" autoComplete="off" />{err(`g-name-${g.key}`)}</Field>
                        <Field label="Phone" required><TextInput data-err={`g-phone-${g.key}`} data-testid="input-guardian-phone" type="tel" inputMode="tel" className={cn("font-mono", inv(`g-phone-${g.key}`))} value={g.phone} maxLength={20} onChange={(e) => upd(g.key, { phone: e.target.value })} placeholder="0712 345 678" />{err(`g-phone-${g.key}`)}</Field>
                      </>}
                      <Field label="Relationship" required><NativeSelect data-err={`g-rel-${g.key}`} data-testid="select-guardian-rel" value={g.relationship} onChange={(e) => upd(g.key, { relationship: e.target.value })}>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}</NativeSelect>{err(`g-rel-${g.key}`)}</Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30", g.isPrimary ? "border-sidebar-primary bg-sidebar-primary/15 text-foreground" : "border-input text-muted-foreground")}>
                        <input type="radio" name="primary-guardian" className="sr-only" checked={g.isPrimary} onChange={() => upd(g.key, { isPrimary: true })} data-testid="radio-guardian-primary" />
                        <Star className={cn("h-3.5 w-3.5", g.isPrimary && "fill-sidebar-primary text-amber-700")} />{g.isPrimary ? "Primary guardian" : "Make primary"}
                      </label>
                      <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30", g.receivesNotifications ? "border-primary/40 bg-primary/5 text-primary" : "border-input text-muted-foreground")}>
                        <input type="checkbox" className="sr-only" checked={g.receivesNotifications} onChange={(e) => upd(g.key, { receivesNotifications: e.target.checked })} data-testid="checkbox-guardian-notify" />
                        {g.receivesNotifications ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}Receives messages
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Btn type="button" variant="outline" disabled={pending || guardians.length >= MAX_GUARDIANS} data-testid="button-wizard-new-guardian"
                onClick={() => { add({ source: "new", name: "", phone: "", relationship: "Mother", receivesNotifications: true }); requestAnimationFrame(() => { const els = rootRef.current?.querySelectorAll<HTMLInputElement>('[data-testid="input-guardian-name"]'); els?.[els.length - 1]?.focus(); }); }}>
                <Plus className="h-4 w-4" />Add new guardian
              </Btn>
              {guardians.length >= MAX_GUARDIANS && <span className="text-xs text-muted-foreground">Up to {MAX_GUARDIANS} guardians.</span>}
            </div>

            {!guardians.length && (
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-dashed border-border px-3 py-3 text-sm">
                <input type="checkbox" data-err="guardians" data-testid="checkbox-skip-guardians" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={skipGuardians} onChange={(e) => { setSkipGuardians(e.target.checked); setErrors((x) => { const n = { ...x }; delete n.guardians; return n; }); }} />
                <span><span className="font-semibold">Add guardians later</span><span className="block text-xs text-muted-foreground">The learner is saved without a guardian. Link one from their record.</span></span>
              </label>
            )}
            {err("guardians")}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6" data-testid="wizard-review">
            <ReviewBlock title="Learner" onEdit={() => goto(0)} disabled={pending} rows={[
              ["Name", [v.firstName, v.middleName, v.lastName].filter((x) => x.trim()).join(" ")], ["Admission no.", v.admissionNo, true], ["Gender", v.gender ? v.gender[0].toUpperCase() + v.gender.slice(1) : "Not set"],
              ["Date of birth", v.dateOfBirth || "Not set"], ["UPI", v.upi || "Not set", true],
            ]} />
            <ReviewBlock title="Placement" onEdit={() => goto(1)} disabled={pending} rows={[
              ["Class", gradeName ? `${gradeName}${streamName ? " · " + streamName : ""}` : "Unassigned"], ["Boarding", v.boardingStatus === "day" ? "Day scholar" : "Boarder"],
              ["Admitted", v.admissionDate || "Not set"], ["Status", v.status[0].toUpperCase() + v.status.slice(1)],
              ...(v.pathway ? [["Pathway", v.pathway] as [string, string]] : []), ...(v.transportRouteId ? [["Transport", v.transportRouteId, true] as [string, string, boolean]] : []),
            ]} />
            <section>
              <div className="mb-2 flex items-center justify-between border-b border-border/70 pb-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Guardians</h4>
                <button type="button" disabled={pending} onClick={() => goto(2)} className="text-xs font-semibold text-primary hover:underline">Edit</button>
              </div>
              {!guardians.length ? (
                <div className="flex items-center gap-2 rounded-md bg-accent/50 px-3 py-2.5 text-sm text-accent-foreground"><Users className="h-4 w-4" />No guardian connected. You can link one from the learner record.</div>
              ) : (
                <ul className="space-y-2">{guardians.map((g) => (
                  <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">{g.name}</span><span className="font-mono text-xs text-muted-foreground">{g.phone}</span>
                    <span className="text-xs text-muted-foreground">{g.relationship} · {g.source === "existing" ? "on file" : "new"}{g.isPrimary ? " · primary" : ""}{g.receivesNotifications ? " · messages" : " · no messages"}</span>
                  </li>
                ))}</ul>
              )}
            </section>
          </div>
        )}
        <FormError msg={error} />
      </div>

      {/* Footer */}
      <div className="form-actions sticky bottom-0 z-10 mt-auto flex items-center gap-2 border-t border-border bg-card px-4 py-3 sm:px-6">
        {step === 0
          ? <Btn type="button" variant="ghost" onClick={onCancel} disabled={pending} data-testid="button-cancel">Cancel</Btn>
          : <Btn type="button" variant="outline" onClick={back} disabled={pending} data-testid="button-wizard-back"><ChevronLeft className="h-4 w-4" />Back</Btn>}
        <span className="hidden flex-1 text-xs text-muted-foreground sm:block">{last ? "Nothing is saved until you press Save." : "Press Enter to continue."}</span>
        {last
          ? <Btn key="save" type="submit" data-action="save" disabled={pending} data-testid="button-save-student" className="sm:ml-auto">{pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? "Saving" : "Save student"}</Btn>
          : <Btn key="next" type="button" onClick={(e) => { e.preventDefault(); next(); }} disabled={pending} data-testid="button-wizard-next" className="sm:ml-auto">Next<ChevronRight className="h-4 w-4" /></Btn>}
      </div>
    </form>
  );
}

function ReviewBlock({ title, rows, onEdit, disabled }: { title: string; rows: [string, string, boolean?][]; onEdit: () => void; disabled: boolean }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between border-b border-border/70 pb-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h4>
        <button type="button" disabled={disabled} onClick={onEdit} className="text-xs font-semibold text-primary hover:underline">Edit</button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map(([k, val, mono]) => (
          <div key={k} className="min-w-0"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className={cn("text-sm font-medium [overflow-wrap:anywhere]", mono && "font-mono")}>{val}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function GuardianPicker({ taken, onPick, disabled }: { taken: GuardianDraft[]; onPick: (g: { id: string; name: string; phone: string; relationship?: string | null }) => void; disabled: boolean }) {
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const params = q ? { search: q } : undefined;
  const list = useListGuardians(params, { query: { queryKey: getListGuardiansQueryKey(params), enabled: q.length >= 2 } });
  const takenPhones = useMemo(() => new Set(taken.map((g) => normalizeKePhone(g.phone)).filter(Boolean)), [taken]);
  const results = (list.data ?? []).filter((g) => !g.anonymizedAt).slice(0, 8);

  return (
    <div data-enter-local className="space-y-2">
      <label className="text-xs font-semibold text-foreground/80" htmlFor="wizard-guardian-search">Find a guardian on file</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <TextInput id="wizard-guardian-search" data-testid="input-wizard-guardian-search" type="search" className="pl-9" placeholder="Name or phone, e.g. Wanjiru or 0722" value={term} disabled={disabled}
          onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} autoComplete="off" aria-controls="wizard-guardian-results" />
      </div>
      {q.length >= 2 && (
        <ul id="wizard-guardian-results" aria-live="polite" className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
          {list.isLoading ? <li className="space-y-2 px-3 py-3"><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /></li>
            : list.isError ? <li className="flex items-center justify-between px-3 py-3 text-sm text-destructive">Could not search guardians.<button type="button" className="text-xs font-semibold underline" onClick={() => list.refetch()}>Retry</button></li>
            : !results.length ? <li className="px-3 py-3 text-sm text-muted-foreground">No guardian matches "{q}". Add them as a new guardian below.</li>
            : results.map((g) => {
              const added = takenPhones.has(normalizeKePhone(g.phone));
              return (
                <li key={g.id}>
                  <button type="button" disabled={added || disabled} onClick={() => { onPick(g); setTerm(""); }} data-testid={`button-pick-guardian-${g.id}`}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted disabled:cursor-default disabled:opacity-60">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(g.name)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{g.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{g.phone}{g.studentNames.length ? <span className="font-sans"> · {g.studentNames.slice(0, 2).join(", ")}{g.studentNames.length > 2 ? ` +${g.studentNames.length - 2}` : ""}</span> : null}</span></span>
                    <span className="shrink-0 text-xs font-semibold text-primary">{added ? "Added" : "Connect"}</span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
