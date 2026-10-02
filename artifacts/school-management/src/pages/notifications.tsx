import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListMessageDeliveries, useSendSchoolMessage, useListGuardians, getListMessageDeliveriesQueryKey, getListGuardiansQueryKey, type MessageInputChannel } from "@workspace/api-client-react";
import { Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { Table, td } from "@/components/finance-kit";
import { usePerms, errMsg } from "@/lib/session";
import { useIdemKey } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";

const TEMPLATES: Record<string, string> = { general: "General notice", fee_reminder: "Fee reminder", event: "Event / closing day", absence: "Absence follow-up" };
const STATUS: Record<string, { tone: string; label: string }> = {
  queued: { tone: "left", label: "Queued" }, submitted: { tone: "duplicate", label: "Submitted, not confirmed delivered" },
  delivered: { tone: "active", label: "Delivered" }, failed: { tone: "error", label: "Failed" }, read: { tone: "active", label: "Read" },
};

function Compose() {
  const m = useSendSchoolMessage(); const qc = useQueryClient(); const { toast } = useToast();
  const [search, setSearch] = useState("");
  const params = search.trim().length >= 2 ? { search: search.trim() } : undefined;
  const g = useListGuardians(params, { query: { queryKey: getListGuardiansQueryKey(params) } });
  const [f, setF] = useState({ guardianId: "", channel: "whatsapp" as MessageInputChannel, template: "", content: "" });
  const [err, setErr] = useState<string | null>(null);
  const idem = useIdemKey(JSON.stringify(f));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.guardianId) return setErr("Choose the guardian.");
    if (!f.template) return setErr("Enter the template name configured for your school.");
    if (f.content.trim().length < 5) return setErr("Write the message.");
    m.mutate({ data: { ...f, content: f.content.trim(), idempotencyKey: idem.key } }, {
      onSuccess: (r) => { idem.renew(); qc.invalidateQueries({ queryKey: getListMessageDeliveriesQueryKey() }); toast({ title: `Message ${r.status}`, description: r.status === "failed" ? r.error : "Track delivery below. Submission is not delivery." }); setF({ ...f, content: "" }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const list = (g.data ?? []).filter((x) => !x.anonymizedAt).slice(0, 200);
  return (
    <Panel title="Send message" note="The template name must match one configured for your school. Free text on WhatsApp only works within 24 hours of the guardian messaging you. Opt-outs are enforced by the server; a blocked or unconfigured send shows its reason.">
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Find guardian" hint="Name or phone"><TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type 2+ letters" /></Field>
          <Field label="Guardian" required><NativeSelect data-testid="select-guardian" value={f.guardianId} onChange={(e) => setF({ ...f, guardianId: e.target.value })}><option value="">{g.isLoading ? "Loading" : list.length ? "Select" : "No match"}</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.phone}{x.studentNames.length ? ` · ${x.studentNames.join(", ")}` : ""}</option>)}</NativeSelect></Field>
          <Field label="Channel" required><NativeSelect value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as MessageInputChannel })}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></NativeSelect></Field>
          <Field label="Template name" required hint="Exactly as approved in your WhatsApp/vendor account"><TextInput data-testid="input-template" list="template-suggestions" className="font-mono" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value.trim() })} /><datalist id="template-suggestions">{Object.keys(TEMPLATES).map((k) => <option key={k} value={k} />)}</datalist></Field>
          <Field label="Message" required className="sm:col-span-2 lg:col-span-4" hint={f.channel === "sms" ? `${f.content.length} characters; ${Math.max(1, Math.ceil(f.content.length / 160))} SMS` : undefined}>
            <textarea data-testid="input-message" rows={4} maxLength={1000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </Field>
        </div>
        <FormError msg={err} />
        <FormActions><Btn type="submit" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send</Btn></FormActions>
      </form>
    </Panel>
  );
}

export default function Notifications() {
  const p = usePerms();
  const q = useListMessageDeliveries({ query: { queryKey: getListMessageDeliveriesQueryKey() } });
  const [st, setSt] = useState("");
  const list = (q.data ?? []).filter((x) => !st || x.status === st);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Communication" title="Messages" meta="WhatsApp first, SMS fallback. Live delivery through LeadsIntel and Africa's Talking is not verified on this install.">
        <Btn variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className="h-4 w-4" />Refresh</Btn>
      </PageHeader>
      {p.notify && <Compose />}
      <Panel title="Delivery log" action={<NativeSelect aria-label="Status" className="h-8 w-36 text-xs" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All statuses</option>{Object.keys(STATUS).map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>}>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? <Empty icon={<MessageSquare className="h-5 w-5" />} title="No messages" body="Receipts, reminders and notices sent to guardians are tracked here." /> : (
          <Table head={["Template", "Channel", "Status", "Attempts", "Provider ref / error"]}>{list.map((x) => { const s = STATUS[x.status] ?? { tone: "left", label: x.status }; return (
            <tr key={x.id} data-testid={`row-message-${x.id}`}><td className={`${td} font-mono text-xs`}>{x.template}</td><td className={`${td} text-xs uppercase`}>{x.channel}</td><td className={td}><Pill tone={s.tone}>{s.label}</Pill></td><td className={td}>{x.attempts}</td><td className={`${td} text-xs`}>{x.error ? <span className="text-destructive">{x.error}</span> : <span className="font-mono text-muted-foreground">{x.providerMessageId ?? "\u2014"}</span>}</td></tr>); })}</Table>
        )}
      </Panel>
    </div>
  );
}
