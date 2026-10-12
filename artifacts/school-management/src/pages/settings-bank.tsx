import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBankAccounts, useCreateBankAccount, useUpdateBankAccount, useDeleteBankAccount, useRequestNcbaConnection, useGetKcbConnection, useReplaceKcbAddresses, getGetKcbConnectionQueryKey, getListBankAccountsQueryKey,
  type BankAccountView, type BankAccountInputCollectionType, type NcbaRequestLetter,
} from "@workspace/api-client-react";
import { Building2, Copy, Download, FileSignature, Loader2, Pencil, Plus, Printer, RadioTower, Trash2 } from "lucide-react";
import { Btn, Empty, ErrorState, Field, FormActions, FormError, NativeSelect, PageHeader, Panel, Pill, SkeletonRows, TextInput } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg } from "@/lib/session";
import { fmtDateTime } from "@/lib/datetime";
import { useToast } from "@/hooks/use-toast";
import { BANKS, COLLECTION_LABEL, howParentsPay, NCBA_TILL_PAYBILL } from "@/lib/banks";

const STATUS: Record<string, { label: string; tone: string }> = {
  off: { label: "Not requested", tone: "left" }, requested: { label: "Waiting for NCBA", tone: "duplicate" }, live: { label: "Live", tone: "active" },
};

function AccountForm({ account, onDone }: { account?: BankAccountView; onDone: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const create = useCreateBankAccount(), update = useUpdateBankAccount();
  const [f, setF] = useState({ bank: account?.bank ?? "", accountName: account?.accountName ?? "", accountNumber: account?.accountNumber ?? "", branch: account?.branch ?? "", collectionType: account?.collectionType ?? "", collectionNumber: account?.collectionNumber ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const locked = !!account && account.notificationStatus !== "off";
  const ncba = f.bank === "ncba", kcb = f.bank === "kcb";
  const busy = create.isPending || update.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.bank) return setErr("Choose the bank.");
    if (ncba && !f.collectionType) return setErr("Choose how parents pay into this NCBA account.");
    if (ncba && f.collectionType === "ncba_till" && f.collectionNumber.trim() === NCBA_TILL_PAYBILL) return setErr(`${NCBA_TILL_PAYBILL} is NCBA's paybill. Enter your school's own NCBA Till number.`);
    const tillKey = f.collectionNumber.trim();
    const data = { bank: f.bank, accountName: f.accountName.trim(), accountNumber: f.accountNumber.trim(), branch: f.branch.trim() || null,
      collectionType: ncba ? f.collectionType as BankAccountInputCollectionType : kcb && tillKey ? "kcb_till" as const : null, collectionNumber: ncba || (kcb && tillKey) ? tillKey : null };
    const done = { onSuccess: () => { qc.invalidateQueries({ queryKey: getListBankAccountsQueryKey() }); toast({ title: account ? "Bank account updated" : "Bank account added" }); onDone(); }, onError: (x: unknown) => setErr(errMsg(x)) };
    if (account) update.mutate({ id: account.id, data }, done); else create.mutate({ data }, done);
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank" required><NativeSelect data-testid="select-bank" value={f.bank} disabled={!!account} onChange={(e) => setF({ ...f, bank: e.target.value, collectionType: "", collectionNumber: "" })}>
          <option value="">Choose a bank</option>{Object.entries(BANKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect></Field>
        <Field label="Branch"><TextInput value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} placeholder="Mara/Ragati Road" /></Field>
        <Field label="Account name" required><TextInput data-testid="input-account-name" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} placeholder="Hills Academy Fees Account" /></Field>
        <Field label="Account number" required><TextInput data-testid="input-account-number" className="font-mono" disabled={locked} value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\s/g, "") })} /></Field>
        {ncba && <>
          <Field label="How parents pay" required><NativeSelect data-testid="select-collection-type" disabled={locked} value={f.collectionType} onChange={(e) => setF({ ...f, collectionType: e.target.value })}>
            <option value="">Choose</option>{Object.entries(COLLECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect></Field>
          <Field label={f.collectionType === "ncba_till" ? "NCBA Till number" : "Paybill number"} required>
            <TextInput data-testid="input-collection-number" className="font-mono" disabled={locked} value={f.collectionNumber} onChange={(e) => setF({ ...f, collectionNumber: e.target.value.replace(/\s/g, "") })} />
          </Field>
        </>}
        {kcb && <Field label="KCB till number" hint="Only if parents also pay to a KCB till: Vooma, or Lipa na KCB through paybill 522533.">
          <TextInput data-testid="input-kcb-till" className="font-mono" disabled={locked} value={f.collectionNumber} onChange={(e) => setF({ ...f, collectionNumber: e.target.value.trim() })} />
        </Field>}
      </div>
      {ncba && f.collectionType && f.collectionNumber && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Parents pay: <b className="text-foreground">{howParentsPay(f.collectionType, f.collectionNumber)}</b></p>}
      {locked && <p className="text-xs text-muted-foreground">{BANKS[f.bank]} has been asked to send notifications for this account, so the account and till numbers can't change. Remove it and add it again instead.</p>}
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-bank" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{account ? "Save" : "Add account"}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** NCBA's own request letter, filled in. Printed from a throwaway frame so the secrets never touch storage. */
function letterHtml(l: NcbaRequestLetter) {
  const stk = l.collectionType === "ncba_till";
  const box = (on: boolean) => on ? "&#9746;" : "&#9744;";
  const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td><code>${esc(v)}</code></td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>NCBA request letter</title><style>
    body{font:12pt/1.5 Georgia,serif;margin:22mm;color:#111} h1{font-size:15pt;margin:0 0 2mm} .muted{color:#555;font-size:10pt}
    table{border-collapse:collapse;width:100%;margin:2mm 0 5mm} td{border:1px solid #999;padding:4px 8px;vertical-align:top} td:first-child{width:38%}
    code{font:11pt/1.4 "Courier New",monospace;word-break:break-all} h2{font-size:12pt;margin:5mm 0 1mm} .sig{display:flex;gap:20mm;margin-top:18mm}
    .sig div{flex:1;border-top:1px solid #111;padding-top:2mm}</style></head><body>
    <h1>${esc(l.schoolName)}</h1><p class="muted">Print on the school's letterhead before signing.</p>
    <p>Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
    <p>The Manager<br>NCBA Bank${l.branch ? `<br>${esc(l.branch)} Branch` : ""}</p>
    <p>Dear Sir/Madam,</p><p><b>RE: REQUEST – STK PUSH AND/OR API PUSH NOTIFICATION</b></p>
    <p>We kindly request the activation of the following service(s) for our account.</p>
    <p>${box(stk)} STK Push Service &nbsp;&nbsp; ${box(true)} API Push Notification Service</p>
    <h2>Customer details</h2><table>${row("Customer name", l.accountName)}${row("Account number", l.accountNumber)}</table>
    <h2>Merchant details</h2><table>${row("NCBA Till number(s)", l.collectionType === "ncba_till" ? `${l.collectionNumber} (via paybill ${NCBA_TILL_PAYBILL})` : "—")}${row("Paybill number(s)", l.collectionType === "paybill" ? l.collectionNumber : "—")}${row("Buy goods number(s)", "—")}</table>
    <h2>API push notification configuration</h2><table>${row("Preferred request format", "JSON")}${row("Endpoint/URL", l.endpointUrl)}${row("Username", l.notificationUsername)}${row("Password", l.notificationPassword)}${row("Secret key", l.notificationSecretKey)}</table>
    ${stk ? `<h2>STK push credentials</h2><table>${row("Username", l.stkUsername)}${row("Secret key", l.stkSecretKey)}</table>` : ""}
    <p>Thank you for your continued support.</p><p>Yours faithfully,</p>
    <div class="sig"><div>Authorized signatory</div><div>Authorized signatory</div></div></body></html>`;
}
/** Saves a letter as a Word document, so the school can put it on its letterhead before printing. */
function downloadDoc(html: string, name: string) {
  const doc = html.replace("<html>", '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
  const url = URL.createObjectURL(new Blob(["\ufeff", doc], { type: "application/msword" }));
  const a = document.createElement("a"); a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]/g, "")}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!; doc.open(); doc.write(html); doc.close();
  frame.contentWindow!.focus(); frame.contentWindow!.print();
  window.setTimeout(() => frame.remove(), 60000);
}

function NcbaConnection({ a }: { a: BankAccountView }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const req = useRequestNcbaConnection();
  const [letter, setLetter] = useState<NcbaRequestLetter | null>(null);
  const [confirming, setConfirming] = useState(false);
  const st = STATUS[a.notificationStatus] ?? STATUS.off;
  const issue = () => req.mutate({ id: a.id }, {
    onSuccess: (l) => { setConfirming(false); setLetter(l); qc.invalidateQueries({ queryKey: getListBankAccountsQueryKey() }); },
    onError: (x) => { setConfirming(false); toast({ title: "Letter not made", description: errMsg(x), variant: "destructive" }); },
  });
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-sm" data-testid={`ncba-connection-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <RadioTower className="h-4 w-4 text-primary" /><span className="font-semibold">Live payment notifications</span><Pill tone={st.tone}>{st.label}</Pill>
        <Btn variant="outline" className="ml-auto h-8" data-testid={`button-ncba-letter-${a.id}`} disabled={req.isPending} onClick={() => a.notificationStatus === "off" ? issue() : setConfirming(true)}>
          {req.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}{a.notificationStatus === "off" ? "Get request letter" : "New letter"}
        </Btn>
      </div>
      <p className="text-xs text-muted-foreground">
        {a.notificationStatus === "off" ? "Get the filled-in NCBA request letter, sign it and take it to your branch. Payments then appear here within seconds, matched by admission number."
          : a.notificationStatus === "requested" ? `Letter issued ${a.requestedAt ? fmtDateTime(a.requestedAt) : ""}. This turns Live by itself when the first payment arrives from NCBA.`
          : `Live since ${a.liveAt ? fmtDateTime(a.liveAt) : ""}.${a.lastNotificationAt ? ` Last payment received ${fmtDateTime(a.lastNotificationAt)}.` : ""}`}
      </p>
      <FormDialog open={confirming} onOpenChange={setConfirming} busy={req.isPending} size="sm" title="Make a new letter?" description="New details replace the old ones. Payments stop arriving until NCBA has the new signed letter.">
        <div className="p-5"><FormActions>
          <Btn data-testid="button-confirm-new-letter" disabled={req.isPending} onClick={issue}>{req.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Make new letter</Btn>
          <Btn variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
        </FormActions></div>
      </FormDialog>
      <FormDialog open={!!letter} onOpenChange={(o) => { if (!o) setLetter(null); }} size="lg" title="NCBA request letter" description="Print it, sign it, and take it to your NCBA branch. The passwords on it are shown only now.">
        {letter && <div className="space-y-4 p-5 text-sm">
          <dl className="grid gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-xs sm:grid-cols-[10rem_1fr]">
            {[["Endpoint", letter.endpointUrl], ["Username", letter.notificationUsername], ["Password", letter.notificationPassword], ["Secret key", letter.notificationSecretKey],
              ...(letter.collectionType === "ncba_till" ? [["STK username", letter.stkUsername], ["STK secret key", letter.stkSecretKey]] : [])].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all font-mono">{v}</dd></div>
            ))}
          </dl>
          <p className="rounded-md bg-amber-50/70 px-3 py-2 text-xs text-amber-900">Keep the signed letter safe: anyone with these details can send fake payment messages. If it is lost, make a new letter and the old details stop working.</p>
          <FormActions><Btn data-testid="button-download-letter" onClick={() => downloadDoc(letterHtml(letter), `NCBA request letter - ${letter.accountName}`)}><Download className="h-4 w-4" />Download letter</Btn><Btn variant="outline" data-testid="button-print-letter" onClick={() => printHtml(letterHtml(letter))}><Printer className="h-4 w-4" />Print</Btn><Btn variant="ghost" onClick={() => setLetter(null)}>Done</Btn></FormActions>
        </div>}
      </FormDialog>
    </div>
  );
}

const KCB_STATUS = (a: BankAccountView) => a.notificationStatus === "live" ? { label: "Live", tone: "active" } : { label: "Waiting for KCB", tone: "duplicate" };

/** One address KCB needs, with a copy button. */
function Address({ label, url, onCopy }: { label: string; url: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
      <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px]" title={url}>{url}</code>
      <Btn variant="ghost" className="h-7 w-7 shrink-0 p-0" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => onCopy(url)}><Copy className="h-3.5 w-3.5" /></Btn>
    </div>
  );
}

function KcbConnection({ a }: { a: BankAccountView }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const conn = useGetKcbConnection(a.id, { query: { queryKey: getGetKcbConnectionQueryKey(a.id) } });
  const replace = useReplaceKcbAddresses();
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const st = KCB_STATUS(a);
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast({ title: "Copied" }), () => toast({ title: "Copy failed; select the text instead", variant: "destructive" }));
  const download = async () => {
    setDownloading(true);
    try {
      const r = await fetch(`/api/bank-accounts/${a.id}/kcb-letter.pdf`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "The letter could not be made");
      const url = URL.createObjectURL(await r.blob());
      const link = document.createElement("a"); link.href = url;
      link.download = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "KCB request letter.pdf";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (x) { toast({ title: "Letter not downloaded", description: errMsg(x), variant: "destructive" }); }
    finally { setDownloading(false); }
  };
  const doReplace = () => replace.mutate({ id: a.id }, {
    onSuccess: (d) => { setConfirming(false); qc.setQueryData(getGetKcbConnectionQueryKey(a.id), d); qc.invalidateQueries({ queryKey: getListBankAccountsQueryKey() }); toast({ title: "New addresses made", description: "Send them to KCB; the old ones no longer work." }); },
    onError: (x) => { setConfirming(false); toast({ title: "Addresses not replaced", description: errMsg(x), variant: "destructive" }); },
  });
  const urls = conn.data;
  return (
    <div className="rounded-md border border-border bg-muted/20 text-sm" data-testid={`kcb-connection-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <RadioTower className="h-4 w-4 text-primary" /><span className="font-semibold">Connect to KCB</span><Pill tone={st.tone}>{st.label}</Pill>
        {a.notificationStatus === "live" && a.lastNotificationAt && <span className="ml-auto text-[11px] text-muted-foreground">Last payment {fmtDateTime(a.lastNotificationAt)}</span>}
      </div>
      <ol className="space-y-3 p-3 text-xs">
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">1</span>
          <span className="min-w-0 flex-1"><b>Sign the request letter.</b> <span className="text-muted-foreground">KCB's form, filled in on your letterhead, for the account signatories.</span></span>
          <Btn variant="outline" className="h-8" data-testid={`button-kcb-letter-${a.id}`} disabled={downloading} onClick={download}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Letter (PDF)
          </Btn>
        </li>
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p><b>Email it to KCB</b> <span className="text-muted-foreground">at</span> <button type="button" className="font-semibold text-primary hover:underline" onClick={() => copy("buni@kcbgroup.com")}>buni@kcbgroup.com</button> <span className="text-muted-foreground">with {urls?.tillNotificationUrl ? "these addresses" : "this address"} for sending payments to Rejista:</span></p>
            {conn.isLoading ? <SkeletonRows rows={1} cols={1} />
              : conn.isError ? <ErrorState msg={errMsg(conn.error)} onRetry={() => conn.refetch()} />
              : !urls?.accountNotificationUrl ? <p className="rounded-md bg-amber-50/70 px-2.5 py-1.5 text-amber-900">Rejista's public web address isn't set up yet, so the address can't be shown. Contact Rejista support.</p>
              : <div className="space-y-1.5" data-testid={`kcb-addresses-${a.id}`}>
                  <Address label="Account payments" url={urls.accountNotificationUrl} onCopy={copy} />
                  {urls.tillNotificationUrl && <Address label="Till payments" url={urls.tillNotificationUrl} onCopy={copy} />}
                </div>}
          </div>
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex-1">{a.notificationStatus === "live" ? `Live since ${a.liveAt ? fmtDateTime(a.liveAt) : ""}.` : "Turns Live by itself when KCB sends the first payment."}</span>
        {urls?.accountNotificationUrl && <button type="button" className="hover:text-foreground hover:underline" onClick={() => setConfirming(true)}>Replace addresses</button>}
      </div>
      <FormDialog open={confirming} onOpenChange={setConfirming} busy={replace.isPending} size="sm" title="Replace the addresses?" description="Only if they were shared by mistake. The old addresses stop working at once, so payments stop arriving until KCB has the new ones.">
        <div className="p-5"><FormActions>
          <Btn variant="danger" disabled={replace.isPending} onClick={doReplace}>{replace.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Replace</Btn>
          <Btn variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
        </FormActions></div>
      </FormDialog>
    </div>
  );
}

/** The school's bank accounts. `embedded` drops the page header for the setup guide. */
export function BankAccounts({ embedded }: { embedded?: boolean }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const q = useListBankAccounts({ query: { queryKey: getListBankAccountsQueryKey() } });
  const del = useDeleteBankAccount();
  const [edit, setEdit] = useState<BankAccountView | "new" | null>(null);
  const [removing, setRemoving] = useState<BankAccountView | null>(null);
  const remove = (a: BankAccountView) => del.mutate({ id: a.id }, {
    onSuccess: () => { setRemoving(null); qc.invalidateQueries({ queryKey: getListBankAccountsQueryKey() }); toast({ title: "Bank account removed" }); },
    onError: (x) => { setRemoving(null); toast({ title: "Not removed", description: errMsg(x), variant: "destructive" }); },
  });
  const list = q.data ?? [];
  return (
    <div className="space-y-4">
      {!embedded && <PageHeader eyebrow="Settings" title="Bank" meta="The bank accounts your school collects fees into, and how each one sends payments to Rejista." />}
      <Panel title="Bank accounts" action={<Btn className="h-8" data-testid="button-add-bank" onClick={() => setEdit("new")}><Plus className="h-4 w-4" />Add bank</Btn>}>
        {q.isLoading ? <SkeletonRows cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} />
          : !list.length ? <Empty icon={<Building2 className="h-5 w-5" />} title="No bank accounts yet" body="Add the NCBA or KCB account parents pay fees into. Each payment then reaches Rejista as it happens." />
          : <ul className="divide-y divide-border/70">{list.map((a) => (
            <li key={a.id} className="space-y-3 p-5" data-testid={`row-bank-${a.id}`}>
              <div className="flex flex-wrap items-start gap-3">
                <Building2 className="mt-1 h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{BANKS[a.bank] ?? a.bank} <span className="font-mono text-sm font-normal text-muted-foreground">{a.accountNumber}</span></div>
                  <p className="text-sm text-muted-foreground">{a.accountName}{a.branch ? ` · ${a.branch} branch` : ""}</p>
                  {a.bank === "kcb" ? <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      <dt className="text-muted-foreground">Bank deposit</dt><dd>Account <b className="font-mono">{a.accountNumber}</b>, reference: admission number</dd>
                      {a.collectionType === "kcb_till" && <><dt className="text-muted-foreground">Till</dt><dd><b className="font-mono">{a.collectionNumber}</b> (Vooma, or paybill 522533), reference: admission number</dd></>}
                    </dl>
                    : a.collectionType && <p className="mt-1 text-xs">Parents pay: <b>{howParentsPay(a.collectionType, a.collectionNumber)}</b></p>}
                </div>
                <div className="flex gap-1">
                  <Btn variant="ghost" className="h-8 w-8 p-0" aria-label="Edit bank account" onClick={() => setEdit(a)}><Pencil className="h-4 w-4" /></Btn>
                  <Btn variant="ghost" className="h-8 w-8 p-0" aria-label="Remove bank account" disabled={del.isPending} onClick={() => setRemoving(a)}><Trash2 className="h-4 w-4" /></Btn>
                </div>
              </div>
              {a.bank === "ncba" ? <NcbaConnection a={a} />
                : a.bank === "kcb" ? <KcbConnection a={a} />
                : <p className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">This bank is no longer supported for live payments. Remove the account, or match its payments by uploading the bank statement on the Payments page.</p>}
            </li>
          ))}</ul>}
      </Panel>
      <FormDialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }} size="lg" title={edit === "new" ? "Add bank account" : "Edit bank account"}>
        {edit && <AccountForm account={edit === "new" ? undefined : edit} onDone={() => setEdit(null)} />}
      </FormDialog>
      <FormDialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null); }} busy={del.isPending} size="sm"
        title={removing ? `Remove ${BANKS[removing.bank] ?? removing.bank} ${removing.accountNumber}?` : "Remove bank account?"}
        description={removing?.notificationStatus !== "off" ? "Payment messages NCBA sends for this account will be refused from now on." : "It will no longer be listed for this school."}>
        <div className="p-5"><FormActions>
          <Btn variant="danger" data-testid="button-confirm-remove-bank" disabled={del.isPending} onClick={() => removing && remove(removing)}>{del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Remove</Btn>
          <Btn variant="ghost" onClick={() => setRemoving(null)}>Cancel</Btn>
        </FormActions></div>
      </FormDialog>
    </div>
  );
}

export default function BankSettingsPage() { return <BankAccounts />; }
