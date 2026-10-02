import { useState, type FormEvent } from "react";
import { useCreateFinanceRecord, useUpdateFinanceRecord, type FinanceRecord, type FinanceInputSponsorType } from "@workspace/api-client-react";
import { HandHeart, Loader2, Pencil, Plus } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions } from "@/components/kit";
import { useFinanceRecords, Money } from "@/components/finance-kit";
import { usePerms, errMsg } from "@/lib/session";
import { useFinanceInvalidate, useIdemKey, rd, sumMoney, SPONSOR_LABEL } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

export default function Sponsors() {
  const p = usePerms();
  const q = useFinanceRecords({ kind: "sponsor" });
  const adj = useFinanceRecords({ kind: "adjustment" });
  const create = useCreateFinanceRecord();
  const upd = useUpdateFinanceRecord();
  const inv = useFinanceInvalidate();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | FinanceRecord | null>(null);
  const [f, setF] = useState({ name: "", sponsorType: "ngcdf" as FinanceInputSponsorType, contact: "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const open = (r?: FinanceRecord) => { setErr(null); setF(r ? { name: rd(r, "name") ?? "", sponsorType: (rd(r, "sponsorType") ?? "other") as FinanceInputSponsorType, contact: rd(r, "contact") ?? "", reason: "" } : { name: "", sponsorType: "ngcdf", contact: "", reason: "" }); setMode(r ?? "new"); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.name.trim().length < 2 || f.contact.trim().length < 3) return setErr("Name and a contact (person, phone or email) are required.");
    if (mode === "new") create.mutate({ data: { kind: "sponsor", idempotencyKey: idem.key, name: f.name.trim(), sponsorType: f.sponsorType, contact: f.contact.trim() } }, { onSuccess: () => { idem.renew(); inv(); toast({ title: "Sponsor added" }); setMode(null); }, onError: (x) => setErr(errMsg(x)) });
    else if (mode) {
      if (f.reason.trim().length < 3) return setErr("Give a reason for the change.");
      upd.mutate({ id: mode.id, data: { name: f.name.trim(), contact: f.contact.trim(), reason: f.reason.trim() } }, { onSuccess: () => { inv(); toast({ title: "Sponsor updated" }); setMode(null); }, onError: (x) => setErr(errMsg(x)) });
    }
  };
  const funded = (id: string) => (adj.data ?? []).filter((a) => rd(a, "sponsorId") === id && (a.status === "approved" || a.status === "posted"));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Bursaries & sponsorship" title="Sponsors" meta="NG-CDF, county, church and other funders behind bursary and sponsorship adjustments.">
        {p.financeConfigure && !mode && <Btn data-testid="button-new-sponsor" onClick={() => open()}><Plus className="h-4 w-4" /> Add sponsor</Btn>}
      </PageHeader>
      {mode && <Panel title={mode === "new" ? "New sponsor" : `Edit ${rd(mode, "name")}`}>
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" required><TextInput data-testid="input-sponsor-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kibra NG-CDF" /></Field>
            <Field label="Type" required hint={mode !== "new" ? "Fixed after creation" : undefined}><NativeSelect data-testid="select-sponsor-type" disabled={mode !== "new"} value={f.sponsorType} onChange={(e) => setF({ ...f, sponsorType: e.target.value as FinanceInputSponsorType })}>{Object.entries(SPONSOR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
            <Field label="Contact" required hint="Person, phone or email"><TextInput data-testid="input-sponsor-contact" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
            {mode !== "new" && <Field label="Reason for change" required><TextInput value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
          </div>
          <FormError msg={err} />
          <FormActions><Btn type="submit" data-testid="button-save-sponsor" disabled={create.isPending || upd.isPending}>{(create.isPending || upd.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "new" ? "Add sponsor" : "Save"}</Btn><Btn type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Btn></FormActions>
        </form>
      </Panel>}
      <Panel>
        {q.isLoading ? <SkeletonRows rows={4} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<HandHeart className="h-5 w-5" />} title="No sponsors" body="Add funders before requesting bursary or sponsorship adjustments." /> : (
          <ul className="divide-y divide-border/60">{q.data.map((r) => { const fs = funded(r.id); return (
            <li key={r.id} data-testid={`row-sponsor-${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-[12rem] flex-1"><div className="font-semibold">{rd(r, "name")}</div><div className="text-xs text-muted-foreground">{SPONSOR_LABEL[rd(r, "sponsorType") ?? ""] ?? rd(r, "sponsorType")} · {rd(r, "contact")}</div></div>
              <div className="text-right text-xs"><Money v={sumMoney(fs.map((a) => a.amount))} className="text-sm font-semibold" /><div className="text-muted-foreground">{fs.length} approved award{fs.length === 1 ? "" : "s"}</div></div>
              {p.financeConfigure && <button aria-label={`Edit ${rd(r, "name")}`} onClick={() => open(r)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
            </li>); })}</ul>
        )}
      </Panel>
    </div>
  );
}
