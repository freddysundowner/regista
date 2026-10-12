import { useEffect, useMemo, useState, useRef } from "react";
import { NoLearnersNotice, useHasLearners } from "@/components/no-learners";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSchool, getGetSchoolQueryKey, useListAcademicYears, useListTerms, useListGrades, useListStreams, useListUsers,
  useCreateAcademicYear, useCreateTerm, useUpdateTerm, useCreateGrade, useCreateStream,
  useCreateFinanceRecord, useDeleteFinanceRecord, usePreviewFinanceInvoices, useCommitFinanceInvoices,
  getListAcademicYearsQueryKey, getListTermsQueryKey, getListGradesQueryKey, getListStreamsQueryKey, getListUsersQueryKey,
  type Term, type Grade, type FinanceRecord, type InvoiceBatchResult, type LevelBand,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Loader2, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { PageHeader, Panel, Btn, Field, TextInput, FormError, SkeletonRows, Pill } from "@/components/kit";
import { StepAction } from "@/components/step-action";
import { useFinanceRecords } from "@/components/finance-kit";
import { kes, recLines, rd, sumMoney, useFinanceInvalidate } from "@/lib/finance";
import { useAuthSession, errMsg, fmtDate } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";
import { FeeItemEdit } from "@/pages/fees";
import { PromotionsPanel } from "@/components/promotions";
import { cn } from "@/lib/utils";

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Usual Kenyan three-term pattern; schools adjust to the Ministry's published calendar. */
const defaultTerms = (y: number) => [
  { name: "Term 1", startDate: `${y}-01-05`, endDate: `${y}-04-03` },
  { name: "Term 2", startDate: `${y}-04-27`, endDate: `${y}-07-31` },
  { name: "Term 3", startDate: `${y}-08-24`, endDate: `${y}-10-30` },
];
const PRESETS: { band: LevelBand; label: string; grades: string[] }[] = [
  { band: "pre_primary", label: "Pre-primary", grades: ["PP1", "PP2"] },
  { band: "lower_primary", label: "Lower primary", grades: ["Grade 1", "Grade 2", "Grade 3"] },
  { band: "upper_primary", label: "Upper primary", grades: ["Grade 4", "Grade 5", "Grade 6"] },
  { band: "junior", label: "Junior school", grades: ["Grade 7", "Grade 8", "Grade 9"] },
  { band: "senior", label: "Senior school", grades: ["Grade 10", "Grade 11", "Grade 12"] },
];
const BANDS_FOR: Record<string, LevelBand[]> = {
  primary: ["pre_primary", "lower_primary", "upper_primary"], junior: ["junior"], senior: ["senior"],
  comprehensive: ["pre_primary", "lower_primary", "upper_primary", "junior"],
};

function useCalendar() {
  const years = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const year = years.data?.find((y) => y.isCurrent) ?? null;
  const yearTerms = [...(terms.data ?? [])].filter((t) => t.academicYearId === year?.id).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const current = terms.data?.find((t) => t.isCurrent) ?? null;
  return { years, terms, year, yearTerms, current, loading: years.isLoading || terms.isLoading };
}

/** What the school should do now, judged from the calendar: start the next term, or the next year. */
export function useTermStatus() {
  const { year, yearTerms, current, loading } = useCalendar();
  if (loading) return null;
  const t = today();
  if (!year || !yearTerms.length) return { kind: "no-year" as const };
  if (!current) return { kind: "pick-term" as const, next: yearTerms.find((x) => x.endDate >= t) ?? yearTerms[0] };
  if (current.endDate >= t) return { kind: "in-term" as const, current, endsSoon: current.endDate <= addDays(t, 7) };
  const next = yearTerms.find((x) => x.startDate > current.startDate);
  return next ? { kind: "term-ended" as const, current, next } : { kind: "year-ended" as const, current, yearName: year.name };
}

/** Banner on the overview and the setup page when a term has ended or none is current. */
export function TermPrompt() {
  const status = useTermStatus();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const update = useUpdateTerm();
  const { toast } = useToast();
  if (!status || status.kind === "in-term" && !status.endsSoon || status.kind === "no-year") return null;
  const start = (term: Term) => update.mutate({ termId: term.id, data: { isCurrent: true } }, {
    onSuccess: () => { void qc.invalidateQueries({ queryKey: getListTermsQueryKey() }); toast({ title: `${term.name} started` }); navigate("/fee-structure"); },
    onError: (x) => toast({ title: "Could not start the term", description: errMsg(x) }),
  });
  const box = "mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-sm";
  if (status.kind === "in-term") return (
    <div className={box} data-testid="term-prompt"><CalendarDays className="h-5 w-5 text-amber-700" />
      <span className="min-w-0 flex-1"><b>{status.current.name} ends {fmtDate(status.current.endDate)}.</b> Next term's fees and invoices can be prepared now.</span>
      <Link href="/fee-structure" className="font-semibold text-primary hover:underline">Prepare next term</Link>
    </div>
  );
  if (status.kind === "year-ended") return (
    <div className={box} data-testid="term-prompt"><CalendarDays className="h-5 w-5 text-amber-700" />
      <span className="min-w-0 flex-1"><b>The {status.yearName} school year has ended.</b> Set up the new year, then move learners up a grade.</span>
      <Link href="/term-setup?step=calendar&new=1" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">Start the new year<ArrowRight className="h-3.5 w-3.5" /></Link>
    </div>
  );
  const next = status.next;
  return (
    <div className={box} data-testid="term-prompt"><CalendarDays className="h-5 w-5 text-amber-700" />
      <span className="min-w-0 flex-1">{status.kind === "term-ended" ? <><b>{status.current.name} has ended.</b> Start {next.name} to bill learners and take attendance for it.</> : <><b>No term is open.</b> Choose the term you're in.</>}</span>
      <Btn className="h-8 px-3 text-xs" disabled={update.isPending} onClick={() => start(next)} data-testid="button-start-term">{update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Start {next.name}<ArrowRight className="h-3.5 w-3.5" /></Btn>
    </div>
  );
}

// ---------- Step 1: school year and terms ----------
/** `embedded`: inside the first-time setup flow, whose footer moves between steps. */
export function CalendarStep({ onNext, forceNew, embedded = false }: { onNext: () => void; forceNew: boolean; embedded?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cal = useCalendar();
  const createYear = useCreateAcademicYear();
  const createTerm = useCreateTerm();
  const updateTerm = useUpdateTerm();
  const lastYear = Math.max(0, ...(cal.years.data ?? []).map((y) => Number(y.name.match(/\d{4}/)?.[0] ?? 0)));
  const now = new Date();
  const suggested = lastYear ? lastYear + 1 : now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
  const creating = forceNew || !cal.year;
  const [yearName, setYearName] = useState(String(suggested));
  const [rows, setRows] = useState(() => defaultTerms(suggested));
  const [edits, setEdits] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const [editing, setEditing] = useState(false);
  // The term the school says it is in now; defaults to the one today falls in (or the next, during a holiday).
  const [chosenTerm, setChosenTerm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // A second tap can land before the button has had time to grey out; this stops it starting a second save.
  const saving = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (creating) { setYearName(String(suggested)); setRows(defaultTerms(suggested)); } }, [creating, suggested]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: getListAcademicYearsQueryKey() }); void qc.invalidateQueries({ queryKey: getListTermsQueryKey() }); };

  if (cal.loading) return <SkeletonRows rows={3} cols={3} />;
  const create = async (current?: number) => {
    setErr(null);
    if (rows.some((r) => !r.startDate || !r.endDate || r.endDate <= r.startDate)) return setErr("Each term needs an end date after its start date.");
    if (rows.some((r, i) => i > 0 && r.startDate <= rows[i - 1].endDate)) return setErr("Terms can't overlap. Each term must start after the previous one ends.");
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const y = await createYear.mutateAsync({ data: { name: yearName.trim(), startDate: rows[0].startDate, endDate: rows[rows.length - 1].endDate, isCurrent: true } });
      const t = today();
      const currentIndex = current ?? Math.max(0, rows.findIndex((r) => r.endDate >= t));
      for (const [i, r] of rows.entries()) await createTerm.mutateAsync({ data: { academicYearId: y.id, name: r.name, startDate: r.startDate, endDate: r.endDate, isCurrent: i === currentIndex } });
      refresh(); toast({ title: `${yearName} school year created`, description: `${rows[currentIndex].name} is the current term.` });
      onNext();
    } catch (x) { setErr(errMsg(x)); refresh(); } finally { saving.current = false; setBusy(false); }
  };
  const saveEdits = async () => {
    setErr(null); setBusy(true);
    try {
      for (const [termId, d] of Object.entries(edits)) await updateTerm.mutateAsync({ termId, data: d });
      setEdits({}); refresh(); toast({ title: "Term dates saved" });
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const makeCurrent = (t: Term) => updateTerm.mutate({ termId: t.id, data: { isCurrent: true } }, { onSuccess: () => { refresh(); toast({ title: `${t.name} is now the current term` }); }, onError: (x) => setErr(errMsg(x)) });

  if (creating && embedded) {
    const short = (d: string) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
    const todayIndex = Math.max(0, rows.findIndex((r) => r.endDate >= today()));
    const picked = chosenTerm ?? todayIndex;
    const term = rows[picked];
    const setDate = (k: "startDate" | "endDate", v: string) => setRows(rows.map((x, j) => j === picked ? { ...x, [k]: v } : x));
    const prev = rows[picked - 1], next = rows[picked + 1];
    // Checked as the dates change, so a problem shows beside the fields rather than only on Continue.
    const problem = !term.startDate || !term.endDate ? "Choose both dates." : term.endDate <= term.startDate ? `${term.name} must close after it opens.`
      : prev && term.startDate <= prev.endDate ? `${term.name} must open after ${prev.name} closes (${short(prev.endDate)}).`
      : next && term.endDate >= next.startDate ? `${term.name} must close before ${next.name} opens (${short(next.startDate)}).` : null;
    const weeks = !problem ? Math.round(daysBetween(term.startDate, term.endDate) / 7) : null;
    // iPhones draw a date field wider than its box unless its own look is switched off.
    const dateCls = "h-12 w-full min-w-0 max-w-full appearance-none rounded-xl text-base max-md:h-11 max-md:px-3 max-md:text-[15px]";
    return (
      <div className="space-y-5 max-md:space-y-3">
        {/* On a phone the three terms sit side by side, so the dates are on screen without scrolling. */}
        <div role="radiogroup" aria-label="Current term" className="grid gap-3 max-md:grid-cols-3 max-md:gap-2 sm:grid-cols-3" data-testid="pick-current-term">
          {rows.map((r, i) => (
            <button key={i} type="button" role="radio" aria-checked={picked === i} onClick={() => setChosenTerm(i)} data-testid={`term-choice-${i + 1}`}
              className={cn("rounded-2xl border-2 px-6 py-6 text-left transition max-md:rounded-xl max-md:px-2 max-md:py-3 max-md:text-center", picked === i ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
              <span className="block text-2xl font-semibold max-md:text-base">{r.name}</span>
            </button>
          ))}
        </div>
        <section className="rounded-2xl border border-border bg-card p-5 max-md:rounded-xl max-md:p-4 sm:p-6" aria-label={`${term.name} dates`} data-testid="term-dates">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 max-md:mb-3">
            <h3 className="text-lg font-semibold max-md:text-base">{term.name} dates</h3>
            {weeks !== null && <span className="text-sm text-muted-foreground">{weeks} weeks</span>}
          </div>
          <div className="grid gap-4 max-md:grid-cols-2 max-md:gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Opens"><TextInput type="date" className={dateCls} data-testid="input-term-start" value={term.startDate} max={term.endDate || undefined} onChange={(e) => setDate("startDate", e.target.value)} /></Field>
            <Field label="Closes"><TextInput type="date" className={dateCls} data-testid="input-term-end" value={term.endDate} min={term.startDate || undefined} onChange={(e) => setDate("endDate", e.target.value)} /></Field>
          </div>
          {problem && <p className="mt-3 text-sm text-destructive" role="alert">{problem}</p>}
        </section>
        <FormError msg={err} />
        <StepAction><Btn data-testid="button-create-year" disabled={busy || !!problem} onClick={() => create(picked)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Continue</Btn></StepAction>
      </div>
    );
  }
  if (creating) return (
    <div className="space-y-5">
      <Field label="School year" className="max-w-xs"><TextInput data-testid="input-year-name" value={yearName} onChange={(e) => setYearName(e.target.value)} /></Field>
      <div className="overflow-hidden rounded-xl border border-border">
        {rows.map((r, i) => (
          <div key={i} className="grid items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0 sm:grid-cols-[8rem_1fr_1fr]">
            <TextInput value={r.name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="font-semibold" />
            <label className="text-xs text-muted-foreground">Opens<TextInput type="date" value={r.startDate} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, startDate: e.target.value } : x))} /></label>
            <label className="text-xs text-muted-foreground">Closes<TextInput type="date" value={r.endDate} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, endDate: e.target.value } : x))} /></label>
          </div>
        ))}
      </div>
      <FormError msg={err} />
      <StepAction><Btn data-testid="button-create-year" disabled={busy || yearName.trim().length < 2} onClick={() => create()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{embedded ? "Save these dates" : `Create ${yearName} and its terms`}</Btn></StepAction>
      {forceNew && <p className="text-sm text-muted-foreground">After this, move learners up a grade under <b>Year-end promotion</b> below.</p>}
    </div>
  );
  if (!editing) return (
    <div className="space-y-5">
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border" data-testid="calendar-summary">
        {cal.yearTerms.map((t) => (
          <li key={t.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", t.isCurrent && "bg-primary/5")}>
            <span className="w-20 font-semibold max-md:w-auto max-md:flex-1">{t.name}</span>
            <span className="min-w-0 flex-1 text-sm max-md:order-3 max-md:basis-full max-md:text-[13px]">{day(t.startDate)} <span className="text-muted-foreground">to</span> {day(t.endDate)} <span className="text-muted-foreground">· {Math.round(daysBetween(t.startDate, t.endDate) / 7)} weeks</span></span>
            {t.isCurrent ? <Pill tone="active">term in progress</Pill> : t.endDate < today() ? <span className="text-xs text-muted-foreground">finished</span> : <span className="text-xs text-muted-foreground">upcoming</span>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {!embedded && <Btn onClick={onNext} data-testid="button-step-next">Next: classes<ArrowRight className="h-4 w-4" /></Btn>}
        <Btn variant="ghost" onClick={() => setEditing(true)} data-testid="button-change-dates">Change dates</Btn>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Change a term's dates, or choose which term is in progress now.</p>
      <div className="overflow-hidden rounded-xl border border-border">
        {cal.yearTerms.map((t) => {
          const e = edits[t.id] ?? { startDate: t.startDate, endDate: t.endDate };
          const set = (k: "startDate" | "endDate", v: string) => setEdits({ ...edits, [t.id]: { ...e, [k]: v } });
          return (
            <div key={t.id} className="grid items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0 sm:grid-cols-[8rem_1fr_1fr_9rem]">
              <div className="font-semibold">{t.name}</div>
              <label className="text-xs text-muted-foreground">Opens<TextInput type="date" value={e.startDate} onChange={(x) => set("startDate", x.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Closes<TextInput type="date" value={e.endDate} onChange={(x) => set("endDate", x.target.value)} /></label>
              <div className="sm:text-right">{t.isCurrent ? <Pill tone="active">in progress</Pill> : <button type="button" onClick={() => makeCurrent(t)} className="text-xs font-semibold text-primary hover:underline">Set as in progress</button>}</div>
            </div>
          );
        })}
      </div>
      <FormError msg={err} />
      <div className="flex flex-wrap gap-3">
        <Btn disabled={busy} onClick={async () => { if (Object.keys(edits).length) await saveEdits(); setEditing(false); }} data-testid="button-save-dates">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Done</Btn>
        <Btn variant="ghost" onClick={() => { setEdits({}); setEditing(false); }}>Cancel</Btn>
      </div>
    </div>
  );
}

/** Next default name: the next letter after single-letter streams (A, B → C), otherwise blank to type. */
const nextStream = (names: string[]) => names.every((x) => /^[A-Z]$/.test(x)) ? String.fromCharCode(Math.max(64, ...names.map((x) => x.charCodeAt(0))) + 1).replace(/[^A-Z]/, "") : "";

/** A grade's streams as chips: type in a chip to rename it, × removes it, "+ stream" adds one. */
function StreamChips({ names, onChange, testid }: { names: string[]; onChange: (v: string[]) => void; testid: string }) {
  const dup = (i: number) => names[i].trim() !== "" && names.findIndex((x) => x.trim().toLowerCase() === names[i].trim().toLowerCase()) !== i;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testid}>
      {names.map((n, i) => (
        <span key={i} className={cn("inline-flex h-9 items-center rounded-full border bg-background pl-3 pr-1 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15", dup(i) ? "border-destructive" : "border-border")}>
          <input aria-label={`Stream ${i + 1}`} value={n} placeholder="Name" size={Math.max(3, n.length + 1)} maxLength={40} autoFocus={n === "" && i === names.length - 1}
            onChange={(e) => onChange(names.map((x, j) => j === i ? e.target.value : x))}
            onBlur={() => { if (!n.trim() && names.length > 1) onChange(names.filter((_, j) => j !== i)); }}
            className="bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground" />
          <button type="button" aria-label={`Remove stream ${n || i + 1}`} disabled={names.length === 1} onClick={() => onChange(names.filter((_, j) => j !== i))}
            className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
        </span>
      ))}
      <button type="button" onClick={() => onChange([...names, nextStream(names.map((x) => x.trim()))])} disabled={names.length >= 12}
        className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />stream</button>
    </div>
  );
}

// ---------- Step 2: grades and streams ----------
export function ClassesStep({ onNext, embedded = false }: { onNext: () => void; embedded?: boolean }) {
  const s = useAuthSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const createGrade = useCreateGrade();
  const createStream = useCreateStream();
  const existing = useMemo(() => new Map((grades.data ?? []).map((g) => [g.name.toLowerCase(), g])), [grades.data]);
  const [bands, setBands] = useState<LevelBand[]>(() => BANDS_FOR[s.school?.type ?? ""] ?? []);
  // Streams every grade gets, unless a grade is given its own.
  const [allStreams, setAllStreams] = useState(["A"]);
  const [perGrade, setPerGrade] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (grades.isLoading || streams.isLoading) return <SkeletonRows rows={3} cols={3} />;
  const wanted = PRESETS.flatMap((p, pi) => bands.includes(p.band) ? p.grades.map((name, gi) => ({ name, band: p.band, order: PRESETS.slice(0, pi).reduce((n, x) => n + x.grades.length, 0) + gi + 1 })) : []);
  const streamsOf = (gradeId: string) => (streams.data ?? []).filter((x) => x.gradeId === gradeId);
  // Grades that already have classes are left as they are; only the rest are created or filled.
  const setUp = (name: string) => { const g = existing.get(name.toLowerCase()); return g ? streamsOf(g.id) : []; };
  const toCreate = wanted.filter((w) => !setUp(w.name).length);
  const namesFor = (grade: string) => [...new Set((perGrade[grade] ?? allStreams).map((x) => x.trim()).filter(Boolean))];
  const classCount = toCreate.reduce((n, w) => n + namesFor(w.name).length, 0);
  const add = async () => {
    setErr(null);
    const empty = toCreate.find((w) => !namesFor(w.name).length);
    if (empty) return setErr(`${empty.name} needs at least one stream, such as A.`);
    setBusy(true);
    try {
      let made = 0, madeStreams = 0;
      for (const w of toCreate) {
        let g: Grade | undefined = existing.get(w.name.toLowerCase());
        if (!g) { g = await createGrade.mutateAsync({ data: { name: w.name, levelBand: w.band, order: w.order } }); made++; }
        for (const name of namesFor(w.name)) { await createStream.mutateAsync({ data: { gradeId: g.id, name } }); madeStreams++; }
      }
      void qc.invalidateQueries({ queryKey: getListGradesQueryKey() }); void qc.invalidateQueries({ queryKey: getListStreamsQueryKey() });
      toast({ title: "Classes ready", description: `${made} grade(s) and ${madeStreams} class(es) added.` });
      setAdding(false);
      // In first-time setup, move straight on rather than waiting for the guide to notice the new classes.
      if (embedded) onNext();
    } catch (x) { setErr(errMsg(x)); void qc.invalidateQueries({ queryKey: getListGradesQueryKey() }); void qc.invalidateQueries({ queryKey: getListStreamsQueryKey() }); } finally { setBusy(false); }
  };
  const sorted = [...(grades.data ?? [])].sort((a, b) => a.order - b.order);
  if (sorted.length && !adding) return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="classes-summary">
        {sorted.map((g) => <div key={g.id} className="rounded-lg border border-border px-3 py-2 text-sm"><div className="font-semibold">{g.name}</div><div className="text-xs text-muted-foreground">{streamsOf(g.id).map((x) => x.name).join(", ") || "No classes yet"} · {g.studentCount} learner{g.studentCount === 1 ? "" : "s"}</div></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!embedded && <Btn onClick={onNext} data-testid="button-step-next">Next: fees<ArrowRight className="h-4 w-4" /></Btn>}
        <Btn variant="ghost" onClick={() => setAdding(true)} data-testid="button-add-more-classes"><Plus className="h-4 w-4" />Add more classes</Btn>
        {!embedded && <Link href="/classes" className="text-xs font-semibold text-primary hover:underline">Rename classes or assign class teachers</Link>}
      </div>
    </div>
  );
  return (
    <div className="space-y-6">
      <div role="group" aria-label="Levels" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="pick-levels">
        {PRESETS.map((p) => {
          const on = bands.includes(p.band);
          return (
            <button key={p.band} type="button" aria-pressed={on} onClick={() => setBands(on ? bands.filter((b) => b !== p.band) : [...bands, p.band])} data-testid={`band-${p.band}`}
              className={cn("relative rounded-2xl border-2 px-4 py-3 text-left transition sm:px-5 sm:py-4", on ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
              {on && <Check className="absolute right-3 top-3 h-4 w-4 text-primary" strokeWidth={3} />}
              <span className="block pr-5 text-sm font-semibold sm:text-base">{p.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{p.grades[0]}–{p.grades[p.grades.length - 1].replace("Grade ", "")}</span>
            </button>
          );
        })}
      </div>

      {wanted.length > 0 && (
        <section className="rounded-2xl border border-border bg-card" aria-label="Streams in each grade" data-testid="grade-streams">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-5 py-4">
            <div className="min-w-[8rem]"><div className="text-sm font-semibold">All grades</div><div className="text-xs text-muted-foreground">Applies to every grade below</div></div>
            <StreamChips names={allStreams} onChange={(v) => { setAllStreams(v); setPerGrade({}); }} testid="streams-all" />
          </div>
          <ul className="divide-y divide-border/60">
            {wanted.map((w) => {
              const have = setUp(w.name);
              return (
                <li key={w.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3" data-testid={`grade-row-${w.name}`}>
                  <span className="w-24 shrink-0 text-sm font-medium">{w.name}</span>
                  {have.length ? <span className="text-sm text-muted-foreground">{have.map((x) => x.name).join(", ")} · already set up</span>
                    : <StreamChips names={perGrade[w.name] ?? allStreams} onChange={(v) => setPerGrade({ ...perGrade, [w.name]: v })} testid={`streams-${w.name}`} />}
                  {perGrade[w.name] && !have.length && <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => { const { [w.name]: _, ...rest } = perGrade; setPerGrade(rest); }}>Same as all grades</button>}
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border/60 px-5 py-3 text-sm text-muted-foreground" data-testid="classes-total">
            {toCreate.length ? <><b className="text-foreground">{toCreate.length} grade{toCreate.length === 1 ? "" : "s"} · {classCount} class{classCount === 1 ? "" : "es"}</b> will be created. Tap a stream to rename it.</> : "Every selected grade is already set up."}
          </p>
        </section>
      )}
      <FormError msg={err} />
      <div className="flex flex-wrap gap-3">
        <StepAction><Btn data-testid="button-add-classes" disabled={busy || !toCreate.length} onClick={add}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}<Plus className="h-4 w-4" />{toCreate.length ? `Add ${classCount} class${classCount === 1 ? "" : "es"}` : "Add classes"}</Btn></StepAction>
        {sorted.length > 0 && <Btn variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn>}
      </div>
    </div>
  );
}

/** A yes/no choice as a card with a switch: the title says the option, the detail what it means right now. */
function OptionCard({ checked, onChange, title, detail, testid }: { checked: boolean; onChange: (v: boolean) => void; title: string; detail: string; testid: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-4 rounded-2xl border-2 px-5 py-4 transition", checked ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{detail}</span></span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span aria-hidden="true" className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-muted transition peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

// ---------- Step 3: fees as one table ----------
/** `termId`/`onTermId` let a page follow which term the table shows (the Fee structure page prints it). */
export function FeesStep({ onNext, embedded = false, termId: shownTerm, onTermId }: { onNext: () => void; embedded?: boolean; termId?: string; onTermId?: (id: string) => void }) {
  const s = useAuthSession();
  const { toast } = useToast();
  const invalidate = useFinanceInvalidate();
  const cal = useCalendar();
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const items = useFinanceRecords({ kind: "fee_item" });
  const structures = useFinanceRecords({ kind: "fee_structure" });
  // Until anyone is billed, saved fees apply at once; afterwards a second person approves changes.
  const billed = useFinanceRecords({ kind: "invoice", page: 1, pageSize: 1 });
  const schoolQ = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  const needsApproval = (billed.data?.length ?? 0) > 0 && schoolQ.data?.settings?.requireSecondApproval !== false;
  const create = useCreateFinanceRecord();
  const remove = useDeleteFinanceRecord();
  const [ownTerm, setOwnTerm] = useState("");
  const termId = shownTerm ?? ownTerm;
  const setTermId = onTermId ?? setOwnTerm;
  const [everyTerm, setEveryTerm] = useState(true);
  const [boarding, setBoarding] = useState<boolean | null>(null);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [editing, setEditing] = useState<FinanceRecord | null>(null);
  const [loc] = useLocation();
  const onFeeSetup = loc === "/fee-structure"; // optional charges sit right below the table there
  const term = cal.yearTerms.find((t) => t.id === termId) ?? cal.current ?? cal.yearTerms[0];
  const feeItems = [...(items.data ?? [])].filter((r) => r.status === "active" && !r.data?.isOptional).sort((a, b) => Number(a.data?.priority ?? 0) - Number(b.data?.priority ?? 0));
  const gradeList = [...(grades.data ?? [])].sort((a, b) => a.order - b.order);
  // With boarders, each grade has a Day and a Boarder amount; otherwise one amount applies to everyone.
  const hasBoarding = boarding ?? (structures.data ?? []).some((r) => r.status !== "archived" && !!rd(r, "boardingStatus"));
  type Variant = "" | "day" | "boarder";
  const cols = gradeList.flatMap((g): { g: Grade; v: Variant; key: string }[] => hasBoarding
    ? [{ g, v: "day", key: `${g.id}:day` }, { g, v: "boarder", key: `${g.id}:boarder` }]
    : [{ g, v: "", key: `${g.id}:` }]);
  const find = (tId: string, gId: string, v: Variant, status: string) => (structures.data ?? []).find((r: FinanceRecord) => r.termId === tId && rd(r, "gradeId") === gId && (rd(r, "boardingStatus") ?? "") === v && r.status === status);
  // Prefill from what's pending, else approved, for the term being viewed.
  useEffect(() => {
    if (!term || !structures.data) return;
    const next: Record<string, string> = {};
    for (const c of cols) {
      const st = find(term.id, c.g.id, c.v, "pending") ?? find(term.id, c.g.id, c.v, "approved");
      for (const l of st ? recLines(st) : []) next[`${c.key}:${l.feeItemId}`] = String(Number(l.amount));
    }
    setCells(next);
  }, [term?.id, structures.data, grades.data, hasBoarding]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cal.loading || grades.isLoading || items.isLoading || structures.isLoading) return <SkeletonRows rows={4} cols={4} />;
  if (!term) return <p className="text-sm text-muted-foreground">Set up the school year first.</p>;
  if (!gradeList.length) return <p className="text-sm text-muted-foreground">Add your classes first.</p>;
  const approvers = (users.data ?? []).filter((u) => u.isActive && u.id !== s.user.id && ["school_admin", "principal"].includes(u.role));
  const allCodes = new Set((items.data ?? []).map((r) => String(r.data?.code ?? "").toUpperCase()));
  const activeNames = new Set(feeItems.map((r) => String(r.data?.name ?? "").trim().toLowerCase()));
  const addItem = (preset?: string) => {
    const name = (preset ?? newItem).trim();
    if (name.length < 2) return;
    setErr(null);
    if (activeNames.has(name.toLowerCase())) return setErr(`${name} is already on the list.`);
    // Codes must be unique across every fee item the school ever had, including removed ones.
    const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "ITEM";
    let code = base, n = 2;
    while (allCodes.has(code)) code = `${base}${n++}`;
    create.mutate({ data: { kind: "fee_item", idempotencyKey: crypto.randomUUID(), name, code, priority: feeItems.length + 1, isOptional: false } }, {
      onSuccess: () => { if (!preset) setNewItem(""); invalidate(); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  const removeItem = (it: FinanceRecord) => {
    setErr(null);
    remove.mutate({ id: it.id }, {
      onSuccess: () => { setCells(Object.fromEntries(Object.entries(cells).filter(([k]) => !k.endsWith(`:${it.id}`)))); invalidate(); toast({ title: `${String(it.data?.name ?? "Fee item")} removed` }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const SUGGESTED = ["Tuition", "Lunch", "Activity", "Exam fee", "Development"];
  const unpicked = SUGGESTED.filter((n) => !activeNames.has(n.toLowerCase()));
  const status = (c: { g: Grade; v: Variant }) => find(term.id, c.g.id, c.v, "pending") ? "pending" : find(term.id, c.g.id, c.v, "approved") ? "approved" : "none";
  const submit = async () => {
    setErr(null); setSent(null);
    const bad = Object.values(cells).find((v) => v.trim() && !MONEY.test(v.trim().replace(/,/g, "")));
    if (bad) return setErr(`"${bad}" isn't an amount. Use numbers like 12500.`);
    const scope = everyTerm ? cal.yearTerms : [term];
    setBusy(true);
    let made = 0, skipped = 0;
    try {
      for (const t of scope) for (const { g, v, key } of cols) {
        const lines = feeItems.map((it) => ({ feeItemId: it.id, amount: (cells[`${key}:${it.id}`] ?? "").trim().replace(/,/g, "") })).filter((l) => l.amount && Number(l.amount) > 0);
        if (!lines.length) continue;
        if (find(t.id, g.id, v, "pending")) { skipped++; continue; }
        const approved = find(t.id, g.id, v, "approved");
        const same = approved && JSON.stringify(recLines(approved).map((l) => [l.feeItemId, Number(l.amount)]).sort()) === JSON.stringify(lines.map((l) => [l.feeItemId, Number(l.amount)]).sort());
        if (same) continue;
        await create.mutateAsync({ data: { kind: "fee_structure", idempotencyKey: crypto.randomUUID(), name: `${g.name}${v ? ` (${v === "day" ? "day" : "boarders"})` : ""} · ${t.name}`, academicYearId: t.academicYearId, termId: t.id, gradeId: g.id, ...(v ? { boardingStatus: v } : {}), lines, ...(approved ? { parentId: approved.id } : {}) } });
        made++;
      }
      invalidate(); setSent(made);
      // In first-time setup, saving moves straight on to billing.
      if (embedded && (made || !needsApproval)) onNext();
      toast({ title: !made ? "Nothing changed" : needsApproval ? `${made} fee structure(s) sent for approval` : "Fees saved", description: skipped ? `${skipped} already waiting for approval were left as they are.` : undefined });
    } catch (x) { setErr(errMsg(x)); invalidate(); } finally { setBusy(false); }
  };
  const total = (key: string) => sumMoney(feeItems.map((it) => (cells[`${key}:${it.id}`] ?? "").replace(/,/g, "") || "0"));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionCard checked={everyTerm} onChange={setEveryTerm} testid="checkbox-every-term" title="Same fees every term"
          detail={everyTerm ? `Applies to all ${cal.yearTerms.length} terms of ${cal.year?.name ?? "this year"}` : "Set the amounts for each term separately"} />
        <OptionCard checked={hasBoarding} onChange={setBoarding} testid="checkbox-boarding" title="We have boarders"
          detail={hasBoarding ? "Separate day and boarder amounts for each grade" : "One amount per grade for every learner"} />
      </div>
      {!everyTerm && (
        <div role="radiogroup" aria-label="Fees for" className="flex flex-wrap gap-2" data-testid="fees-term">
          {cal.yearTerms.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === term.id} onClick={() => setTermId(t.id)}
              className={cn("rounded-full border px-4 py-2 text-sm font-medium transition", t.id === term.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40")}>
              {t.name}{t.isCurrent ? " · now" : ""}
            </button>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Fee items" data-testid="fee-items">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-5 py-4">
          <h3 className="text-base font-semibold">Fee items</h3>
          <span className="text-sm text-muted-foreground">{feeItems.length ? `${feeItems.length} item${feeItems.length === 1 ? "" : "s"} · amounts in KES${everyTerm ? "" : ` · ${term.name}`}` : "Each item gets an amount for every grade"}</span>
        </div>
        {!feeItems.length ? (
          <div className="px-5 py-8 text-center" data-testid="fees-empty">
            <div className="font-semibold">What do you charge each term?</div>
            <p className="mt-1 text-sm text-muted-foreground">Tap one to start, or type your own below.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {unpicked.map((n) => (
                <button key={n} type="button" disabled={create.isPending} onClick={() => addItem(n)} data-testid={`suggest-${n}`}
                  className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-background px-4 text-sm font-medium hover:border-primary/50 hover:text-primary disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{n}</button>
              ))}
            </div>
          </div>
        ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="sticky left-0 bg-muted/50 px-3 py-2 font-semibold">Fee item</th>
              {cols.map((c) => { const st = status(c); return <th key={c.key} className="px-2 py-2 font-semibold"><div>{c.g.name}{c.v && <span className="font-normal text-muted-foreground"> · {c.v === "day" ? "Day" : "Boarder"}</span>}</div><div className={cn("text-[11px] font-normal", st === "approved" ? "text-primary" : st === "pending" ? "text-amber-700" : "text-muted-foreground")}>{st === "approved" ? "approved" : st === "pending" ? "awaiting approval" : "not set"}</div></th>; })}
            </tr>
          </thead>
          <tbody>
            {feeItems.map((it) => (
              <tr key={it.id} className="border-t border-border/60">
                <td className="sticky left-0 bg-card px-3 py-2 font-medium"><span className="inline-flex items-center gap-1.5">{String(it.data?.name ?? "Fee item")}
                  <button type="button" aria-label={`Edit ${String(it.data?.name ?? "fee item")}`} title="Rename or change payment order" onClick={() => setEditing(it)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                  <button type="button" aria-label={`Remove ${String(it.data?.name ?? "fee item")}`} title="Remove this item" disabled={remove.isPending} onClick={() => removeItem(it)} data-testid={`remove-fee-item-${it.id}`} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"><Trash2 className="h-3 w-3" /></button></span></td>
                {cols.map((c) => <td key={c.key} className="px-1.5 py-1.5"><input inputMode="decimal" aria-label={`${it.data?.name} for ${c.g.name}${c.v ? ` ${c.v}` : ""}`} disabled={status(c) === "pending"} value={cells[`${c.key}:${it.id}`] ?? ""} onChange={(e) => setCells({ ...cells, [`${c.key}:${it.id}`]: e.target.value })} placeholder="0" className="h-9 w-24 rounded-md border border-input bg-card px-2 text-right font-mono text-sm outline-none focus:border-primary disabled:bg-muted/50" /></td>)}
              </tr>
            ))}
            <tr className="border-t border-border bg-muted/30">
              <td className="sticky left-0 bg-muted/30 px-3 py-2 font-semibold">Total per learner</td>
              {cols.map((c) => <td key={c.key} className="px-2 py-2 text-right font-mono font-semibold">{kes(total(c.key), false)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-5 py-3">
          {feeItems.length > 0 && unpicked.length > 0 && <div className="flex w-full flex-wrap items-center gap-2 pb-1" data-testid="fees-more-suggestions">
            <span className="text-xs text-muted-foreground">Quick add</span>
            {unpicked.map((n) => (
              <button key={n} type="button" disabled={create.isPending} onClick={() => addItem(n)} data-testid={`suggest-${n}`}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium hover:border-primary/50 hover:text-primary disabled:opacity-50"><Plus className="h-3 w-3" />{n}</button>
            ))}
          </div>}
          <TextInput value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} placeholder={feeItems.length ? "Another item, e.g. Transport" : "Your own item, e.g. Tuition"} className="h-10 max-w-xs flex-1" data-testid="input-new-fee-item" />
          <Btn variant="outline" disabled={newItem.trim().length < 2 || create.isPending} onClick={() => addItem()}><Plus className="h-4 w-4" />Add item</Btn>
        </div>
      </section>
      {!embedded && !onFeeSetup && <p className="text-sm text-muted-foreground">Charges only some learners pay, like transport or boarding extras, are added later under <Link href="/fee-structure" className="font-semibold text-primary hover:underline">Fee setup</Link>.</p>}
      <FormDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} title={`Edit ${String(editing?.data?.name ?? "fee item")}`}>{editing && <FeeItemEdit key={editing.id} item={editing} onDone={() => setEditing(null)} />}</FormDialog>
      <FormError msg={err} />
      <div className="flex flex-wrap gap-3">
        <StepAction><Btn data-testid="button-submit-fees" disabled={busy || !feeItems.length} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{needsApproval ? "Send fees for approval" : "Save fees"}</Btn></StepAction>
        {!embedded && <Btn variant="outline" onClick={onNext} data-testid="button-step-next">Next: bill learners<ArrowRight className="h-4 w-4" /></Btn>}
      </div>
      {((sent !== null && needsApproval) || cols.some((c) => status(c) === "pending")) && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm" data-testid="fees-approval-note">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>Fee changes need a second person's approval, so no one can change fees alone.{" "}
            {approvers.length ? <>Ask {approvers.map((u) => u.name).join(" or ")} to approve them under <Link href="/approvals" className="font-semibold text-primary hover:underline">Approvals</Link>.</>
              : <>Add a principal or another administrator in <Link href="/staff" className="font-semibold text-primary hover:underline">Staff</Link> so they can approve.</>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Step 4: bill learners ----------
export function BillingStep({ embedded = false, onDone }: { embedded?: boolean; onDone?: () => void } = {}) {
  const hasLearners = useHasLearners();
  const { toast } = useToast();
  const invalidate = useFinanceInvalidate();
  const cal = useCalendar();
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const structures = useFinanceRecords({ kind: "fee_structure" });
  const preview = usePreviewFinanceInvoices();
  const commit = useCommitFinanceInvoices();
  const term = cal.current;
  const [dueDate, setDueDate] = useState("");
  const [result, setResult] = useState<InvoiceBatchResult | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (term && !dueDate) setDueDate(addDays(term.startDate > today() ? term.startDate : today(), 14)); }, [term, dueDate]);
  if (hasLearners === false) return <NoLearnersNotice />;
  if (cal.loading || grades.isLoading || structures.isLoading) return <SkeletonRows rows={3} cols={3} />;
  if (!term) return <p className="text-sm text-muted-foreground">Choose the current term in step 1 first.</p>;
  const approvedGrades = new Set((structures.data ?? []).filter((r) => r.termId === term.id && r.status === "approved").map((r) => rd(r, "gradeId")));
  const missing = (grades.data ?? []).filter((g) => g.studentCount > 0 && !approvedGrades.has(g.id));
  const fresh = result?.invoices.filter((i) => !i.existing) ?? [];
  const run = () => { setErr(null); setDone(null); preview.mutate({ data: { termId: term.id, dueDate } }, { onSuccess: setResult, onError: (x) => setErr(errMsg(x)) }); };
  const bill = () => commit.mutate({ data: { termId: term.id, dueDate, previewToken: result!.previewToken } }, {
    onSuccess: (r) => { const n = r.invoices.filter((i) => !i.existing).length; setDone(n); setResult(null); invalidate(); onDone?.(); toast({ title: `${n} learner(s) billed for ${term.name}` }); },
    onError: (x) => setErr(errMsg(x)),
  });
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Create {term.name} invoices for every active learner from the approved fees. Learners already billed for this term are left alone, so it's safe to run again after admitting new learners.</p>
      {missing.length > 0 && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">No approved fees yet for {missing.map((g) => g.name).join(", ")}. Learners in {missing.length === 1 ? "that grade" : "those grades"} won't be billed until they're approved.</p>}
      <Field label="Payment due by" className="max-w-xs"><TextInput type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setResult(null); }} /></Field>
      <FormError msg={err} />
      {!result ? <StepAction><Btn data-testid="button-preview-billing" disabled={preview.isPending || !dueDate} onClick={run}>{preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Preview {term.name} invoices</Btn></StepAction> : (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div><div className="text-xs text-muted-foreground">New invoices</div><div className="text-2xl font-semibold">{fresh.length}</div></div>
            <div><div className="text-xs text-muted-foreground">Total to bill</div><div className="text-2xl font-semibold">{kes(sumMoney(fresh.map((i) => i.amount)))}</div></div>
            <div><div className="text-xs text-muted-foreground">Already billed</div><div className="text-2xl font-semibold">{result.invoices.length - fresh.length}</div></div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Btn data-testid="button-commit-billing" disabled={!fresh.length || commit.isPending} onClick={bill}>{commit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Bill {fresh.length} learner{fresh.length === 1 ? "" : "s"}</Btn>
            <Btn variant="ghost" onClick={() => setResult(null)}>Change</Btn>
          </div>
        </div>
      )}
      {done !== null && <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm"><Check className="h-5 w-5 text-primary" /><span className="flex-1">{term.name} billing is done.</span>{!embedded && <Link href="/invoices" className="font-semibold text-primary hover:underline">See invoices</Link>}</div>}
    </div>
  );
}

/** Always visible: which term is being set up, when it opens and closes, and where today falls in the year. */
/** One calm page: the school year and the classes. Fees and billing open here only when a term prompt sends someone to them. */
export default function TermSetup() {
  usePageTitle("Terms");
  const search = useSearch();
  const params = new URLSearchParams(search);
  const focus = params.get("step");
  const cal = useCalendar();
  const t = today();
  const left = cal.current ? daysBetween(t, cal.current.endDate) : null;
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const status = useTermStatus();
  // Moving learners up a grade belongs to the end of the year; it can also be opened on purpose.
  const showPromotion = status?.kind === "year-ended" || params.get("new") === "1" || params.get("promote") === "1";
  if (focus === "fees") return <Redirect to="/fee-structure" replace />;
  if (focus === "billing") return (
    <div className="space-y-6">
      <Link href="/term-setup" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Terms</Link>
      <PageHeader title="Bill learners" meta="Every learner gets an invoice for the term." />
      <Panel title="Billing"><div className="p-5"><BillingStep embedded /></div></Panel>
    </div>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Terms" meta="Your school year and its term dates." />
      <TermPrompt />
      <Panel title={cal.year ? `School year ${cal.year.name}` : "School year"}
        action={cal.current && left !== null && left >= 0 ? <span className="text-xs text-muted-foreground"><b className="text-foreground">{cal.current.name}</b> · {left} day{left === 1 ? "" : "s"} left</span> : undefined}>
        <div className="p-5"><CalendarStep embedded forceNew={params.get("new") === "1"} onNext={() => undefined} />
          {!showPromotion && (grades.data?.length ?? 0) > 0 && <Link href="/term-setup?promote=1" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">Move learners up a grade (year-end promotion)</Link>}
        </div>
      </Panel>
      {showPromotion && <div id="promotion"><PromotionsPanel /></div>}
    </div>
  );
}
