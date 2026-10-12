import { useState, type FormEvent } from "react";
import { Pager, usePaged } from "@/components/pager";
import { useQueryClient } from "@tanstack/react-query";
import { useListMessageDeliveries, useSendSchoolMessage, useBroadcastSchoolMessage, useGetMessageAudience, getGetMessageAudienceQueryKey, useListGuardians, getListMessageDeliveriesQueryKey, getListGuardiansQueryKey, type MessageInputChannel } from "@workspace/api-client-react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { Table, td, GradeSelect } from "@/components/finance-kit";
import { cn } from "@/lib/utils";
import { usePerms, errMsg } from "@/lib/session";
import { useIdemKey } from "@/lib/finance";
import { useToast } from "@/hooks/use-toast";
import { FormDialog } from "@/components/form-dialog";

const TEMPLATES: Record<string, string> = { general: "General notice", fee_reminder: "Fee reminder", event: "Event / closing day", absence: "Absence follow-up" };
const STATUS: Record<string, { tone: string; label: string }> = {
  queued: { tone: "left", label: "Waiting to send" }, submitted: { tone: "duplicate", label: "Sent" },
  delivered: { tone: "active", label: "Delivered" }, failed: { tone: "error", label: "Failed" }, read: { tone: "active", label: "Read" },
  sending: { tone: "duplicate", label: "Sending" },
  uncertain: { tone: "error", label: "Not sure it arrived" },
  rejected: { tone: "error", label: "Not sent" },
  cancelled: { tone: "left", label: "Cancelled" },
};

/** With `guardian` the recipient is fixed and the message can be prefilled, for use on the learner page. */
export function Compose({ onDone, guardian, template = "", content = "" }: { onDone: () => void; guardian?: { id: string; name: string; phone: string }; template?: string; content?: string }) {
  const m = useSendSchoolMessage(); const qc = useQueryClient(); const { toast } = useToast();
  const [search, setSearch] = useState("");
  const params = search.trim().length >= 2 ? { search: search.trim() } : undefined;
  const g = useListGuardians(params, { query: { queryKey: getListGuardiansQueryKey(params) } });
  const [f, setF] = useState({ guardianId: guardian?.id ?? "", channel: "whatsapp" as MessageInputChannel, template, content });
  const [err, setErr] = useState<string | null>(null);
  // Who it goes to: one parent, or everyone (optionally one grade). Opened from a parent's own page it is always that parent.
  const [to, setTo] = useState<"one" | "all">("one");
  const [gradeId, setGradeId] = useState("");
  const everyone = !guardian && to === "all";
  const audienceParams = gradeId ? { gradeId } : undefined;
  const audience = useGetMessageAudience(audienceParams, { query: { queryKey: getGetMessageAudienceQueryKey(audienceParams), enabled: everyone } });
  const parents = audience.data?.parents ?? 0;
  const broadcast = useBroadcastSchoolMessage();
  const idem = useIdemKey(JSON.stringify({ ...f, to, gradeId }));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!everyone && !f.guardianId) return setErr("Choose the guardian.");
    if (!f.template) return setErr("Choose what kind of message this is.");
    if (f.content.trim().length < 5) return setErr("Write the message.");
    if (everyone) {
      if (!parents) return setErr("There are no parents to send to yet. Link guardians to learners first.");
      return broadcast.mutate({ data: { channel: f.channel, template: f.template, content: f.content.trim(), idempotencyKey: idem.key, ...(gradeId ? { gradeId } : {}) } }, {
        onSuccess: (r) => { idem.renew(); qc.invalidateQueries({ queryKey: getListMessageDeliveriesQueryKey() }); toast({ title: `Sending to ${r.queued} parent${r.queued === 1 ? "" : "s"}`, description: r.skipped ? `${r.skipped} could not be reached on ${f.channel === "sms" ? "SMS" : "WhatsApp"}.` : undefined }); setF({ ...f, content: "" }); onDone(); },
        onError: (x) => setErr(errMsg(x)),
      });
    }
    m.mutate({ data: { ...f, content: f.content.trim(), idempotencyKey: idem.key } }, {
      onSuccess: (r) => { idem.renew(); qc.invalidateQueries({ queryKey: getListMessageDeliveriesQueryKey() }); toast({ title: r.status === "failed" ? "Message not sent" : "Message sent", description: r.status === "failed" ? r.error : undefined }); setF({ ...f, content: "" }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const list = (g.data ?? []).filter((x) => !x.anonymizedAt).slice(0, 200);
  return (
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {!guardian && <div role="radiogroup" aria-label="Send to" className="grid grid-cols-2 gap-1 rounded-md border border-input bg-background/60 p-1 sm:col-span-2" data-testid="choice-send-to">
            {([["one", "One parent"], ["all", "All parents"]] as const).map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={to === v} data-testid={`send-to-${v}`} onClick={() => { setTo(v); setErr(null); }} className={cn("h-9 rounded text-sm font-semibold transition", to === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{label}</button>)}
          </div>}
          {everyone ? <>
            <GradeSelect allowNone="Every grade" value={gradeId} onChange={setGradeId} />
            <div className="flex items-end pb-2 text-sm" data-testid="text-audience">{audience.isLoading ? <span className="text-muted-foreground">Counting parents…</span> : <span>Goes to <b>{parents}</b> parent{parents === 1 ? "" : "s"}<span className="text-muted-foreground">, once each</span></span>}</div>
          </> : guardian ? <div className="text-sm sm:col-span-2">To <b>{guardian.name}</b> <span className="font-mono text-xs text-muted-foreground">{guardian.phone}</span></div> : <>
          <Field label="Find parent" hint="Name or phone"><TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type 2+ letters" /></Field>
          <Field label="Parent" required><NativeSelect data-testid="select-guardian" value={f.guardianId} onChange={(e) => setF({ ...f, guardianId: e.target.value })}><option value="">{g.isLoading ? "Loading" : list.length ? "Select" : "No match"}</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.phone}{x.studentNames.length ? ` · ${x.studentNames.join(", ")}` : ""}</option>)}</NativeSelect></Field></>}
          <Field label="Send by" required><NativeSelect value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as MessageInputChannel })}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></NativeSelect></Field>
          <Field label="Kind of message" required><NativeSelect data-testid="input-template" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
            <option value="">Choose</option>{Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {f.template && !TEMPLATES[f.template] && <option value={f.template}>{f.template}</option>}
          </NativeSelect></Field>
          <Field label="Message" required className="sm:col-span-2" hint={f.channel === "sms" ? `${f.content.length} characters; ${Math.max(1, Math.ceil(f.content.length / 160))} SMS${everyone && parents ? ` each, about ${Math.max(1, Math.ceil(f.content.length / 160)) * parents} in all` : ""}` : undefined}>
            <textarea data-testid="input-message" rows={4} maxLength={1000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </Field>
        </div>
        <FormError msg={err} />
        <FormActions><Btn type="submit" data-testid="button-send-message" disabled={m.isPending || broadcast.isPending}>{(m.isPending || broadcast.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{everyone ? `Send to ${parents} parent${parents === 1 ? "" : "s"}` : "Send message"}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
      </form>
  );
}

export default function Notifications() {
  const p = usePerms();
  const q = useListMessageDeliveries({ query: { queryKey: getListMessageDeliveriesQueryKey(), refetchInterval: 15000, staleTime: 0 } });
  const [st, setSt] = useState("");
  const [composing, setComposing] = useState(false);
  const list = (q.data ?? []).filter((x) => !st || x.status === st);
  const { rows, pager } = usePaged(list, st);
  return (
    <div className="space-y-6">
      <PageHeader title="Messages" meta="Receipts, reminders and notices sent to parents.">
        {p.notify && <Btn data-testid="button-compose-message" onClick={() => setComposing(true)}><Send className="h-4 w-4" />New message</Btn>}
      </PageHeader>
      {p.notify && <FormDialog open={composing} onOpenChange={setComposing} size="lg" title="Message a parent" description="Sent by WhatsApp or SMS. Parents who opted out won't receive it."><Compose onDone={() => setComposing(false)} /></FormDialog>}
      <Panel title="Sent messages" action={<NativeSelect aria-label="Status" className="w-full text-xs sm:h-8 sm:w-36" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</NativeSelect>}>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? <Empty icon={<MessageSquare className="h-5 w-5" />} title="No messages" body="Receipts, reminders and notices sent to parents show up here." /> : (
          <Table head={["Message", "Sent by", "Status", "Tries", "Details"]}>{rows.map((x) => { const s = STATUS[x.status] ?? { tone: "left", label: x.status }; return (
            <tr key={x.id} data-testid={`row-message-${x.id}`}><td className={`${td} text-sm`}>{TEMPLATES[x.template] ?? x.template}</td><td className={`${td} text-xs uppercase`}>{x.channel}</td><td className={td}><Pill tone={s.tone}>{s.label}</Pill></td><td className={td}>{x.attempts}</td><td className={`${td} text-xs`}>{x.error ? <span className="text-destructive">{x.error}</span> : <span className="font-mono text-muted-foreground">{x.providerMessageId ?? "\u2014"}</span>}</td></tr>); })}</Table>
        )}
        <Pager {...pager} />
      </Panel>
    </div>
  );
}
