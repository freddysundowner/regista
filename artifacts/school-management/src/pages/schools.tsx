import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListPlatformSchools, getListPlatformSchoolsQueryKey, type School } from "@workspace/api-client-react";
import { Building2, ChevronRight, DoorOpen, KeyRound, Pencil, Plus, Search } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, TextInput, NativeSelect, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ProvisionForm, SchoolEditForm } from "@/components/platform-forms";
import { EnterSchoolDialog } from "@/components/platform-kit";
import { errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

export default function Schools() {
  const q = useListPlatformSchools({ query: { queryKey: getListPlatformSchoolsQueryKey() } });
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<School | null>(null);
  const [enter, setEnter] = useState<School | null>(null);
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("all");
  const [sub, setSub] = useState("all");

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (q.data ?? []).filter((s) =>
      (status === "all" || s.status === status) &&
      (sub === "all" || s.subscriptionStatus === sub) &&
      (!t || [s.name, s.code, s.county, s.email, s.subscriptionPlan].some((v) => v?.toLowerCase().includes(t))));
  }, [q.data, term, status, sub]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform console" title="Schools" meta="Every school is an isolated register. Provision, adjust subscriptions, manage administrators, or open an audited support session.">
        <Btn data-testid="button-new-school" onClick={() => { setCreating(true); setNotice(null); }}><Plus className="h-4 w-4" /> Provision school</Btn>
      </PageHeader>
      {notice && <div data-testid="text-provision-notice" className="rise flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm"><KeyRound className="mt-0.5 h-4 w-4 text-primary" />{notice}</div>}

      <FormDialog open={creating} onOpenChange={setCreating} size="lg" title="Provision a new school" description="Creates the school and its first school administrator.">
        <ProvisionForm onCancel={() => setCreating(false)} onDone={(s, signIn) => { setCreating(false); setNotice(`${s.name} provisioned. The administrator signs in with ${signIn}.`); toast({ title: "School provisioned" }); }} />
      </FormDialog>
      <FormDialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }} size="lg" title={`Edit ${edit?.name ?? "school"}`} description="Profile, status and operational subscription.">
        {edit && <SchoolEditForm key={edit.id} school={edit} onDone={() => setEdit(null)} />}
      </FormDialog>
      <EnterSchoolDialog school={enter} open={!!enter} onOpenChange={(o) => { if (!o) setEnter(null); }} />

      <div className="rise-1 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput data-testid="input-search-schools" aria-label="Search schools" placeholder="Search name, code, county, email or plan" className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <NativeSelect data-testid="select-filter-status" aria-label="School status" className="sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></NativeSelect>
        <NativeSelect data-testid="select-filter-subscription" aria-label="Subscription" className="sm:w-44" value={sub} onChange={(e) => setSub(e.target.value)}><option value="all">All subscriptions</option>{["trial", "active", "expired", "cancelled"].map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</NativeSelect>
      </div>

      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty icon={<Building2 className="h-5 w-5" />} title="No schools yet" body="Provision the first school to give its administrator a register."><Btn onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Provision school</Btn></Empty>
        ) : !rows.length ? <Empty icon={<Search className="h-5 w-5" />} title="No matches" body="Try a different search or clear the filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">School</th><th className="px-3 py-2.5">Code</th><th className="hidden px-3 py-2.5 md:table-cell">County · level</th><th className="hidden px-3 py-2.5 lg:table-cell">Registered</th><th className="px-3 py-2.5">Subscription</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} data-testid={`row-school-${s.id}`} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                <td className="px-5 py-3"><Link href={`/schools/${s.id}`} data-testid={`link-school-${s.id}`} className="font-semibold hover:text-primary hover:underline">{s.name}</Link>{s.email && <div className="text-[11px] text-muted-foreground">{s.email}</div>}</td>
                <td className="px-3 py-3 font-mono text-xs">{s.code}</td>
                <td className="hidden px-3 py-3 capitalize md:table-cell">{s.county ?? "\u2014"} · {s.type}</td>
                <td className="hidden px-3 py-3 font-mono text-xs text-muted-foreground lg:table-cell">{fmtDate(s.createdAt)}</td>
                <td className="px-3 py-3 text-xs"><div className="font-semibold">{s.subscriptionPlan || "\u2014"}</div><div className="capitalize text-muted-foreground">{s.subscriptionStatus ?? "\u2014"}{s.subscriptionEndDate && ` · to ${fmtDate(s.subscriptionEndDate)}`}</div></td>
                <td className="px-3 py-3"><Pill tone={s.status === "active" ? "active" : "error"}>{s.status}</Pill></td>
                <td className="px-3 py-3"><div className="flex items-center justify-end gap-0.5">
                  <button data-testid={`button-enter-school-${s.id}`} aria-label={`Enter ${s.name}`} title="Enter school" onClick={() => setEnter(s)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><DoorOpen className="h-3.5 w-3.5" /></button>
                  <button data-testid={`button-edit-school-${s.id}`} aria-label={`Edit ${s.name}`} title="Edit" onClick={() => setEdit(s)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                  <Link href={`/schools/${s.id}`} aria-label={`Manage ${s.name}`} title="Manage" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight className="h-3.5 w-3.5" /></Link>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
          <div className="border-t border-border/60 px-5 py-2 text-xs text-muted-foreground" data-testid="text-school-count">{rows.length} of {q.data.length} schools</div>
          </div>
        )}
      </Panel>
    </div>
  );
}
