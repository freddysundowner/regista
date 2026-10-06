import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useListPlatformEmailRecipients, useListSchoolEmailRecipients,
  useListPlatformEmailCampaigns, useListSchoolEmailCampaigns,
  getListPlatformEmailCampaignsQueryKey, getListSchoolEmailCampaignsQueryKey,
  getListPlatformEmailRecipientsQueryKey, getListSchoolEmailRecipientsQueryKey,
  useCreatePlatformEmailCampaign, useCreateSchoolEmailCampaign,
  type EmailAudienceRecipient, type EmailCampaignSummary,
} from "@workspace/api-client-react";
import {
  ArrowLeft, Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Loader2, Mail, PenLine, Redo2, Search, Send, ShieldCheck, Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, useReadOnly } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 100;
type Kind = "marketing" | "announcement" | "transactional";
const KINDS: { id: Kind; label: string; note: string }[] = [
  { id: "marketing", label: "Marketing", note: "Promotional. Requires confirmed permission; an unsubscribe footer is added automatically." },
  { id: "announcement", label: "Announcement", note: "Operational news for people you already work with." },
  { id: "transactional", label: "Transactional", note: "Account or service notices tied to a specific relationship." },
];
const kindLabel = (k: string) => KINDS.find((x) => x.id === k)?.label ?? k;

function ToolBtn({ on, label, onClick, disabled, children }: { on?: boolean; label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        on && "bg-primary/10 text-primary")}>
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      b: e.isActive("bold"), i: e.isActive("italic"), u: e.isActive("underline"), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), link: e.isActive("link"), undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (https:// or mailto:). Leave empty to remove.", prev ?? "https://");
    if (url === null) return;
    const u = url.trim();
    if (!u) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    if (!/^(https?:\/\/|mailto:)/i.test(u)) { window.alert("Links must start with https://, http:// or mailto:."); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: u }).run();
  };
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
      <ToolBtn label="Bold" on={st.b} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Italic" on={st.i} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Underline" on={st.u} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolBtn>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolBtn label="Heading" on={st.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Subheading" on={st.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Bulleted list" on={st.ul} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Numbered list" on={st.ol} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Link" on={st.link} onClick={setLink}><Link2 className="h-4 w-4" /></ToolBtn>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolBtn label="Undo" disabled={!st.undo} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolBtn>
      <ToolBtn label="Redo" disabled={!st.redo} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolBtn>
    </div>
  );
}

const PROSE = "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-primary [&_a]:underline break-words";

function parseManual(t: string) {
  const parts = t.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return { ok: parts.filter((p) => EMAIL_RE.test(p)), bad: parts.filter((p) => !EMAIL_RE.test(p)) };
}

function Composer({ platform, onClose }: { platform: boolean; onClose: () => void }) {
  const MAX = platform ? 10000 : 100;
  const [schoolChoice, setSchoolChoice] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const ro = useReadOnly();
  const [key] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<Kind>("announcement");
  const [subject, setSubject] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("");
  const [consent, setConsent] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<null | { html: string; recipients: string[] }>(null);
  const [done, setDone] = useState<null | { total: number; message: string }>(null);

  const pr = useListPlatformEmailRecipients({ query: { queryKey: getListPlatformEmailRecipientsQueryKey(), enabled: platform } });
  const sr = useListSchoolEmailRecipients({ query: { queryKey: getListSchoolEmailRecipientsQueryKey(), enabled: !platform } });
  const rq = platform ? pr : sr;
  const createP = useCreatePlatformEmailCampaign();
  const createS = useCreateSchoolEmailCampaign();
  const create = platform ? createP : createS;

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["https", "http", "mailto"] } })],
    editorProps: { attributes: { class: cn("min-h-[220px] px-4 py-3 text-sm outline-none", PROSE), role: "textbox", "aria-multiline": "true", "aria-label": "Email body" } },
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
  });

  const list: EmailAudienceRecipient[] = useMemo(() => (rq.data ?? []) as EmailAudienceRecipient[], [rq.data]);
  const schools = useMemo(() => [...new Map(list.filter(r => r.schoolId).map(r => [r.schoolId!, { id: r.schoolId!, name: r.schoolName ?? "School" }])).values()].sort((a, b) => a.name.localeCompare(b.name)), [list]);
  const chooseSchool = (value: string) => {
    setSchoolChoice(value);
    setFilter("");
    setPicked(new Set((value === "all" ? list : list.filter(r => r.schoolId === value)).map(r => r.id)));
  };
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const scoped = platform && schoolChoice && schoolChoice !== "all" ? list.filter(r => r.schoolId === schoolChoice) : list;
    return f ? scoped.filter((r) => `${r.name} ${r.email} ${r.schoolName ?? ""}`.toLowerCase().includes(f)) : scoped;
  }, [list, filter, platform, schoolChoice]);
  const man = platform ? parseManual(manual) : { ok: [], bad: [] };
  const all = useMemo(() => Array.from(new Set([...list.filter((r) => picked.has(r.id)).map((r) => r.email.toLowerCase()), ...man.ok])), [list, picked, man.ok.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectShown = () => setPicked((s) => { const n = new Set(s); shown.forEach((r) => n.add(r.id)); return n; });

  const review = () => {
    setErr(null);
    if (!subject.trim()) return setErr("Enter a subject.");
    if (subject.trim().length > 200) return setErr("Keep the subject under 200 characters.");
    if (!editor || empty) return setErr("Write the email body.");
    if (man.bad.length) return setErr(`Fix invalid addresses: ${man.bad.slice(0, 3).join(", ")}${man.bad.length > 3 ? "…" : ""}`);
    if (!all.length) return setErr("Choose at least one recipient.");
    if (all.length > MAX) return setErr(`At most ${MAX} recipients per campaign. You have ${all.length}.`);
    if (kind === "marketing" && !consent) return setErr("Confirm you have permission to send marketing email to these recipients.");
    setPreview({ html: editor.getHTML(), recipients: all });
  };

  const send = () => {
    if (!preview) return;
    setErr(null);
    create.mutate({ data: { idempotencyKey: key, kind, subject: subject.trim(), html: preview.html, recipients: preview.recipients, consentConfirmed: kind === "marketing" ? consent : false } }, {
      onSuccess: (res) => {
        qc.invalidateQueries({ queryKey: platform ? getListPlatformEmailCampaignsQueryKey() : getListSchoolEmailCampaignsQueryKey() });
        setDone({ total: res.total ?? preview.recipients.length, message: res.message });
        setPreview(null);
        toast({ title: "Campaign queued", description: `${res.total ?? preview.recipients.length} email(s) queued. Queued is not sent or delivered.` });
      },
      onError: (x) => setErr(errMsg(x)),
    });
  };

  if (done) return (
    <Panel className="max-w-3xl">
      <div className="space-y-4 p-6" data-testid="text-campaign-queued">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="font-semibold">Queued for sending</h2></div>
        <p className="text-sm">{done.total} email(s) queued. {done.message}</p>
        <p className="text-xs text-muted-foreground">Queued means accepted into the send queue — not sent and not delivered. Track Brevo acceptance and failures in History.</p>
        <FormActions><Btn onClick={onClose} data-testid="button-composer-done">Back to history</Btn></FormActions>
      </div>
    </Panel>
  );

  return (
    <div className="space-y-5">
      <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to history</button>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Message">
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="Kind" required>
                <NativeSelect data-testid="select-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setConsent(false); }}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Subject" required>
                <TextInput data-testid="input-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.id === kind)?.note}</p>
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Body <span className="text-primary">*</span></span>
              <div className="overflow-hidden rounded-md border border-input bg-background/60 focus-within:ring-2 focus-within:ring-ring/40" data-testid="editor-body">
                {editor ? <><Toolbar editor={editor} /><EditorContent editor={editor} /></> : <div className="h-[260px] animate-pulse bg-muted" />}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Pasted formatting is cleaned on the server; scripts and unsafe HTML are removed before sending.</p>
            </div>
            {kind === "marketing" && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-900">
                <label className="flex items-start gap-2">
                  <input type="checkbox" data-testid="check-consent" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span><b>I confirm I have permission to email the selected recipients for marketing.</b>
                    <span className="block text-xs">An unsubscribe link is added to the footer automatically. People who unsubscribed are skipped.</span></span>
                </label>
              </div>
            )}
          </div>
        </Panel>
        <Panel title="Recipients" note={`${all.length} of ${MAX} max`}>
          <div className="space-y-3 p-4">
            {platform && <Field label="Send to a school" hint="Includes active administrators with email addresses. You can also enter an email below without selecting a school.">
              <NativeSelect aria-label="Select a school or all schools" data-testid="select-email-school" value={schoolChoice} onChange={e => chooseSchool(e.target.value)} disabled={rq.isLoading || rq.isError}>
                <option value="">Choose a school (optional)</option>
                <option value="all">All schools ({schools.length})</option>
                {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <TextInput aria-label="Filter recipients" placeholder="Filter by name or email" className="pl-8" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={selectShown} disabled={!shown.length}>Select shown ({shown.length})</button>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setPicked(new Set()); setSchoolChoice(""); }}>Clear selection</button>
            </div>
            <div className="max-h-[320px] overflow-y-auto rounded-md border border-border">
              {rq.isLoading ? <SkeletonRows rows={4} cols={1} /> : rq.isError ? <ErrorState msg={errMsg(rq.error, "Could not load recipients.")} onRetry={() => rq.refetch()} />
                : !shown.length ? <p className="p-4 text-sm text-muted-foreground">{list.length ? "No matches." : "No recipients with an email address yet."}</p>
                : <ul className="divide-y divide-border/70">{shown.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-muted/40">
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={picked.has(r.id)} onChange={() => toggle(r.id)} data-testid={`check-recipient-${r.id}`} />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className="block break-all font-mono text-xs text-muted-foreground">{r.email}</span>
                        {r.schoolName && <span className="block truncate text-xs text-muted-foreground">{r.schoolName}</span>}</span>
                    </label>
                  </li>))}</ul>}
            </div>
            {platform && <Field label="Enter email addresses" hint="Use on their own or add to the selected school · comma or new line">
              <textarea data-testid="input-manual-recipients" rows={3} spellCheck={false} value={manual} onChange={(e) => setManual(e.target.value)}
                className="w-full rounded-md border border-input bg-background/60 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>}
            {man.bad.length > 0 && <p className="text-xs text-red-800">{man.bad.length} invalid address(es).</p>}
            {all.length > MAX && <p className="text-xs font-medium text-red-800">Over the {MAX}-recipient limit.</p>}
          </div>
        </Panel>
      </div>
      <FormError msg={preview ? null : err} />
      <div className="flex flex-wrap gap-2">
        <Btn data-testid="button-review-campaign" disabled={ro} title={ro ? "Read-only session" : undefined} onClick={review}><Send className="h-4 w-4" />Review & send</Btn>
        <Btn variant="ghost" onClick={onClose}>Discard</Btn>
      </div>

      <FormDialog open={!!preview} onOpenChange={(o) => { if (!o && !create.isPending) setPreview(null); }} size="lg" testid="dialog-confirm-campaign" title="Confirm and queue" description="Nothing is sent until you confirm. No automatic retries.">
        {preview && <div className="space-y-4 p-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kind</dt><dd>{kindLabel(kind)}</dd></div>
            <div className="sm:col-span-2 min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Subject</dt><dd className="break-words">{subject}</dd></div>
          </dl>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recipients ({preview.recipients.length})</p>
            <p className="mt-1 max-h-20 overflow-y-auto break-all font-mono text-xs text-muted-foreground">{preview.recipients.join(", ")}</p>
          </div>
          {/* Preview of the editor's own HTML output (generated by TipTap, not raw paste); the server sanitizes again before sending. */}
          <div className={cn("max-h-72 overflow-y-auto rounded-md border border-border bg-card px-4 py-3 text-sm", PROSE)} dangerouslySetInnerHTML={{ __html: preview.html }} />
          {kind === "marketing" && <p className="text-xs text-muted-foreground">An unsubscribe footer will be appended automatically.</p>}
          <FormError msg={err} />
          <FormActions>
            <Btn data-testid="button-confirm-send" disabled={create.isPending || ro} onClick={send}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{err ? "Retry queueing" : "Queue emails"}</Btn>
            <Btn variant="ghost" disabled={create.isPending} onClick={() => setPreview(null)}>Back to edit</Btn>
          </FormActions>
          {err && <p className="text-xs text-muted-foreground">Retrying uses the same request key, so recipients are never queued twice.</p>}
        </div>}
      </FormDialog>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (!n) return null;
  return <Pill tone={tone}>{n} {label}</Pill>;
}

function History({ platform }: { platform: boolean }) {
  const poll = { refetchInterval: 5_000, refetchOnWindowFocus: true } as const;
  const pq = useListPlatformEmailCampaigns({ query: { queryKey: getListPlatformEmailCampaignsQueryKey(), enabled: platform, ...poll } });
  const sq = useListSchoolEmailCampaigns({ query: { queryKey: getListSchoolEmailCampaignsQueryKey(), enabled: !platform, ...poll } });
  const q = platform ? pq : sq;
  const rows = (q.data ?? []) as EmailCampaignSummary[];
  return (
    <Panel title="History" note="Includes automatic welcome emails. Refreshes every 5 seconds.">
      {q.isLoading ? <SkeletonRows rows={4} cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error, "Could not load email history.")} onRetry={() => q.refetch()} />
        : !rows.length ? <Empty icon={<Mail className="h-5 w-5" />} title="No emails yet" body="Campaigns you queue and automatic emails appear here with their Brevo status." />
        : <ul className="divide-y divide-border/70" data-testid="list-campaigns">{rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start gap-3 px-5 py-4" data-testid={`row-campaign-${c.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words font-medium">{c.subject}</span>
                <Pill tone="current">{kindLabel(c.kind)}</Pill>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()} · {c.total} recipient(s)</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Count n={c.queued} label="queued" tone="left" />
              <Count n={c.accepted} label="accepted" tone="active" />
              <Count n={c.failed} label="failed" tone="error" />
              <Count n={c.uncertain} label="uncertain" tone="duplicate" />
              <Count n={c.skipped} label="skipped" tone="inactive" />
            </div>
          </li>))}</ul>}
      {rows.length > 0 && <p className="border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">Accepted means Brevo accepted the request, not that it reached the inbox. Uncertain sends are never retried automatically.</p>}
    </Panel>
  );
}

export default function EmailCampaignsPage({ platform = false }: { platform?: boolean }) {
  const ro = useReadOnly();
  const [composing, setComposing] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={platform ? "Platform" : "Communication"} title="Emails"
        meta={platform ? "Email school admins through the platform Brevo account." : "Email your school's contacts through this school's own Brevo account."}>
        {!composing && <Btn data-testid="button-compose" disabled={ro} title={ro ? "Read-only session" : undefined} onClick={() => setComposing((n) => n + 1)}><PenLine className="h-4 w-4" />Compose</Btn>}
      </PageHeader>
      {composing ? <Composer key={composing} platform={platform} onClose={() => setComposing(0)} /> : <>
        <p className="text-xs text-muted-foreground">Up to {platform ? "10,000" : MAX} recipients per campaign. Requires {platform ? "platform email" : "this school's email"} to be configured and enabled in Settings — there is no fallback account.</p>
        <History platform={platform} />
      </>}
    </div>
  );
}
