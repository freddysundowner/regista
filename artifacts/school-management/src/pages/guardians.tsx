import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListGuardians, useCreateGuardian, useUpdateGuardian, type Guardian, useListFamilies, getListGuardiansQueryKey, getListFamiliesQueryKey, getGetDashboardSummaryQueryKey, getListStudentsQueryKey } from "@workspace/api-client-react";
import { Loader2, Pencil, Plus, Search, Users } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { usePerms, errMsg, blank, initials } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function GuardianForm({ guardian, onDone }: { guardian?: Guardian; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useCreateGuardian();
  const u = useUpdateGuardian();
  const [f, setF] = useState({ name: guardian?.name ?? "", phone: guardian?.phone ?? "", altPhone: guardian?.altPhone ?? "", email: guardian?.email ?? "", relationship: guardian?.relationship ?? (guardian ? "" : "Mother") });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const data = { name: f.name.trim(), phone: f.phone.trim(), altPhone: blank(f.altPhone), email: blank(f.email), relationship: blank(f.relationship) };
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
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-guardian" type="submit" disabled={m.isPending || u.isPending}>{(m.isPending || u.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{guardian ? "Save changes" : "Save guardian"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export default function Guardians() {
  const p = usePerms();
  const [tab, setTab] = useState<"guardians" | "families">("guardians");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Guardian | null>(null);
  const [term, setTerm] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => { const t = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const params = deb ? { search: deb } : undefined;
  const g = useListGuardians(params, { query: { queryKey: getListGuardiansQueryKey(params) } });
  const fam = useListFamilies({ query: { queryKey: getListFamiliesQueryKey(), enabled: tab === "families" } });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Contacts" title="Guardians & families" meta="Siblings are grouped when they share a guardian phone number.">
        {p.writeStudents && !creating && <Btn data-testid="button-new-guardian" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add guardian</Btn>}
      </PageHeader>
      {creating && <Panel title="New guardian"><GuardianForm onDone={() => setCreating(false)} /></Panel>}
      {editing && <Panel title={`Edit ${editing.name}`} note="Phone changes affect sibling matching for future imports."><GuardianForm key={editing.id} guardian={editing} onDone={() => setEditing(null)} /></Panel>}

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
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">Guardian</th><th className="px-3 py-2.5">Phone</th><th className="hidden px-3 py-2.5 md:table-cell">Relationship</th><th className="px-3 py-2.5">Learners</th>{p.writeStudents && <th className="w-10" />}</tr></thead>
              <tbody>{g.data.map((x) => (
                <tr key={x.id} data-testid={`row-guardian-${x.id}`} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                  <td className="px-5 py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">{initials(x.name)}</span><div><div className="font-semibold">{x.name}</div>{x.email && <div className="text-[11px] text-muted-foreground">{x.email}</div>}</div></div></td>
                  <td className="px-3 py-3 font-mono text-xs">{x.phone}{x.altPhone && <div className="text-muted-foreground">{x.altPhone}</div>}</td>
                  <td className="hidden px-3 py-3 md:table-cell">{x.relationship ?? "—"}</td>
                  <td className="px-3 py-3">{x.studentCount === 0 ? <span className="text-muted-foreground">None linked</span> : <span title={x.studentNames.join(", ")}>{x.studentNames.slice(0, 2).join(", ")}{x.studentCount > 2 && <span className="text-muted-foreground"> +{x.studentCount - 2}</span>}</span>}</td>
                  {p.writeStudents && <td className="px-3 py-3"><button data-testid={`button-edit-guardian-${x.id}`} title="Edit guardian" onClick={() => { setCreating(false); setEditing(x); }} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button></td>}
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>
      ) : (
        fam.isLoading ? <Panel><SkeletonRows /></Panel> : fam.isError ? <Panel><ErrorState msg={errMsg(fam.error)} onRetry={() => fam.refetch()} /></Panel> : !fam.data?.length ? <Panel><Empty icon={<Users className="h-5 w-5" />} title="No families yet" body="Families form automatically when two or more learners share a guardian." /></Panel> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {fam.data.map((f, i) => (
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
          </div>
        )
      )}
    </div>
  );
}
