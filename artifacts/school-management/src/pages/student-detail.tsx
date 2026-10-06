import { usePageTitle } from "@/lib/page-title";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetStudent, useUpdateStudent, useLinkStudentGuardian, useListGuardians, getListGuardiansQueryKey, type Student, getGetStudentQueryKey, getListStudentsQueryKey, getGetDashboardSummaryQueryKey, getListFamiliesQueryKey, getListGradesQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Loader2, Pencil, Phone, Plus, Users } from "lucide-react";
import { Panel, ErrorState, Pill, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { StudentForm, fromStudent, toPayload } from "@/components/student-form";
import { usePerms, errMsg, fmtDate, initials, blank } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { StoredImage, ImageUploadButton } from "@/components/stored-image";
import { StudentFinancePanel } from "@/components/student-finance";
import { StudentAcademicPanels } from "@/components/student-academic";

const RELS = ["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Other"];

function LinkGuardianForm({ student, canSearch, onDone }: { student: Student; canSearch: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useLinkStudentGuardian();
  const existing = useListGuardians(undefined, { query: { queryKey: getListGuardiansQueryKey(), enabled: canSearch } });
  const [showId, setShowId] = useState(false);
  const [f, setF] = useState({ idNumber: "", name: "", phone: "", altPhone: "", email: "", relationship: "Mother", isPrimary: student.guardianNames.length === 0, receivesNotifications: true });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: "name" | "phone" | "altPhone" | "email" | "relationship" | "idNumber") => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pick = (id: string) => {
    const g = existing.data?.find((x) => x.id === id);
    if (g) setF({ ...f, name: g.name, phone: g.phone, altPhone: g.altPhone ?? "", email: g.email ?? "", relationship: g.relationship || f.relationship });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ studentId: student.id, data: { name: f.name.trim(), phone: f.phone.trim(), altPhone: blank(f.altPhone), email: blank(f.email), ...(showId ? { idNumber: blank(f.idNumber) } : {}), relationship: f.relationship, isPrimary: f.isPrimary, receivesNotifications: f.receivesNotifications } }, {
      onSuccess: (n) => {
        qc.setQueryData(getGetStudentQueryKey(student.id), n);
        [getListStudentsQueryKey(), getListGuardiansQueryKey(), getListFamiliesQueryKey(), getGetDashboardSummaryQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
        toast({ title: "Guardian linked", description: n.siblingCount > student.siblingCount ? "New sibling match found" : undefined });
        onDone();
      },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      {canSearch && !!existing.data?.length && (
        <Field label="Existing guardian" hint="Prefills details; matching phone links siblings"><NativeSelect data-testid="select-existing-guardian" defaultValue="" onChange={(e) => pick(e.target.value)}><option value="">New guardian…</option>{existing.data.filter((g) => !g.anonymizedAt).map((g) => <option key={g.id} value={g.id}>{g.name} · {g.phone}</option>)}</NativeSelect></Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required><TextInput data-testid="input-link-name" required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone" required><TextInput data-testid="input-link-phone" type="tel" required minLength={9} value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Relationship" required><NativeSelect data-testid="select-link-rel" value={f.relationship} onChange={set("relationship")}>{RELS.map((r) => <option key={r}>{r}</option>)}{!RELS.includes(f.relationship) && <option>{f.relationship}</option>}</NativeSelect></Field>
        <Field label="Alt. phone"><TextInput data-testid="input-link-alt" type="tel" value={f.altPhone} onChange={set("altPhone")} /></Field>
        <Field label="Email" className="sm:col-span-2"><TextInput data-testid="input-link-email" type="email" value={f.email} onChange={set("email")} /></Field>
        {showId && <Field label="National ID / passport no." hint="Collect only when the school needs it" className="sm:col-span-2"><TextInput data-testid="input-link-id-number" maxLength={40} autoComplete="off" value={f.idNumber} onChange={set("idNumber")} /></Field>}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input data-testid="check-primary" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Primary contact</label>
        <label className="flex items-center gap-2"><input data-testid="check-link-id" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={showId} onChange={(e) => setShowId(e.target.checked)} /> Record ID number (only if needed)</label>
        <label className="flex items-center gap-2"><input data-testid="check-notify" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.receivesNotifications} onChange={(e) => setF({ ...f, receivesNotifications: e.target.checked })} /> Receives notifications</label>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-link-guardian" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Link guardian</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export default function StudentDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const p = usePerms();
  const q = useGetStudent(id, { query: { queryKey: getGetStudentQueryKey(id), enabled: !!id } });
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const upd = useUpdateStudent();
  const s = q.data;
  usePageTitle(s?.fullName);

  if (q.isLoading) return <div className="space-y-4"><div className="h-10 w-72 max-w-full animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>;
  if (q.isError || !s) return <Panel><ErrorState msg={errMsg(q.error, "Student not found")} onRetry={() => q.refetch()} /></Panel>;

  const facts: [string, string][] = [
    ["Admission no.", s.admissionNo], ["UPI", s.upi ?? "—"], ["Gender", s.gender ? s.gender[0].toUpperCase() + s.gender.slice(1) : "—"],
    ["Date of birth", fmtDate(s.dateOfBirth)], ["Class", s.gradeName ? `${s.gradeName}${s.streamName ? " · " + s.streamName : ""}` : "Unassigned"],
    ["Boarding", s.boardingStatus === "boarder" ? "Boarder" : "Day scholar"], ["Admitted", fmtDate(s.admissionDate)], ["Pathway", s.pathway ?? "\u2014"], ["Transport route ref.", s.transportRouteId ?? "\u2014"], ["On register since", fmtDate(s.createdAt)],
  ];

  return (
    <div className="space-y-6">
      <Link href="/students" data-testid="link-back" className="max-md:hidden inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All students</Link>
      <header className="rise flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-center">
        <div className="flex items-end gap-3">
          <StoredImage refPath={s.photoUrl} alt={`Photo of ${s.fullName}`} className="h-16 w-16 rounded-md" fallback={<div className="flex h-16 w-16 items-center justify-center rounded-md bg-primary font-display text-2xl font-semibold text-primary-foreground">{initials(s.fullName)}</div>} />
          {p.writeStudents && <ImageUploadButton purpose="student_photo" entityId={s.id} label={s.photoUrl ? "Replace photo" : "Add photo"} testid="upload-student-photo"
            onSaved={(ref) => upd.mutateAsync({ studentId: s.id, data: { photoUrl: ref } }).then((n) => { qc.setQueryData(getGetStudentQueryKey(s.id), n); qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }); toast({ title: "Photo saved" }); })} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-amber-800">{s.admissionNo}</div>
          <h1 data-testid="text-student-name" className="max-md:hidden font-display text-[1.75rem] font-semibold leading-tight [overflow-wrap:anywhere] md:text-4xl">{s.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2"><Pill tone={s.status}>{s.status}</Pill>{s.siblingCount > 0 && <span className="text-xs text-muted-foreground">{s.siblingCount} sibling{s.siblingCount > 1 ? "s" : ""} in school</span>}</div>
        </div>
        {p.writeStudents && <Btn data-testid="button-edit-student" variant="outline" className="w-full md:w-auto" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit record</Btn>}
      </header>

      {p.writeStudents && (
        <FormDialog open={editing} onOpenChange={(o) => { setEditing(o); if (!o) setErr(null); }} busy={upd.isPending} size="lg" title={`Edit record: ${s.fullName}`} description="Changes are recorded in the audit history.">
          <div className="p-5">
            <StudentForm initial={fromStudent(s)} submitLabel="Save changes" pending={upd.isPending} error={err} onCancel={() => { setEditing(false); setErr(null); }}
              onSubmit={(v) => {
                setErr(null);
                upd.mutate({ studentId: s.id, data: toPayload(v) }, {
                  onSuccess: (n) => {
                    qc.setQueryData(getGetStudentQueryKey(s.id), n);
                    [getListStudentsQueryKey(), getGetDashboardSummaryQueryKey(), getListFamiliesQueryKey(), getListGradesQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
                    toast({ title: "Record updated" });
                    setEditing(false);
                  },
                  onError: (x) => setErr(errMsg(x)),
                });
              }} />
          </div>
        </FormDialog>
      )}
      {p.writeStudents && (
        <FormDialog open={linking} onOpenChange={setLinking} busy={false} title={`Link a guardian to ${s.fullName}`} description="Matching phone numbers link siblings automatically.">
          <LinkGuardianForm student={s} canSearch={p.viewGuardians} onDone={() => setLinking(false)} />
        </FormDialog>
      )}
      {(
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Panel title="Record" className="rise-1">
            <dl className="grid grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k} className="min-w-0 border-b border-border/60 px-4 py-3 odd:border-r md:px-5">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
                  <dd className={`mt-0.5 text-sm [overflow-wrap:anywhere] ${k === "Admission no." || k === "UPI" ? "font-mono" : "font-medium"}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Guardians" note={s.familyId ? "Linked to a family group" : undefined} className="rise-2" action={p.writeStudents ? <Btn variant="outline" className="h-8" data-testid="button-add-guardian" onClick={() => setLinking(true)}><Plus className="h-3.5 w-3.5" /> Link</Btn> : undefined}>
            {s.guardianNames.length === 0 ? <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground"><Users className="h-4 w-4" /> No guardian linked yet.</div> : (
              <ul className="divide-y divide-border/60">
                {s.guardianNames.map((g, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3 md:px-5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{initials(g)}</div>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{g}</div>{s.guardianPhones[i] && <a href={`tel:${s.guardianPhones[i]}`} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"><Phone className="h-3 w-3" />{s.guardianPhones[i]}</a>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
      {p.financeRead && <StudentFinancePanel studentId={s.id} />}
      {(p.academicRead || p.financeRead) && <StudentAcademicPanels studentId={s.id} />}
    </div>
  );
}
