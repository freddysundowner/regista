import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSchool, useUpdateSchool, getGetSchoolQueryKey, getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey, SchoolType, type School } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { PageHeader, Panel, ErrorState, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { errMsg, blank, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

function SchoolForm({ school }: { school: School }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateSchool();
  const init = { name: school.name, county: school.county ?? "", type: school.type, address: school.address ?? "", phone: school.phone ?? "", email: school.email ?? "" };
  const [f, setF] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ data: { name: f.name.trim(), county: blank(f.county), type: f.type as SchoolType, address: blank(f.address), phone: blank(f.phone), email: blank(f.email) } }, {
      onSuccess: (s) => { qc.setQueryData(getGetSchoolQueryKey(), s); qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast({ title: "School profile saved" }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School name" required className="sm:col-span-2"><TextInput data-testid="input-school-name" required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="School code" hint="Set at setup; cannot be changed"><TextInput disabled className="font-mono" value={school.code} /></Field>
        <Field label="Level"><NativeSelect data-testid="select-type" value={f.type} onChange={set("type")}>{Object.values(SchoolType).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="County"><TextInput data-testid="input-county" value={f.county} onChange={set("county")} /></Field>
        <Field label="Phone"><TextInput data-testid="input-phone" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Email"><TextInput data-testid="input-email" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Postal / physical address"><TextInput data-testid="input-address" value={f.address} onChange={set("address")} placeholder="P.O. Box 1234-00100, Nairobi" /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-school" type="submit" disabled={!dirty || m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save profile</Btn>
        {dirty && <Btn type="button" variant="ghost" onClick={() => setF(init)}>Discard changes</Btn>}
        <span className="ml-auto text-xs text-muted-foreground">Registered {fmtDate(school.createdAt)} · {school.status}</span>
      </FormActions>
    </form>
  );
}

export default function SettingsPage() {
  const q = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title="School profile" meta="Appears on staff screens and future documents." />
      <Panel className="max-w-3xl">
        {q.isLoading ? <div className="grid gap-4 p-5 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded bg-muted" />)}</div> :
          q.isError || !q.data ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : <SchoolForm key={q.data.id} school={q.data} />}
      </Panel>
    </div>
  );
}
