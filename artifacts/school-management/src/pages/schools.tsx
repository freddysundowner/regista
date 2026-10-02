import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListSchools, useCreateSchool, getListSchoolsQueryKey, SchoolType } from "@workspace/api-client-react";
import { Building2, KeyRound, Loader2, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { COUNTIES } from "@/pages/auth";
import { useSession, errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const EMPTY = { schoolName: "", schoolCode: "", county: "", schoolType: "primary" as SchoolType, adminName: "", email: "", phone: "", password: "" };

function ProvisionForm({ onDone }: { onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const m = useCreateSchool();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.email.trim() && !f.phone.trim()) return setErr("The school administrator needs an email or phone to sign in.");
    if (f.password.length < 10) return setErr("Initial password must be at least 10 characters.");
    m.mutate({ data: { schoolName: f.schoolName.trim(), schoolCode: f.schoolCode.trim().toUpperCase(), county: f.county || undefined, schoolType: f.schoolType, adminName: f.adminName.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, password: f.password } }, {
      onSuccess: (s) => { qc.invalidateQueries({ queryKey: getListSchoolsQueryKey() }); onDone(`${s.name} provisioned. ${f.adminName.trim()} signs in with ${f.email.trim() || f.phone.trim()}.`); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="School name" required className="lg:col-span-2"><TextInput data-testid="input-new-school-name" required minLength={2} value={f.schoolName} onChange={set("schoolName")} /></Field>
        <Field label="School code" required><TextInput data-testid="input-new-school-code" required minLength={2} className="font-mono uppercase" value={f.schoolCode} onChange={set("schoolCode")} /></Field>
        <Field label="Level"><NativeSelect data-testid="select-new-school-type" value={f.schoolType} onChange={set("schoolType")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="County"><NativeSelect data-testid="select-new-county" value={f.county} onChange={set("county")}><option value="">Select county</option>{COUNTIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
      </div>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>Initial school administrator</span><span className="h-px flex-1 bg-border" /></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Full name" required><TextInput data-testid="input-new-admin-name" required minLength={2} value={f.adminName} onChange={set("adminName")} /></Field>
        <Field label="Email" hint="Email or phone required"><TextInput data-testid="input-new-admin-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-new-admin-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Initial password" required hint="Share privately; at least 10 characters"><TextInput data-testid="input-new-admin-password" type="password" required value={f.password} onChange={set("password")} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-provision-school" type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Provision school</Btn>
        <Btn type="button" variant="ghost" onClick={() => onDone("")}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

export default function Schools() {
  const { school: mine } = useSession();
  const q = useListSchools({ query: { queryKey: getListSchoolsQueryKey() } });
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform owner" title="Schools" meta="Each school is a separate register. Its administrators sign in on their own; there is no switching between schools.">
        {!creating && <Btn data-testid="button-new-school" onClick={() => { setCreating(true); setNotice(null); }}><Plus className="h-4 w-4" /> Provision school</Btn>}
      </PageHeader>
      {notice && <div data-testid="text-provision-notice" className="rise flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm"><KeyRound className="mt-0.5 h-4 w-4 text-primary" />{notice}</div>}
      {creating && <Panel title="Provision a new school" note="Creates the school and its first school administrator."><ProvisionForm onDone={(msg) => { setCreating(false); if (msg) { setNotice(msg); toast({ title: "School provisioned" }); } }} /></Panel>}
      <Panel className="rise-1">
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Building2 className="h-5 w-5" />} title="No schools listed" body="Provisioned schools appear here." /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-border/70"><th className="px-5 py-2.5">School</th><th className="px-3 py-2.5">Code</th><th className="hidden px-3 py-2.5 md:table-cell">County · level</th><th className="hidden px-3 py-2.5 md:table-cell">Registered</th><th className="px-3 py-2.5">Status</th></tr></thead>
            <tbody>{q.data.map((s) => (
              <tr key={s.id} data-testid={`row-school-${s.id}`} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                <td className="px-5 py-3"><span className="font-semibold">{s.name}</span>{s.id === mine.id && <span className="ml-2 text-xs text-muted-foreground">(your school)</span>}{s.email && <div className="text-[11px] text-muted-foreground">{s.email}</div>}</td>
                <td className="px-3 py-3 font-mono text-xs">{s.code}</td>
                <td className="hidden px-3 py-3 capitalize md:table-cell">{s.county ?? "—"} · {s.type}</td>
                <td className="hidden px-3 py-3 font-mono text-xs text-muted-foreground md:table-cell">{fmtDate(s.createdAt)}</td>
                <td className="px-3 py-3"><Pill tone={s.status === "active" ? "active" : "error"}>{s.status}</Pill></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
