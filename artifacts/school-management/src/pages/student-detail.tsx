import { usePageTitle } from "@/lib/page-title";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGenerateStudentIdCard, useGetStudent, useUpdateStudent, useLinkStudentGuardian, useListGuardians, getListGuardiansQueryKey, type Student, getGetStudentQueryKey, getListStudentsQueryKey, getGetDashboardSummaryQueryKey, getListFamiliesQueryKey, getListGradesQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, IdCard, ImageUp, Loader2, MoreHorizontal, Pencil, Phone, Plus, Trash2, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LearnerOverview } from "@/components/learner-overview";
import { Panel, ErrorState, Pill, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { StudentForm, fromStudent, toPayload } from "@/components/student-form";
import { usePerms, errMsg, fmtDate, initials, blank } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { StoredImage, ImageUploadButton } from "@/components/stored-image";
import { RemoveLearner } from "@/components/remove-learner";

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
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const upd = useUpdateStudent();
  const idCard = useGenerateStudentIdCard();
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
    <div className="space-y-5">
      <Link href="/students" data-testid="link-back" className="max-md:hidden inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Learners</Link>
      {/* Phone: the top bar already shows the name, so this is one slim row: photo, class line, edit and more. */}
      <header className="rise flex flex-wrap items-center gap-x-4 gap-y-3 max-md:flex-nowrap max-md:gap-x-2.5">
        <StoredImage refPath={s.photoUrl} alt={`Photo of ${s.fullName}`} className="h-14 w-14 shrink-0 rounded-full object-cover max-md:h-10 max-md:w-10 md:h-16 md:w-16" fallback={<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-xl font-semibold text-primary max-md:h-10 max-md:w-10 max-md:text-sm md:h-16 md:w-16">{initials(s.fullName)}</div>} />
        <div className="min-w-0 flex-1">
          <h1 data-testid="text-student-name" className="font-display text-2xl font-semibold leading-tight [overflow-wrap:anywhere] max-md:hidden md:text-3xl">{s.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground max-md:mt-0 max-md:gap-x-1.5 max-md:text-[13px]">
            <span>{s.gradeName ? `${s.gradeName}${s.streamName ? " " + s.streamName : ""}` : "No class yet"}</span><span aria-hidden="true">·</span>
            <span className="font-mono text-xs">{s.admissionNo}</span><span aria-hidden="true">·</span>
            <span>{s.boardingStatus === "boarder" ? "Boarder" : "Day scholar"}</span>
            {s.status !== "active" && <Pill tone={s.status}>{s.status}</Pill>}
          </div>
        </div>
        {/* The identity card: a print-ready PDF, front and back. Open to anyone who can see the learner. */}
        <Btn data-testid="button-student-id-card" variant="outline" aria-label="ID card" className="shrink-0 max-md:px-2.5" disabled={idCard.isPending}
          onClick={() => idCard.mutate({ studentId: s.id }, { onSuccess: (d) => window.open(d.downloadUrl, "_blank", "noopener"), onError: (x) => toast({ title: "Couldn't create the ID card", description: errMsg(x), variant: "destructive" }) })}>
          {idCard.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <IdCard className="h-4 w-4" />}<span className="max-md:hidden"> ID card</span>
        </Btn>
        {p.writeStudents && <div className="flex shrink-0 items-center gap-2 max-md:gap-1.5">
          <Btn data-testid="button-edit-student" variant="outline" aria-label="Edit details" className="max-md:px-2.5" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /><span className="max-md:hidden"> Edit details</span></Btn>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Btn variant="outline" className="px-2.5" aria-label={`More for ${s.fullName}`} data-testid="button-student-more"><MoreHorizontal className="h-4 w-4" /></Btn></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => document.querySelector<HTMLInputElement>("[data-testid=input-upload-student-photo]")?.click()}><ImageUp className="h-4 w-4" />{s.photoUrl ? "Change photo" : "Add photo"}</DropdownMenuItem>
              {p.manageSchool && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setRemoving(true)} className="text-destructive focus:text-destructive" data-testid="button-remove-student"><Trash2 className="h-4 w-4" />Delete learner</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <ImageUploadButton hideButton purpose="student_photo" entityId={s.id} label={s.photoUrl ? "Change photo" : "Add photo"} testid="upload-student-photo"
            onSaved={(ref) => upd.mutateAsync({ studentId: s.id, data: { photoUrl: ref } }).then((n) => { qc.setQueryData(getGetStudentQueryKey(s.id), n); qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }); toast({ title: "Photo saved" }); })} />
          {p.manageSchool && <RemoveLearner student={s} open={removing} onOpenChange={setRemoving} />}
        </div>}
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

      <LearnerOverview student={s} onLinkGuardian={p.writeStudents ? () => setLinking(true) : undefined} />

      <details className="group rounded-xl border border-border bg-card" data-testid="learner-details">
        <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold">Learner details <span className="font-normal text-muted-foreground">· date of birth, UPI, admission date</span></summary>
        <dl className="grid grid-cols-2 border-t border-border/60">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0 border-b border-border/60 px-4 py-3 odd:border-r md:px-5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
              <dd className={`mt-0.5 text-sm [overflow-wrap:anywhere] ${k === "Admission no." || k === "UPI" ? "font-mono" : "font-medium"}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
