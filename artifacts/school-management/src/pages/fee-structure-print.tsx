import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSchool, useUpdateSchool, getGetSchoolQueryKey, useListTerms, getListTermsQueryKey, useListAcademicYears, getListAcademicYearsQueryKey,
  useListGrades, getListGradesQueryKey, type FeeStructureTemplate, type FinanceRecord, type Grade, type School, type SchoolSettings, type Term,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, Copy, Download, FileText, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Btn, ErrorState, Field, FormError, NativeSelect, PageHeader, Panel, SkeletonRows, TextInput } from "@/components/kit";
import { StoredImage } from "@/components/stored-image";
import { useFinanceRecords, Table, td } from "@/components/finance-kit";
import { kes, rd, recLines, sumMoney } from "@/lib/finance";
import { errMsg, usePerms } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadSheetsPdf } from "@/lib/pdf";

type Tpl = Required<FeeStructureTemplate>;
type Section = Tpl["sections"][number];
type Extra = Tpl["extras"][number];

/** The built-in layout every new template starts from. */
function defaults(optionalItems: string[]): Tpl {
  return {
    id: "", name: "", grade: "", period: "current", who: "both",
    title: "Fee structure", subtitle: "",
    showLogo: true, showContacts: true, showYearTotal: true, showExtras: true, showPayment: true, showSignatures: true,
    payment: "M-Pesa Paybill: __________   Account: learner's admission number\nBank: __________   Account no.: __________   Branch: __________",
    extras: optionalItems.map((name) => ({ name, amount: "" })),
    sections: [{ heading: "Notes", body: "1. Fees are payable in full at the start of each term.\n2. Use the learner's admission number as the account number for every payment.\n3. Keep your M-Pesa message or bank slip as proof of payment." }],
    signatories: ["Principal", "Bursar"],
    footer: "",
  };
}
/** Ready-made sections a school often adds, one click each. */
const SUGGESTED: Section[] = [
  { heading: "Items to bring", body: "" },
  { heading: "Uniform", body: "" },
  { heading: "Important dates", body: "" },
  { heading: "Refund policy", body: "" },
];

const ALL = "all";
const YEAR = "year";
const NEW = "new";
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Everything both views need: the school, its saved templates, and the fees to print. */
function usePrintData() {
  const school = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const years = useListAcademicYears({ query: { queryKey: getListAcademicYearsQueryKey() } });
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const items = useFinanceRecords({ kind: "fee_item" });
  const structures = useFinanceRecords({ kind: "fee_structure" });
  const loading = school.isLoading || terms.isLoading || grades.isLoading || items.isLoading || structures.isLoading;
  const optionalNames = (items.data ?? []).filter((r) => r.status === "active" && r.data?.isOptional).map((r) => String(r.data?.name ?? "")).filter(Boolean);
  const base = defaults(optionalNames);
  const saved: Tpl[] = (school.data?.settings?.feeStructureTemplates ?? []).map((t) => ({ ...base, ...t }));
  const gradeList = [...(grades.data ?? [])].sort((a, b) => a.order - b.order);
  return { school, terms, years, items, structures, loading, base, saved, gradeList };
}

/** Saves the whole template list. Settings are replaced as a whole, so the rest is kept as it is. */
function useSaveTemplates() {
  const qc = useQueryClient();
  const update = useUpdateSchool();
  const save = (school: School, list: Tpl[], done: () => void, fail: (msg: string) => void) => {
    const { feeStructureTemplate: _legacy, ...rest } = (school.settings ?? {}) as SchoolSettings & { feeStructureTemplate?: unknown };
    update.mutate({ data: { settings: { ...rest, feeStructureTemplates: list } } }, {
      onSuccess: (x) => { qc.setQueryData(getGetSchoolQueryKey(), x); done(); },
      onError: (x) => fail(errMsg(x)),
    });
  };
  return { save, busy: update.isPending };
}

/** Saved fee structure printouts, or one being edited when the address names it. */
export default function FeeStructurePrint() {
  const t = new URLSearchParams(useSearch()).get("t");
  return t ? <Editor key={t} id={t} /> : <TemplateList />;
}

/** The Fee structure tab: every saved template in one table, with a way to add another. */
function TemplateList() {
  usePageTitle("Fee structure");
  const p = usePerms();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const d = usePrintData();
  const { save, busy } = useSaveTemplates();
  if (d.loading || !d.school.data) return <SkeletonRows rows={4} cols={4} />;
  const s = d.school.data;
  const gradeName = (id: string) => id === ALL ? "All grades" : d.gradeList.find((g) => g.id === id)?.name ?? "First grade with fees";
  const prints = (x: Tpl) => [gradeName(x.grade), x.period === "year" ? "Whole year" : "Current term", x.who === "day" ? "Day scholars" : x.who === "boarder" ? "Boarders" : null].filter(Boolean).join(" · ");
  const remove = (x: Tpl) => {
    if (!window.confirm(`Delete the template "${x.name}"? This can't be undone.`)) return;
    save(s, d.saved.filter((y) => y.id !== x.id), () => toast({ title: "Template deleted" }), (m) => toast({ title: "Could not delete", description: m }));
  };
  const rows = d.saved.length ? d.saved : [{ ...d.base, id: "", name: "Standard" }];
  const open = (x: Tpl, extra = "") => navigate(`/fee-structure/templates?t=${x.id || NEW}${extra}`);
  return (
    <div className="space-y-6">
      <PageHeader title="Fee structure" meta="The fee structure you give parents. Save a template once, download it any time; amounts always come from the latest approved fees.">
        <Link href={`/fee-structure/templates?t=${NEW}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="button-new-template"><Plus className="h-4 w-4" />New template</Link>
      </PageHeader>
      <Panel>
        <Table head={["Template", "Prints", "Layout", ""]}>
          {rows.map((x) => {
            const builtIn = !x.id;
            return (
              <tr key={x.id || "standard"} data-testid={`template-${x.id || "standard"}`}>
                <td className={td}><button type="button" onClick={() => open(x)} className="text-left font-semibold hover:underline">{x.name || "Untitled"}</button>{builtIn && <div className="text-xs text-muted-foreground">Built-in. Customise it to save your own.</div>}</td>
                <td className={`${td} text-sm`}>{prints(x)}</td>
                <td className={`${td} text-xs text-muted-foreground`}>{x.title || "Fee structure"}{x.sections.length ? ` · ${x.sections.length} section${x.sections.length === 1 ? "" : "s"}` : ""}{x.signatories.length ? ` · signed by ${x.signatories.join(", ")}` : ""}</td>
                <td className={td}>
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Btn variant="outline" className="h-8 px-3 text-xs" data-testid="button-template-actions" aria-label={`Actions for ${x.name || "template"}`}>Actions<ChevronDown className="h-3.5 w-3.5" /></Btn>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onSelect={() => open(x, "&pdf=1")} data-testid="button-template-pdf"><Download className="h-4 w-4" />Download PDF</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => open(x)} data-testid="button-template-edit"><Pencil className="h-4 w-4" />{builtIn ? "Customise" : "Edit"}</DropdownMenuItem>
                        {!builtIn && <DropdownMenuItem onSelect={() => navigate(`/fee-structure/templates?t=${NEW}&from=${x.id}`)}><Copy className="h-4 w-4" />Duplicate</DropdownMenuItem>}
                        {!builtIn && p.manageSchool && <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={busy} onSelect={() => remove(x)} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                        </>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      {!p.manageSchool && <p className="text-sm text-muted-foreground">You can download and adjust any template. An administrator saves new or changed templates.</p>}
    </div>
  );
}

/** Shape one template, preview the sheet, then save it, save a copy, or print. */
function Editor({ id }: { id: string }) {
  const p = usePerms();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const d = usePrintData();
  const { save, busy } = useSaveTemplates();
  const existing = d.saved.find((x) => x.id === id) ?? null;
  const source = existing ?? d.saved.find((x) => x.id === params.get("from")) ?? null;
  const original: Tpl | null = d.loading || !d.school.data ? null
    : existing ?? (source ? { ...source, id: "", name: `${source.name} (copy)` } : { ...d.base, id: "", name: d.saved.length ? "" : "Standard" });
  usePageTitle(existing ? existing.name || "Template" : "New template");
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [gradeId, setGradeId] = useState("");
  const [period, setPeriod] = useState("");
  const [who, setWho] = useState<"both" | "day" | "boarder">("both");
  const [err, setErr] = useState<string | null>(null);
  const autoPdf = params.get("pdf") === "1";
  const [making, setMaking] = useState(false);
  const download = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (!original || tpl) return;
    setTpl(original); setGradeId(original.grade); setWho(original.who); setPeriod(original.period === "year" ? YEAR : "");
  }, [original, tpl]);
  // Downloading straight from the list: wait for the sheet to render, then download once.
  useEffect(() => {
    if (!tpl || !autoPdf) return;
    const timer = setTimeout(() => { navigate(`/fee-structure/templates?t=${id}`, { replace: true }); void download.current(); }, 600);
    return () => clearTimeout(timer);
  }, [tpl, autoPdf]); // eslint-disable-line react-hooks/exhaustive-deps

  if (d.loading || !tpl || !original) return <SkeletonRows rows={6} cols={3} />;
  if (id !== NEW && !existing) return <ErrorState msg="This template no longer exists." />;
  const s = d.school.data!;
  const set = <K extends keyof Tpl>(k: K, v: Tpl[K]) => setTpl({ ...tpl, [k]: v });
  const approved = (d.structures.data ?? []).filter((r) => r.status === "approved");
  const priced = d.gradeList.filter((g) => approved.some((r) => rd(r, "gradeId") === g.id));
  const allTerms = [...(d.terms.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const current = allTerms.find((t) => t.isCurrent) ?? allTerms[0];
  const chosenTerm = allTerms.find((t) => t.id === period) ?? current;
  const year = d.years.data?.find((y) => y.id === chosenTerm?.academicYearId);
  const yearTerms = allTerms.filter((t) => t.academicYearId === chosenTerm?.academicYearId);
  const periodTerms = period === YEAR ? yearTerms : chosenTerm ? [chosenTerm] : [];
  const gid = gradeId === ALL && priced.length > 1 ? ALL : priced.some((g) => g.id === gradeId) ? gradeId : priced[0]?.id ?? "";
  const sheetGrades = gid === ALL ? priced : d.gradeList.filter((g) => g.id === gid);
  // Offer day/boarder only when the grades being printed actually have both.
  const hasBoarding = approved.some((r) => sheetGrades.some((g) => g.id === rd(r, "gradeId")) && !!rd(r, "boardingStatus"));
  // What gets stored: the layout, plus what to print. A specific term is kept as "current" so the template stays useful next term.
  const current_ = (): Tpl => ({
    ...tpl, name: tpl.name.trim(), grade: gid, period: period === YEAR ? "year" : "current", who,
    extras: tpl.extras.filter((x) => x.name.trim()), sections: tpl.sections.filter((x) => x.heading.trim() || x.body.trim()), signatories: tpl.signatories.map((x) => x.trim()).filter(Boolean),
  });
  const dirty = JSON.stringify(current_()) !== JSON.stringify({ ...original, grade: original.grade || gid, name: original.name.trim() });
  const persist = (asNew: boolean) => {
    setErr(null);
    const next = current_();
    if (!next.name) return setErr("Give the template a name, e.g. Boarders 2026.");
    if (asNew && existing && next.name === existing.name) next.name = `${next.name} (copy)`;
    if (asNew || !existing) {
      if (d.saved.length >= 20) return setErr("You can keep up to 20 templates. Delete one you no longer use first.");
      next.id = crypto.randomUUID();
    }
    const list = existing && !asNew ? d.saved.map((x) => x.id === existing.id ? next : x) : [...d.saved, next];
    save(s, list, () => {
      toast({ title: existing && !asNew ? "Template saved" : "Template created", description: next.name });
      navigate(`/fee-structure/templates?t=${next.id}`, { replace: true });
      if (existing && !asNew) setTpl(null);
    }, setErr);
  };
  download.current = async () => {
    const pages = [...document.querySelectorAll<HTMLElement>("[data-testid=print-preview] .print-page")];
    if (!pages.length) return;
    setMaking(true);
    try {
      const what = [gid === ALL ? "All grades" : sheetGrades[0]?.name, period === YEAR ? `${year?.name ?? ""} year` : chosenTerm?.name, hasBoarding && who !== "both" ? (who === "boarder" ? "Boarders" : "Day scholars") : ""].filter(Boolean).join(" - ");
      await downloadSheetsPdf(pages, `${s.name} - Fee structure - ${what}.pdf`);
    } catch (x) { toast({ title: "Could not make the PDF", description: errMsg(x) }); } finally { setMaking(false); }
  };
  const moveSection = (i: number, dir: -1 | 1) => { const next = [...tpl.sections]; [next[i], next[i + dir]] = [next[i + dir], next[i]]; set("sections", next); };
  const editSection = (i: number, v: Partial<Section>) => set("sections", tpl.sections.map((x, j) => j === i ? { ...x, ...v } : x));
  const editExtra = (i: number, v: Partial<Extra>) => set("extras", tpl.extras.map((x, j) => j === i ? { ...x, ...v } : x));
  const unused = SUGGESTED.filter((x) => !tpl.sections.some((y) => y.heading.toLowerCase() === x.heading.toLowerCase()));

  return (
    <div className="space-y-6">
      <Link href="/fee-structure/templates" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Fee structure</Link>
      <PageHeader title={existing ? existing.name || "Template" : "New template"} meta="Shape the sheet on the left and check the preview. What you see is what prints." />
      <div className="grid items-start gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:pr-1">
          <Field label="Template name"><TextInput value={tpl.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Boarders 2026" data-testid="input-tpl-name" /></Field>
          <Group title="What to print" open>
            <Field label="Grade">
              <NativeSelect value={gid} onChange={(e) => setGradeId(e.target.value)} data-testid="select-print-grade">
                {!priced.length && <option value="">No grade has approved fees yet</option>}
                {priced.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                {priced.length > 1 && <option value={ALL}>All grades (one page each)</option>}
              </NativeSelect>
            </Field>
            <Field label="For">
              <NativeSelect value={period || chosenTerm?.id || ""} onChange={(e) => setPeriod(e.target.value)} data-testid="select-print-period">
                {yearTerms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? " (current)" : ""}</option>)}
                {yearTerms.length > 1 && <option value={YEAR}>Whole year{year ? ` ${year.name}` : ""} (all terms)</option>}
              </NativeSelect>
            </Field>
            {hasBoarding && (
              <Field label="Learners">
                <NativeSelect value={who} onChange={(e) => setWho(e.target.value as typeof who)} data-testid="select-print-who">
                  <option value="both">Day scholars and boarders</option>
                  <option value="day">Day scholars only</option>
                  <option value="boarder">Boarders only</option>
                </NativeSelect>
              </Field>
            )}
          </Group>

          <Group title="Heading">
            <Field label="Title"><TextInput value={tpl.title} maxLength={120} onChange={(e) => set("title", e.target.value)} data-testid="input-tpl-title" /></Field>
            <Field label="Line under the school name" hint="Your motto, or e.g. a registration number."><TextInput value={tpl.subtitle} maxLength={200} onChange={(e) => set("subtitle", e.target.value)} placeholder="e.g. Strive for excellence" data-testid="input-tpl-subtitle" /></Field>
            <Check label="School logo" on={tpl.showLogo} set={(v) => set("showLogo", v)} />
            <Check label="Address, phone and email" on={tpl.showContacts} set={(v) => set("showContacts", v)} />
          </Group>

          <Group title="What the sheet shows">
            <Check label="Year total column (whole-year sheets)" on={tpl.showYearTotal} set={(v) => set("showYearTotal", v)} />
            <Check label="Optional charges" on={tpl.showExtras} set={(v) => set("showExtras", v)} />
            <Check label="How to pay" on={tpl.showPayment} set={(v) => set("showPayment", v)} />
            <Check label="Signature lines" on={tpl.showSignatures} set={(v) => set("showSignatures", v)} />
          </Group>

          {tpl.showExtras && (
            <Group title="Optional charges" hint="Charged only to learners who take them. Write the amount or rule as you want parents to read it.">
              {tpl.extras.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <TextInput value={x.name} maxLength={120} onChange={(e) => editExtra(i, { name: e.target.value })} placeholder="e.g. Transport" className="flex-1" aria-label="Charge" />
                  <TextInput value={x.amount ?? ""} maxLength={120} onChange={(e) => editExtra(i, { amount: e.target.value })} placeholder="e.g. 3,500 per term" className="flex-1" aria-label="Amount" />
                  <IconBtn label="Remove charge" onClick={() => set("extras", tpl.extras.filter((_, j) => j !== i))}><X className="h-4 w-4" /></IconBtn>
                </div>
              ))}
              {tpl.extras.length < 30 && <Btn variant="ghost" className="h-8 px-2 text-xs" onClick={() => set("extras", [...tpl.extras, { name: "", amount: "" }])}><Plus className="h-3.5 w-3.5" />Add a charge</Btn>}
            </Group>
          )}

          {tpl.showPayment && (
            <Group title="How to pay">
              <textarea value={tpl.payment} onChange={(e) => set("payment", e.target.value)} rows={4} maxLength={2000} className={area} aria-label="How to pay" data-testid="input-tpl-payment" />
            </Group>
          )}

          <Group title="Your sections" hint="Notes, items to bring, uniform: anything parents should know. Each prints under its own heading.">
            {tpl.sections.map((x, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex gap-1">
                  <TextInput value={x.heading} maxLength={120} onChange={(e) => editSection(i, { heading: e.target.value })} placeholder="Heading" className="flex-1 font-semibold" aria-label="Section heading" />
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => moveSection(i, -1)}><ArrowUp className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Move down" disabled={i === tpl.sections.length - 1} onClick={() => moveSection(i, 1)}><ArrowDown className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Remove section" onClick={() => set("sections", tpl.sections.filter((_, j) => j !== i))}><X className="h-4 w-4" /></IconBtn>
                </div>
                <textarea value={x.body} onChange={(e) => editSection(i, { body: e.target.value })} rows={4} maxLength={4000} className={area} aria-label={`${x.heading || "Section"} text`} data-testid={`input-tpl-section-${i}`} />
              </div>
            ))}
            {tpl.sections.length < 10 && (
              <div className="flex flex-wrap gap-1.5">
                {unused.map((x) => <button key={x.heading} type="button" onClick={() => set("sections", [...tpl.sections, x])} className="rounded-full px-3 py-1 text-xs font-medium ring-1 ring-border hover:bg-muted">+ {x.heading}</button>)}
                <button type="button" onClick={() => set("sections", [...tpl.sections, { heading: "", body: "" }])} className="rounded-full px-3 py-1 text-xs font-medium ring-1 ring-border hover:bg-muted" data-testid="button-add-section">+ Blank section</button>
              </div>
            )}
          </Group>

          {tpl.showSignatures && (
            <Group title="Signed by" hint="Up to four, separated by commas.">
              <TextInput value={tpl.signatories.join(", ")} onChange={(e) => set("signatories", e.target.value.split(",").map((x) => x.trimStart()).slice(0, 4))} placeholder="Principal, Bursar" aria-label="Signatories" />
            </Group>
          )}

          <Group title="Footer">
            <TextInput value={tpl.footer} maxLength={400} onChange={(e) => set("footer", e.target.value)} placeholder="e.g. Fees once paid are not refundable." aria-label="Footer" />
          </Group>

          <div className="space-y-2 pt-1">
            {p.manageSchool && (
              <div className="flex gap-2">
                <Btn variant={dirty || !existing ? "primary" : "outline"} className="flex-1" disabled={busy || (!!existing && !dirty)} onClick={() => persist(false)} data-testid="button-save-template">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}{existing ? (dirty ? "Save changes" : "Saved") : "Save template"}</Btn>
                {existing && <Btn variant="outline" disabled={busy} onClick={() => persist(true)} data-testid="button-save-as-new"><Copy className="h-4 w-4" />Save as new</Btn>}
              </div>
            )}
            {existing && dirty && <Btn variant="ghost" className="w-full" onClick={() => setTpl(null)}><RotateCcw className="h-4 w-4" />Undo changes</Btn>}
            {!p.manageSchool && <p className="text-xs text-muted-foreground">Your changes apply to this printout. An administrator saves templates.</p>}
            <FormError msg={err} />
            <Btn variant={dirty && p.manageSchool ? "outline" : "primary"} className="w-full" disabled={!sheetGrades.length || making} onClick={() => void download.current()} data-testid="button-pdf">
              {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{making ? "Making the PDF…" : `Download PDF${sheetGrades.length > 1 ? ` (${sheetGrades.length} pages)` : ""}`}</Btn>
          </div>
        </div>

        <div className="print-area space-y-6 overflow-x-auto" data-testid="print-preview">
          {!sheetGrades.length ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Approve fees for at least one grade on the Fee structure page, then come back to print.</p>
            : sheetGrades.map((g) => <Sheet key={g.id} school={s} tpl={tpl} grade={g} terms={periodTerms} only={hasBoarding && who !== "both" ? who : undefined} yearName={year?.name} whole={period === YEAR} records={approved} items={d.items.data ?? []} />)}
        </div>
      </div>
    </div>
  );
}

const area = "w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary";

function Group({ title, hint, open = false, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">{title}<ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" /></summary>
      <div className="space-y-3 border-t border-border/60 px-4 py-3">{hint && <p className="text-xs text-muted-foreground">{hint}</p>}{children}</div>
    </details>
  );
}
function Check({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={on} onChange={(e) => set(e.target.checked)} />{label}</label>;
}
function IconBtn({ label, children, ...p }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" {...p}>{children}</button>;
}

/** One A4 page for one grade, laid out by the school's template. */
function Sheet({ school, tpl, grade, terms, only, yearName, whole, records, items }: {
  school: School; tpl: Tpl; grade: Grade; terms: Term[]; only?: "day" | "boarder"; yearName?: string; whole: boolean; records: FinanceRecord[]; items: FinanceRecord[];
}) {
  const mine = records.filter((r) => rd(r, "gradeId") === grade.id && terms.some((t) => t.id === r.termId) && (!only || rd(r, "boardingStatus") === only));
  // Day and boarder fees print as separate tables; schools without boarders get one.
  const variants = [...new Set(mine.map((r) => rd(r, "boardingStatus") ?? ""))].sort((a, b) => Number(a === "boarder") - Number(b === "boarder"));
  const feeItems = [...items].filter((r) => r.status === "active" && !r.data?.isOptional).sort((a, b) => Number(a.data?.priority ?? 0) - Number(b.data?.priority ?? 0));
  const cell = "border border-black px-2 py-1";
  const head = `${cell} bg-black/[0.06] font-semibold`;
  const period = whole ? `${yearName ?? ""} school year` : `${terms[0]?.name ?? ""}${yearName ? `, ${yearName}` : ""}`;
  const extras = tpl.extras.filter((x) => x.name.trim());
  const sections = tpl.sections.filter((x) => x.body.trim());
  const signers = tpl.signatories.map((x) => x.trim()).filter(Boolean);
  const h2 = "mb-1.5 text-[10.5pt] font-bold uppercase tracking-wide";
  return (
    <article className="print-page mx-auto flex min-h-[290mm] w-full max-w-[210mm] flex-col bg-white p-[14mm] text-[10pt] text-black shadow-md ring-1 ring-black/5" data-testid={`sheet-${grade.id}`}>
      <header className="flex items-center gap-4 border-b-2 border-black pb-3">
        {tpl.showLogo && school.logoUrl && <StoredImage refPath={school.logoUrl} alt="" className="h-20 w-20 object-contain" fallback={null} />}
        <div className={`min-w-0 flex-1 ${tpl.showLogo && school.logoUrl ? "" : "text-center"}`}>
          <div className="text-2xl font-bold uppercase tracking-wide">{school.name}</div>
          {tpl.subtitle.trim() && <div className="text-[10pt] italic">{tpl.subtitle}</div>}
          {tpl.showContacts && <div className="mt-0.5 text-[9pt]">{[school.address, school.phone, school.email].filter(Boolean).join(" · ")}</div>}
        </div>
      </header>

      <div className="mt-5 text-center">
        <h1 className="text-lg font-bold uppercase">{tpl.title || "Fee structure"} · {grade.name}{only ? ` · ${only === "boarder" ? "Boarders" : "Day scholars"}` : ""}</h1>
        <p className="text-[9.5pt]">{period}</p>
      </div>

      {variants.map((v) => {
        const byTerm = terms.map((t) => mine.find((r) => r.termId === t.id && (rd(r, "boardingStatus") ?? "") === v));
        const amount = (r: FinanceRecord | undefined, itemId: string) => (r ? recLines(r).find((l) => l.feeItemId === itemId)?.amount : undefined);
        const rows = feeItems.filter((it) => byTerm.some((r) => Number(amount(r, it.id) ?? 0) > 0));
        const rowTotal = (itemId: string) => sumMoney(byTerm.map((r) => amount(r, itemId) ?? "0"));
        const colTotal = (r?: FinanceRecord) => sumMoney(r ? recLines(r).map((l) => l.amount) : []);
        const yearCol = whole && tpl.showYearTotal;
        return (
          <section key={v} className="mt-5">
            <h2 className={h2}>{only || !v ? "Fees" : v === "boarder" ? "Fees · boarders" : "Fees · day scholars"}</h2>
            <table className="w-full border-collapse text-[10pt]">
              <thead>
                <tr>
                  <th className={`${head} w-8 text-left`}>#</th>
                  <th className={`${head} text-left`}>Fee item</th>
                  {whole ? terms.map((t) => <th key={t.id} className={`${head} text-right`}>{t.name}</th>) : <th className={`${head} text-right`}>Amount (KES)</th>}
                  {yearCol && <th className={`${head} text-right`}>Year total</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((it, i) => (
                  <tr key={it.id}>
                    <td className={`${cell} tabular-nums`}>{i + 1}</td>
                    <td className={cell}>{String(it.data?.name ?? "Fee item")}</td>
                    {byTerm.map((r, j) => { const a = amount(r, it.id); return <td key={j} className={`${cell} text-right tabular-nums`}>{a && Number(a) > 0 ? kes(a, false) : "–"}</td>; })}
                    {yearCol && <td className={`${cell} text-right tabular-nums`}>{kes(rowTotal(it.id), false)}</td>}
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className={`${head}`} colSpan={2}>Total (KES)</td>
                  {byTerm.map((r, j) => <td key={j} className={`${head} text-right tabular-nums`}>{kes(colTotal(r), false)}</td>)}
                  {yearCol && <td className={`${head} text-right tabular-nums`}>{kes(sumMoney(byTerm.map((r) => colTotal(r))), false)}</td>}
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
      {!variants.length && <p className="mt-6 text-center">No approved fees for {grade.name} in this period.</p>}

      {tpl.showExtras && extras.length > 0 && (
        <section className="mt-5">
          <h2 className={h2}>Optional charges</h2>
          <p className="mb-1 text-[9pt]">Paid only by learners who take them.</p>
          <table className="w-full border-collapse text-[9.5pt]">
            <tbody>{extras.map((x, i) => <tr key={i}><td className={cell}>{x.name}</td><td className={`${cell} text-right`}>{x.amount?.trim() || "–"}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {tpl.showPayment && tpl.payment.trim() && (
        <section className="mt-5 rounded border border-black px-3 py-2">
          <h2 className={h2}>How to pay</h2>
          <div className="whitespace-pre-wrap text-[9.5pt] leading-relaxed">{tpl.payment.trim()}</div>
        </section>
      )}

      {sections.map((x, i) => (
        <section key={i} className="mt-5">
          {x.heading.trim() && <h2 className={h2}>{x.heading}</h2>}
          <div className="whitespace-pre-wrap text-[9.5pt] leading-relaxed">{x.body.trim()}</div>
        </section>
      ))}

      <div className="mt-auto" />
      {tpl.showSignatures && signers.length > 0 && (
        <section className="mt-10 grid gap-6 text-[9pt]" style={{ gridTemplateColumns: `repeat(${signers.length}, minmax(0, 1fr))` }}>
          {signers.map((x, i) => <div key={i}><div className="h-8 border-b border-black" /><div className="mt-1">{x}</div><div className="mt-3">Date: ______________</div></div>)}
        </section>
      )}
      {tpl.footer.trim() && <footer className="mt-6 border-t border-black pt-2 text-center text-[8.5pt] italic">{tpl.footer}</footer>}
    </article>
  );
}
