import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetKnowledgeBase, useCreateKnowledgeArticle, useUpdateKnowledgeArticle, useDeleteKnowledgeArticle, useSeedKnowledgeBase, useAskKnowledgeBase,
  getGetKnowledgeBaseQueryKey, getListSupportStartersQueryKey, type KnowledgeArticle, type KnowledgeAnswer, type KnowledgeAudience,
} from "@workspace/api-client-react";
import { BookOpen, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, NativeSelect, FormError, FormActions, Pill } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg, fmtDate } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const area = "w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20";
const AUDIENCE: Record<KnowledgeAudience, string> = { all: "Everyone", visitors: "Website visitors", staff: "School staff" };
const SOURCE: Record<KnowledgeAnswer["source"], string> = { article: "Straight from an article, no AI used", assistant: "Written by the assistant", unavailable: "The assistant is off or unavailable, so the team would be asked" };

function ArticleForm({ article, onDone }: { article?: KnowledgeArticle; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateKnowledgeArticle();
  const update = useUpdateKnowledgeArticle();
  const [f, setF] = useState({ question: article?.question ?? "", answer: article?.answer ?? "", isPublished: article?.isPublished ?? true, isStarter: article?.isStarter ?? false, audience: (article?.audience ?? "all") as KnowledgeAudience });
  const [err, setErr] = useState<string | null>(null);
  const done = (title: string) => { qc.invalidateQueries({ queryKey: getGetKnowledgeBaseQueryKey() }); qc.invalidateQueries({ queryKey: getListSupportStartersQueryKey() }); toast({ title }); onDone(); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const data = { ...f, question: f.question.trim(), answer: f.answer.trim() };
    if (article) update.mutate({ articleId: article.id, data }, { onSuccess: () => done("Article saved"), onError: (x) => setErr(errMsg(x)) });
    else create.mutate({ data }, { onSuccess: () => done("Article added"), onError: (x) => setErr(errMsg(x)) });
  };
  const pending = create.isPending || update.isPending;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <Field label="Question" required hint="Write it the way a school would ask it. {{name}} becomes the product's name."><TextInput data-testid="input-article-question" required minLength={3} maxLength={200} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} /></Field>
      <Field label="Answer" required hint="Plain sentences. Write {{name}} for the product's name, and {{price}}, {{period}}, {{periodDays}}, {{maxLearners}} or {{trialDays}} to quote the current subscription settings.">
        <textarea data-testid="input-article-answer" required minLength={3} maxLength={4000} rows={7} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} className={area} />
      </Field>
      <Field label="Who is it for?" hint="Website visitors see it in the chat on the landing page; school staff see it in the helper inside the system.">
        <NativeSelect data-testid="select-article-audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as KnowledgeAudience })}>{Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
      </Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} data-testid="check-article-published" /><span><span className="font-medium">Published</span><span className="block text-xs text-muted-foreground">The assistant only uses published articles.</span></span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.isStarter} onChange={(e) => setF({ ...f, isStarter: e.target.checked })} data-testid="check-article-starter" /><span><span className="font-medium">Offer as a question in the chat</span><span className="block text-xs text-muted-foreground">People see it as a button when the chat opens. Tapping it gives this answer exactly as written.</span></span></label>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-save-article" type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{article ? "Save article" : "Add article"}</Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}

/** Ask the assistant a question the way a visitor would, without sending anything to anyone. */
function TryIt() {
  const ask = useAskKnowledgeBase();
  const [question, setQuestion] = useState("");
  const [audience, setAudience] = useState<"visitors" | "staff">("visitors");
  const result = ask.data;
  return (
    <Panel title="Try a question" note="See what someone would be told. Nothing is sent to anyone.">
      <form className="flex flex-col gap-3 px-5 py-4 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask.mutate({ data: { body: question.trim() }, params: { audience } }); }}>
        <NativeSelect data-testid="select-try-audience" aria-label="Ask as" value={audience} onChange={(e) => setAudience(e.target.value as "visitors" | "staff")} className="sm:w-44"><option value="visitors">As a website visitor</option><option value="staff">As school staff</option></NativeSelect>
        <TextInput data-testid="input-try-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Can parents pay by bank?" maxLength={2000} className="flex-1" />
        <Btn data-testid="button-try-question" type="submit" disabled={!question.trim() || ask.isPending}>{ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Ask</Btn>
      </form>
      {ask.isError && <p role="alert" className="px-5 pb-4 text-sm text-red-700">{errMsg(ask.error, "Could not ask the assistant.")}</p>}
      {result && !ask.isPending && (
        <div className="border-t border-border/60 px-5 py-4" data-testid="try-answer">
          <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Pill tone={result.answered ? "active" : "duplicate"}>{result.answered ? "Answered" : "Handed to the team"}</Pill>{SOURCE[result.source]}</p>
        </div>
      )}
    </Panel>
  );
}

export default function PlatformKnowledgePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetKnowledgeBase({ query: { queryKey: getGetKnowledgeBaseQueryKey() } });
  const seed = useSeedKnowledgeBase();
  const remove = useDeleteKnowledgeArticle();
  const [editing, setEditing] = useState<"new" | KnowledgeArticle | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeArticle | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetKnowledgeBaseQueryKey() }); qc.invalidateQueries({ queryKey: getListSupportStartersQueryKey() }); };
  const kb = q.data;
  const addReadyMade = () => seed.mutate(undefined, { onSuccess: () => { refresh(); toast({ title: "Ready-made articles added" }); }, onError: (x) => toast({ title: "Could not add them", description: errMsg(x), variant: "destructive" }) });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Knowledge base" meta="What the helper knows, on your website and inside the system. The assistant answers from these articles and nothing else.">
        {kb && kb.articles.length > 0 && kb.missingStarters > 0 && <Btn variant="outline" data-testid="button-seed-more" disabled={seed.isPending} onClick={addReadyMade}>{seed.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add {kb.missingStarters} ready-made article{kb.missingStarters === 1 ? "" : "s"}</Btn>}
        <Btn data-testid="button-new-article" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add article</Btn>
      </PageHeader>

      {kb && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${kb.aiConfigured ? "border-primary/25 bg-primary/5" : "border-amber-300/60 bg-amber-50/70 text-amber-900"}`} data-testid="assistant-status">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          {kb.aiConfigured
            ? <p><b>The assistant is on</b> ({kb.model}). It answers typed questions from the published articles and hands over to you when they don't cover something.</p>
            : <p><b>The assistant is off.</b> People who tap a question still get that article's answer; anything they type waits for you under Support. To switch it on, set <code className="rounded bg-black/5 px-1">ANTHROPIC_API_KEY</code> on the server and restart it.</p>}
        </div>
      )}

      <Panel>
        {q.isLoading ? <SkeletonRows rows={4} cols={2} /> : q.isError || !kb ? <ErrorState msg={errMsg(q.error, "Could not load the knowledge base.")} onRetry={() => q.refetch()} />
          : !kb.articles.length ? (
            <div className="space-y-4 pb-6">
              <Empty icon={<BookOpen className="h-5 w-5" />} title="No articles yet" body="Start from a ready-made set: pricing, M-Pesa and CBC for website visitors, and how-to answers for school staff. Then edit them to fit." />
              <div className="flex justify-center"><Btn data-testid="button-seed-knowledge" disabled={seed.isPending} onClick={addReadyMade}>{seed.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add starter articles</Btn></div>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">{kb.articles.map((a) => (
              <li key={a.id} data-testid={`article-${a.id}`} className="flex items-start gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.question}</span><Pill tone="left">{AUDIENCE[a.audience]}</Pill>{!a.isPublished && <Pill tone="inactive">Draft</Pill>}{a.isStarter && <Pill tone="current">Offered in chat</Pill>}</div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.answer}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Updated {fmtDate(a.updatedAt)}</p>
                </div>
                <button type="button" aria-label={`Edit ${a.question}`} data-testid={`button-edit-article-${a.id}`} onClick={() => setEditing(a)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                <button type="button" aria-label={`Delete ${a.question}`} data-testid={`button-delete-article-${a.id}`} onClick={() => setDeleting(a)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}</ul>
          )}
      </Panel>

      {kb && kb.articles.length > 0 && <TryIt />}

      <FormDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} size="lg" title={editing === "new" ? "Add an article" : "Edit article"} description="Changes reach the chat straight away.">
        {editing && <ArticleForm key={editing === "new" ? "new" : editing.id} article={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      </FormDialog>
      <FormDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} size="sm" title="Delete this article?" busy={remove.isPending}>
        {deleting && <div className="space-y-4 p-5">
          <p className="text-sm">"{deleting.question}" will be removed and the assistant will stop using it. To keep it for later, edit it and untick Published instead.</p>
          <FormActions>
            <Btn variant="danger" data-testid="button-confirm-delete-article" disabled={remove.isPending} onClick={() => remove.mutate({ articleId: deleting.id }, { onSuccess: () => { refresh(); toast({ title: "Article deleted" }); setDeleting(null); }, onError: (x) => toast({ title: "Could not delete", description: errMsg(x), variant: "destructive" }) })}>{remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Delete</Btn>
            <Btn variant="ghost" onClick={() => setDeleting(null)}>Keep it</Btn>
          </FormActions>
        </div>}
      </FormDialog>
    </div>
  );
}
