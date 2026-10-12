import { useEffect, useState, type FormEvent } from "react";
import { Pager, usePaged } from "@/components/pager";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListGuardians, useCreateGuardian, useUpdateGuardian, useExportGuardian, getExportGuardianQueryKey, useAnonymizeGuardian, getListAuditLogsQueryKey, type Guardian, useListFamilies, getListGuardiansQueryKey, getListFamiliesQueryKey, getGetDashboardSummaryQueryKey, getListStudentsQueryKey } from "@workspace/api-client-react";
import { Download, FileJson, Loader2, Pencil, Plus, Search, ShieldOff, Users } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill, CardTable, Fab } from "@/components/kit";
import { usePerms, errMsg, blank, initials, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FormDialog } from "@/components/form-dialog";

function GuardianForm({ guardian, onDone }: { guardian?: Guardian; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useCreateGuardian();
  const u = useUpdateGuardian();
  const [showId, setShowId] = useState(!!guardian?.idNumber);
  const [f, setF] = useState({ idNumber: guardian?.idNumber ?? "", name: guardian?.name ?? "", phone: guardian?.phone ?? "", altPhone: guardian?.altPhone ?? "", email: guardian?.email ?? "", relationship: guardian?.relationship ?? (guardian ? "" : "Mother") });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const data = { name: f.name.trim(), phone: f.phone.trim(), altPhone: blank(f.altPhone), email: blank(f.email), relationship: blank(f.relationship), ...(showId ? { idNumber: blank(f.idNumber) } : guardian?.idNumber ? { idNumber: null } : {}) };
    const opts = {
      onSuccess: (g: Guardian) => { [getListGuardiansQueryKey(), getGetDashboardSummaryQueryKey(), getListFamiliesQueryKey(), getListStudentsQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k })); toast({ title: guardian ? "Guardian updated" : "Guardian added", description: g.name }); onDone(); },
      onError: (x: unknown) => setErr(errMsg(x)),
    };
    if (guardian) u.mutate({ guardianId: guardian.id, data }, opts); else m.mutate({ data }, opts);
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Full name" required className="lg:col-span-2"><TextInput data-testid="input-guardian-name" required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone" required><TextInput data-testid="input-guardian-phone" type="tel" required minLength={9} value={f.phone} onChange={set("phone")} placeholder="0712 345 678" /></Field>
        <Field label="Alt. phone"><TextInput data-testid="input-guardian-alt" type="tel" value={f.altPhone} onChange={set("altPhone")} /></Field>
        <Field label="Relationship"><NativeSelect data-testid="select-relationship" value={f.relationship} onChange={set("relationship")}><option value="">Not set</option>{["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Other"].map((r) => <option key={r}>{r}</option>)}{f.relationship && !["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Other"].includes(f.relationship) && <option>{f.relationship}</option>}</NativeSelect></Field>
        <Field label="Email" className="lg:col-span-2"><TextInput data-testid="input-guardian-email" type="email" value={f.email} onChange={set("email")} /></Field>
        {showId && <Field label="National ID / passport no." hint="Collect only when the school needs it" className="lg:col-span-2"><TextInput data-testid="input-guardian-id-number" maxLength={40} autoComplete="off" value={f.idNumber} onChange={set("idNumber")} /></Field>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input data-testid="check-guardian-id" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={showId} onChange={(e) => setShowId(e.target.checked)} /> Record ID number (only if needed{guardian?.idNumber ? "; untick to remove it" : ""})</label>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-guardian" type="submit" disabled={m.isPending || u.isPending}>{(m.isPending || u.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{guardian ? "Save changes" : "Save guardian"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

function ExportPanel({ guardian, onClose }: { guardian: Guardian; onClose: () => void }) {
  const q = useExportGuardian(guardian.id, { query: { queryKey: getExportGuardianQueryKey(guardian.id), staleTime: 0, gcTime: 0 } });
  const download = () => {
    if (!q.data) return;
    const blob = new Blob([JSON.stringify(q.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `guardian-export-${guardian.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div>
      {q.isLoading ? <SkeletonRows rows={3} cols={2} /> : q.isError || !q.data ? <ErrorState msg={errMsg(q.error, "Export failed")} onRetry={() => q.refetch()} /> : (
        <div className="space-y-3 p-5">
          <p className="text-xs text-muted-foreground">Exported {fmtDateTime(q.data.exportedAt)} (your local time) · {q.data.links.length} learner link{q.data.links.length === 1 ? "" : "s"}</p>
          <pre data-testid="text-guardian-export" className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/30 p-3 font-mono text-[11px]">{JSON.stringify(q.data, null, 2)}</pre>
          <FormActions><Btn data-testid="button-download-export" onClick={download}><Download className="h-4 w-4" /> Download JSON</Btn><Btn variant="ghost" onClick={onClose} data-testid="button-close-export">Close</Btn></FormActions>
        </div>
      )}
    </div>
  );
}

function AnonymizePanel({ guardian, onClose }: { guardian: Guardian; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useAnonymizeGuardian();
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = typed === "ANONYMIZE" && ack;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!ready) return;
    m.mutate({ guardianId: guardian.id, data: { confirmation: "ANONYMIZE" } }, {
      onSuccess: () => {
        [getListGuardiansQueryKey(), getListFamiliesQueryKey(), getListStudentsQueryKey(), getGetDashboardSummaryQueryKey(), getListAuditLogsQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0].startsWith("/api/students/") || q.queryKey[0].startsWith("/api/guardians/")) });
        toast({ title: "Guardian anonymized", description: "Personal details removed. Learner links and history kept." });
        onClose();
      },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
      <form onSubmit={submit} className="space-y-4 p-5">
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/80">
          <li>Name, phone, alternate phone, email and ID number are permanently removed.</li>
          <li>Links to {guardian.studentCount} learner{guardian.studentCount === 1 ? "" : "s"} and the audit trail are kept; notifications to this contact stop.</li>
          <li>No financial records are deleted. The record cannot be edited afterwards.</li>
        </ul>
        <label className="flex items-start gap-2 text-sm"><input data-testid="check-anonymize-ack" type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--destructive))]" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have verified this request and exported the data if the guardian asked for a copy.</label>
        <Field label='Type ANONYMIZE to confirm' required><TextInput data-testid="input-anonymize-confirm" autoComplete="off" className="max-w-xs font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
        <FormError msg={err} />
        <FormActions>
          <Btn data-testid="button-confirm-anonymize" type="submit" variant="danger" disabled={!ready || m.isPending}>{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}Anonymize permanently</Btn>
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
        </FormActions>
      </form>
  );
}

export default function Guardians() {
  const p = usePerms();
  const [tab, setTab] = useState<"guardians" | "families">("guardians");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Guardian | null>(null);
  const [exporting, setExporting] = useState<Guardian | null>(null);
  const [anonymizing, setAnonymizing] = useState<Guardian | null>(null);
  const [term, setTerm] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => { const t = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const params = deb ? { search: deb } : undefined;
  const g = useListGuardians(params, { query: { queryKey: getListGuardiansQueryKey(params) } });
  const fam = useListFamilies({ query: { queryKey: getListFamiliesQueryKey(), enabled: tab === "families" } });
  const gp = usePaged(g.data, params);
  const fp = usePaged(fam.data, undefined, 12);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Contacts" title="Guardians & families" meta="Siblings are grouped when they share a guardian phone number.">
        {p.writeStudents && <Btn data-testid="button-new-guardian" className="max-md:hidden" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add guardian</Btn>}
      </PageHeader>
      <FormDialog open={creating} onOpenChange={setCreating} size="lg" title="Add a guardian" description="Guardians can be linked to learners from the student record."><GuardianForm onDone={() => setCreating(false)} /></FormDialog>
      <FormDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} size="lg" title={editing ? `Edit ${editing.name}` : "Edit guardian"} description="Phone changes affect sibling matching for future imports.">{editing && <GuardianForm key={editing.id} guardian={editing} onDone={() => setEditing(null)} />}</FormDialog>
      <FormDialog open={!!exporting} onOpenChange={(o) => { if (!o) setExporting(null); }} size="lg" title={exporting ? `Data export: ${exporting.name}` : "Data export"} description="Everything Rejista holds about this guardian, for a data subject request.">{exporting && <ExportPanel key={exporting.id} guardian={exporting} onClose={() => setExporting(null)} />}</FormDialog>
      <FormDialog open={!!anonymizing} onOpenChange={(o) => { if (!o) setAnonymizing(null); }} title={anonymizing ? `Anonymize ${anonymizing.name}` : "Anonymize guardian"} description="Irreversible. For erasure requests only.">{anonymizing && <AnonymizePanel key={anonymizing.id} guardian={anonymizing} onClose={() => setAnonymizing(null)} />}</FormDialog>

      <div className="rise rise-1 inline-flex rounded-md border border-border bg-card p-0.5">
        {(["guardians", "families"] as const).map((t) => (
          <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)} className={cn("rounded px-4 py-1.5 text-sm font-semibold capitalize transition", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
      </div>

      {tab === "guardians" ? (
        <Panel className="rise-2">
          <div className="border-b border-border/70 p-3">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input data-testid="input-search-guardians" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name or phone" className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></div>
          </div>
          {g.isLoading ? <SkeletonRows cols={4} /> : g.isError ? <ErrorState msg={errMsg(g.error)} onRetry={() => g.refetch()} /> : !g.data?.length ? <Empty icon={<Users className="h-5 w-5" />} title={deb ? "No matches" : "No guardians yet"} body={deb ? "Check the spelling or phone number." : "Guardians are created when you admit students, import, or add them here."} /> : (
            <CardTable testid="table-guardians"><table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">Guardian</th><th className="px-3 py-2.5">Phone</th><th className="hidden px-3 py-2.5 md:table-cell">Relationship</th><th className="px-3 py-2.5">Learners</th>{(p.writeStudents || p.manageGuardianPrivacy) && <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>{gp.rows.map((x) => (
                <tr key={x.id} data-testid={`row-guardian-${x.id}`} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                  <td className="px-5 py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">{initials(x.name)}</span><div><div className="font-semibold">{x.name}{x.anonymizedAt && <span className="ml-2"><Pill tone="inactive">Anonymized</Pill></span>}</div>{x.email && <div className="text-[11px] text-muted-foreground">{x.email}</div>}</div></div></td>
                  <td className="px-3 py-3 font-mono text-xs">{x.anonymizedAt ? <span className="font-sans text-muted-foreground">Removed</span> : x.phone}{x.altPhone && <div className="text-muted-foreground">{x.altPhone}</div>}</td>
                  <td className="hidden px-3 py-3 md:table-cell">{x.relationship ?? "—"}</td>
                  <td className="px-3 py-3">{x.studentCount === 0 ? <span className="text-muted-foreground">None linked</span> : <span title={x.studentNames.join(", ")}>{x.studentNames.slice(0, 2).join(", ")}{x.studentCount > 2 && <span className="text-muted-foreground"> +{x.studentCount - 2}</span>}</span>}</td>
                  {(p.writeStudents || p.manageGuardianPrivacy) && <td className="px-3 py-3"><div className="flex items-center gap-0.5">
                    {p.writeStudents && !x.anonymizedAt && <button data-testid={`button-edit-guardian-${x.id}`} title="Edit guardian" aria-label={`Edit ${x.name}`} onClick={() => { setCreating(false); setExporting(null); setAnonymizing(null); setEditing(x); }} className="rounded p-1.5 text-muted-foreground max-md:border max-md:border-border max-md:p-3 hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                    {p.manageGuardianPrivacy && <button data-testid={`button-export-guardian-${x.id}`} title="Export data" aria-label={`Export data for ${x.name}`} onClick={() => { setEditing(null); setAnonymizing(null); setExporting(x); }} className="rounded p-1.5 text-muted-foreground max-md:border max-md:border-border max-md:p-3 hover:bg-muted hover:text-foreground"><FileJson className="h-3.5 w-3.5" /></button>}
                    {p.manageGuardianPrivacy && !x.anonymizedAt && <button data-testid={`button-anonymize-guardian-${x.id}`} title="Anonymize" aria-label={`Anonymize ${x.name}`} onClick={() => { setEditing(null); setExporting(null); setAnonymizing(x); }} className="rounded p-1.5 text-muted-foreground max-md:border max-md:border-border max-md:p-3 hover:bg-destructive/10 hover:text-destructive"><ShieldOff className="h-3.5 w-3.5" /></button>}
                  </div></td>}
                </tr>))}</tbody>
            </table></CardTable>
          )}
          <Pager {...gp.pager} />
        </Panel>
      ) : (
        fam.isLoading ? <Panel><SkeletonRows /></Panel> : fam.isError ? <Panel><ErrorState msg={errMsg(fam.error)} onRetry={() => fam.refetch()} /></Panel> : !fam.data?.length ? <Panel><Empty icon={<Users className="h-5 w-5" />} title="No families yet" body="Families form automatically when two or more learners share a guardian." /></Panel> : (
          <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {fp.rows.map((f, i) => (
              <article key={f.id} data-testid={`card-family-${f.id}`} className="rise rounded-lg border border-card-border bg-card" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="border-b border-dashed border-border px-4 py-3">
                  <h3 className="font-display text-lg font-semibold">{f.name}</h3>
                  <p className="text-xs text-muted-foreground">{f.guardianNames.join(" · ") || "No guardian names"}</p>
                </div>
                <ul className="divide-y divide-border/50">{f.students.map((s) => (
                  <li key={s.id}><Link href={`/students/${s.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-accent/30"><span className="font-medium">{s.name}</span><span className="text-xs text-muted-foreground"><span className="font-mono">{s.admissionNo}</span>{s.gradeName && ` · ${s.gradeName}`}</span></Link></li>
                ))}</ul>
              </article>
            ))}
          </div><Pager {...fp.pager} className="rounded-xl border border-border bg-card" /></div>
        )
      )}
      {p.writeStudents && <Fab testid="fab-new-guardian" label="Add guardian" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} />}
    </div>
  );
}
