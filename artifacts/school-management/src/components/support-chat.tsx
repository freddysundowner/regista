import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSupportMessages, useSendSupportMessage, useListSupportThreads, useListSupportThreadMessages, useReplySupportThread,
  startVisitorChat, sendVisitorMessage, useListVisitorMessages, useSendVisitorMessage, getListVisitorMessagesQueryKey,
  useRegisterSchool, useGetPublicPricing, getGetPublicPricingQueryKey,
  useListSupportStarters, getListSupportStartersQueryKey, useListStaffSupportStarters, getListStaffSupportStartersQueryKey, useGetSupportUnread,
  getListSupportMessagesQueryKey, getGetSupportUnreadQueryKey, getListSupportThreadsQueryKey, getListSupportThreadMessagesQueryKey, getGetPlatformSupportUnreadQueryKey,
  type SupportMessage, type SupportThread,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Check, CheckCheck, Globe, Headset, Loader2, MessageCircle, Search, SendHorizontal, Sparkles, X } from "lucide-react";
import { useLocation } from "wouter";
import { useHelpNudge, nudgeFor, nudgeDeclined, nudgeSawSave, type Nudge, type NudgeReason } from "@/lib/help-nudge";
import { pageName } from "@/lib/route-names";
import { useAuthSession, errMsg, initials } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";

// The chat is drawn as a phone messaging app, so its colours are fixed rather than taken from the app theme.
const C = { bar: "#008069", wall: "#efeae2", mine: "#d9fdd3", theirs: "#ffffff", ink: "#111b21", soft: "#667781", read: "#53bdeb", accent: "#00a884", badge: "#25d366", field: "#f0f2f5" };
const POLL = 4000;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date(), yesterday = new Date(now.getTime() - 86_400_000);
  return sameDay(d, now) ? "Today" : sameDay(d, yesterday) ? "Yesterday" : d.toLocaleDateString([], { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
/** In a chat list: the time for today, otherwise the day. */
const listStamp = (iso: string) => sameDay(new Date(iso), new Date()) ? clock(iso) : dayLabel(iso) === "Yesterday" ? "Yesterday" : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

/** A phone on a desk on wide screens; the whole screen on a real phone. */
function Phone({ children, testid }: { children: ReactNode; testid: string }) {
  return (
    <div className="flex justify-center max-md:-mx-4 max-md:-my-6">
      <div data-testid={testid} style={{ color: C.ink }}
        className="flex h-[min(46rem,calc(100dvh-8rem))] w-full max-w-[25rem] flex-col overflow-hidden bg-white shadow-[0_30px_60px_-30px_rgba(0,0,0,.45)] md:rounded-[2.4rem] md:border-[10px] md:border-[#111b21] max-md:h-[calc(100dvh-7.5rem)] max-md:max-w-none">
        {children}
      </div>
    </div>
  );
}

function Avatar({ name, support = false }: { name: string; support?: boolean }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: support ? "#075e54" : "#6b7c85" }}>
      {support ? <Headset className="h-5 w-5" /> : initials(name)}
    </span>
  );
}

function Ticks({ read }: { read: boolean }) {
  return read ? <CheckCheck className="h-4 w-4" style={{ color: C.read }} aria-label="Read" /> : <Check className="h-4 w-4" style={{ color: C.soft }} aria-label="Sent" />;
}

function Conversation({ title, subtitle, support, messages, loading, error, mineIsSupport, sending, onSend, onBack, onClose, starters, sendError, note, typing = false, extra }: {
  title: string; subtitle: string; support: boolean; messages: SupportMessage[] | undefined; loading: boolean; error: string | null;
  mineIsSupport: boolean; sending: boolean; onSend: (text: string) => void; onBack?: () => void; onClose?: () => void; starters?: string[]; sendError: string | null; note?: string; typing?: boolean; extra?: ReactNode;
}) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const count = messages?.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [count, typing]);
  // Questions not asked yet stay on offer, so a visitor can tap through them one after another.
  const asked = new Set((messages ?? []).map((m) => m.body));
  const offered = (starters ?? []).filter((q) => !asked.has(q));
  const submit = (value = text) => { const body = value.trim(); if (!body || sending) return; onSend(body); setText(""); };
  return (
    <>
      <header className="flex shrink-0 items-center gap-3 px-3 py-2.5 text-white" style={{ background: C.bar }}>
        {onBack && <button type="button" onClick={onBack} aria-label="Back to chats" data-testid="button-chat-back" className="-ml-1 rounded-full p-1.5 hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>}
        <Avatar name={title} support={support} />
        <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold leading-tight">{title}</div><div className="truncate text-xs text-white/80">{typing ? "typing…" : subtitle}</div></div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close chat" data-testid="button-chat-close" className="rounded-full p-1.5 hover:bg-white/10"><X className="h-5 w-5" /></button>}
      </header>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3" data-testid="chat-messages"
        style={{ background: `${C.wall} radial-gradient(rgba(17,27,33,.045) 1px, transparent 1px) 0 0 / 14px 14px` }}>
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: C.soft }} /></div>
          : error ? <p role="alert" className="mx-auto max-w-[85%] rounded-lg bg-white px-3 py-2 text-center text-xs text-red-700 shadow-sm">{error}</p>
          : <>
            {starters && <p className="mx-auto mb-2 max-w-[88%] rounded-lg px-3 py-2 text-center text-xs shadow-sm" style={{ background: "#ffeecd", color: "#54656f" }}>{note ?? "Ask anything about how Rejista works. The support team replies right here."}</p>}
            {(messages ?? []).map((m, i) => {
              const mine = m.fromSupport === mineIsSupport, prev = messages![i - 1];
              const newDay = !prev || !sameDay(new Date(prev.createdAt), new Date(m.createdAt));
              const first = newDay || prev!.fromSupport !== m.fromSupport;
              return (
                <div key={m.id}>
                  {newDay && <div className="my-2 flex justify-center"><span className="rounded-md bg-white/95 px-2.5 py-1 text-[11px] font-medium shadow-sm" style={{ color: "#54656f" }}>{dayLabel(m.createdAt)}</span></div>}
                  <div className={cn("flex", mine ? "justify-end" : "justify-start", first && "mt-1.5")}>
                    <div data-testid={`bubble-${mine ? "mine" : "theirs"}`} className={cn("relative max-w-[82%] rounded-lg px-2.5 pb-1 pt-1.5 text-[14px] leading-snug shadow-[0_1px_.5px_rgba(11,20,26,.13)]", first && (mine ? "rounded-tr-none" : "rounded-tl-none"))} style={{ background: mine ? C.mine : C.theirs }}>
                      {m.byAi && mineIsSupport && <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: C.bar }}>Assistant</span>}
                      <span className="whitespace-pre-wrap break-words">{m.body}</span>
                      <span className="float-right ml-2 mt-1.5 flex items-center gap-1 text-[10.5px]" style={{ color: C.soft }}>{clock(m.createdAt)}{mine && <Ticks read={!!m.readAt} />}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {typing && <div className="mt-1.5 flex justify-start" data-testid="chat-typing"><div className="flex items-center gap-1 rounded-lg rounded-tl-none px-3 py-2.5 shadow-[0_1px_.5px_rgba(11,20,26,.13)]" style={{ background: C.theirs }} aria-label="Typing">
              {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: C.soft, animationDelay: `${d}ms` }} />)}
            </div></div>}
            {extra}
            {offered.length > 0 && !typing && <div className="flex flex-col items-end gap-1.5 pt-3">
              {offered.map((q) => <button key={q} type="button" disabled={sending} onClick={() => submit(q)} data-testid="button-starter" className="max-w-[88%] rounded-full border bg-white px-3 py-1.5 text-left text-[13px] font-medium shadow-sm transition hover:bg-[#f5f6f6]" style={{ borderColor: "#d1d7db", color: C.bar }}>{q}</button>)}
            </div>}
          </>}
        <div ref={end} />
      </div>
      {sendError && <p role="alert" className="shrink-0 bg-red-50 px-3 py-1.5 text-center text-xs text-red-700">{sendError}</p>}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex shrink-0 items-end gap-2 px-2 py-2" style={{ background: C.field }}>
        <textarea data-testid="input-chat-message" value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} placeholder="Message" aria-label="Message"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-3xl border-0 bg-white px-4 py-2.5 text-[15px] leading-snug outline-none placeholder:text-[#8696a0]" style={{ color: C.ink }} />
        <button type="submit" disabled={!text.trim() || sending} aria-label="Send" data-testid="button-chat-send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50" style={{ background: C.accent }}>
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </form>
    </>
  );
}

const ASSISTANT_NOTE = "Instant answers from Rejista's assistant. Our team follows up on anything it can't answer.";
/** Dots while the assistant writes: the person spoke last, moments ago. */
const awaitingReply = (messages: SupportMessage[] | undefined) => {
  const last = messages?.[messages.length - 1];
  return !!last && !last.fromSupport && Date.now() - Date.parse(last.createdAt) < 30_000;
};

/** A signed-in staff member's conversation: the assistant answers how-to questions and the team picks up the rest. */
/**
 * `nudge` is an offer the helper makes first, when the person looks stuck: it "types" for a moment, then says it,
 * with a yes and a no. Yes asks the question for them; the offer itself is never saved to the conversation.
 */
function StaffConversation({ onClose, nudge, onNudgeDone }: { onClose?: () => void; nudge?: Nudge | null; onNudgeDone?: (declined: boolean) => void }) {
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (!nudge) return setWriting(false);
    setWriting(true);
    const timer = setTimeout(() => setWriting(false), 1700);
    return () => clearTimeout(timer);
  }, [nudge]);
  const qc = useQueryClient();
  const q = useListSupportMessages({ query: { queryKey: getListSupportMessagesQueryKey(), refetchInterval: POLL, refetchOnWindowFocus: true } });
  const starters = useListStaffSupportStarters({ query: { queryKey: getListStaffSupportStartersQueryKey(), staleTime: 60_000 } });
  const send = useSendSupportMessage();
  // Opening the chat reads the replies, so the unread count clears.
  const replies = q.data?.filter((m) => m.fromSupport).length ?? 0;
  useEffect(() => { qc.invalidateQueries({ queryKey: getGetSupportUnreadQueryKey() }); }, [qc, replies]);
  const ask = (body: string) => send.mutate({ data: { body } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListSupportMessagesQueryKey() }) });
  return (
    <Conversation title="Rejista Support" subtitle="Ask how anything works" support messages={q.data} loading={q.isLoading} error={q.isError ? errMsg(q.error, "Could not load the chat.") : null}
      mineIsSupport={false} sending={send.isPending} sendError={send.isError ? errMsg(send.error, "Message not sent. Try again.") : null}
      starters={nudge ? [] : (starters.data ?? []).map((x) => x.question)} note={ASSISTANT_NOTE} typing={send.isPending || awaitingReply(q.data) || writing} onClose={onClose}
      extra={nudge && !writing && (
        <div className="mt-1.5 flex justify-start" data-testid="chat-nudge">
          <div className="max-w-[88%] rounded-lg rounded-tl-none px-2.5 py-2 text-[14px] leading-snug shadow-[0_1px_.5px_rgba(11,20,26,.13)]" style={{ background: C.theirs }}>
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: C.bar }}>Assistant</span>
            {nudge.text}
            <div className="mt-2 flex gap-2">
              <button type="button" data-testid="button-nudge-yes" onClick={() => { if (nudge.ask) ask(nudge.ask); onNudgeDone?.(false); }} className="flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: C.accent }}>{nudge.ask ? "Yes, help me" : "Okay"}</button>
              <button type="button" data-testid="button-nudge-no" onClick={() => onNudgeDone?.(true)} className="rounded-full border px-3 py-1.5 text-[13px] font-medium" style={{ borderColor: "#d1d7db", color: C.soft }}>No thanks</button>
            </div>
          </div>
        </div>
      )}
      onSend={(body) => { if (nudge) onNudgeDone?.(false); ask(body); }} />
  );
}

/** The same conversation as a full page, for anyone who opens /support directly. */
export function SupportChatPage() {
  usePageTitle("Support");
  return <Phone testid="support-phone"><StaffConversation /></Phone>;
}

function ThreadChat({ thread, onBack }: { thread: SupportThread; onBack: () => void }) {
  const qc = useQueryClient();
  const key = getListSupportThreadMessagesQueryKey(thread.threadId);
  const q = useListSupportThreadMessages(thread.threadId, { query: { queryKey: key, refetchInterval: POLL, refetchOnWindowFocus: true } });
  const reply = useReplySupportThread();
  const count = q.data?.length ?? 0;
  useEffect(() => { qc.invalidateQueries({ queryKey: getListSupportThreadsQueryKey() }); qc.invalidateQueries({ queryKey: getGetPlatformSupportUnreadQueryKey() }); }, [qc, count]);
  return (
    <Conversation title={thread.name} subtitle={thread.kind === "visitor" ? `Website visitor${thread.detail !== "Website visitor" ? ` · ${thread.detail}` : ""}` : thread.detail} support={false} messages={q.data} loading={q.isLoading}
      error={q.isError ? errMsg(q.error, "Could not load the chat.") : null} mineIsSupport sending={reply.isPending} sendError={reply.isError ? errMsg(reply.error, "Reply not sent. Try again.") : null} onBack={onBack}
      onSend={(body) => reply.mutate({ threadId: thread.threadId, data: { body } }, { onSuccess: () => qc.invalidateQueries({ queryKey: key }) })} />
  );
}

/** Platform owner: every conversation, staff and website visitors, as a chat list; tap one to answer. */
export function PlatformSupportPage() {
  usePageTitle("Support");
  const me = useAuthSession().user;
  const q = useListSupportThreads({ query: { queryKey: getListSupportThreadsQueryKey(), refetchInterval: POLL, refetchOnWindowFocus: true } });
  const [openId, setOpenId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const threads = q.data ?? [];
  const open = threads.find((t) => t.threadId === openId) ?? null;
  const needle = term.trim().toLowerCase();
  const shown = useMemo(() => threads.filter((t) => !needle || [t.name, t.detail, t.lastBody].some((v) => v.toLowerCase().includes(needle))), [threads, needle]);
  return (
    <Phone testid="support-phone">
      {open ? <ThreadChat key={open.threadId} thread={open} onBack={() => setOpenId(null)} /> : <>
        <header className="shrink-0 px-4 pb-3 pt-4 text-white" style={{ background: C.bar }}>
          <div className="text-xl font-semibold">Support chats</div>
          <div className="text-xs text-white/80">Answering as Rejista Support · {me.name}</div>
        </header>
        <div className="shrink-0 bg-white px-3 py-2">
          <label className="flex items-center gap-2 rounded-full px-3.5 py-2" style={{ background: C.field }}>
            <Search className="h-4 w-4" style={{ color: C.soft }} />
            <input data-testid="input-thread-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name, school or message" aria-label="Search chats" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8696a0]" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white" data-testid="thread-list">
          {q.isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: C.soft }} /></div>
            : q.isError ? <p role="alert" className="px-6 py-10 text-center text-sm text-red-700">{errMsg(q.error, "Could not load chats.")}</p>
            : !shown.length ? <p className="px-8 py-12 text-center text-sm" style={{ color: C.soft }}>{threads.length ? "No chats match your search." : "No chats yet. Questions from school staff and from visitors on the website appear here."}</p>
            : <ul>{shown.map((t) => (
              <li key={t.threadId}>
                <button type="button" onClick={() => setOpenId(t.threadId)} data-testid={`thread-${t.threadId}`} className="flex w-full items-center gap-3 px-3 text-left hover:bg-[#f5f6f6]">
                  <Avatar name={t.name} />
                  <span className="min-w-0 flex-1 border-b py-3" style={{ borderColor: "#e9edef" }}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{t.name}<span className="font-normal" style={{ color: C.soft }}> · {t.kind === "visitor" ? <><Globe className="mb-0.5 inline h-3 w-3" /> {t.detail}</> : t.detail}</span></span>
                      <span className="shrink-0 text-[11px]" style={{ color: t.unread ? C.badge : C.soft, fontWeight: t.unread ? 600 : 400 }}>{listStamp(t.lastAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {t.lastFromSupport && <CheckCheck className="h-4 w-4 shrink-0" style={{ color: C.soft }} />}
                      <span className={cn("min-w-0 flex-1 truncate text-[13px]", t.unread > 0 && "font-medium")} style={{ color: t.unread ? C.ink : C.soft }}>{t.lastBody}</span>
                      {t.unread > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ background: C.badge }}>{t.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}</ul>}
        </div>
      </>}
    </Phone>
  );
}

const VISITOR_KEY = "rejista.support.chat";
type VisitorSession = { token: string; name: string };
function storedVisitor(): VisitorSession | null {
  try { const v = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? "null"); return v && typeof v.token === "string" && typeof v.name === "string" ? v : null; } catch { return null; }
}

/** The tappable questions come from the knowledge base, so the owner decides what visitors are offered. */
function useStarters() {
  const q = useListSupportStarters({ query: { queryKey: getListSupportStartersQueryKey(), staleTime: 60_000 } });
  return (q.data ?? []).map((s) => s.question);
}

/**
 * Signing up without leaving the chat. The assistant offers it; the details go into a small form inside the
 * conversation and straight to the sign-up service, never into the chat itself, so a password is never part of a
 * message. When the account exists, the new administrator is taken to their dashboard.
 */
function OnboardInChat() {
  const pricing = useGetPublicPricing({ query: { queryKey: getGetPublicPricingQueryKey(), staleTime: 60_000 } }).data;
  const register = useRegisterSchool();
  const [stage, setStage] = useState<"offer" | "form" | "done">("offer");
  const [d, setD] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const bubble = "max-w-[88%] rounded-lg rounded-tl-none px-2.5 py-2 text-[14px] leading-snug shadow-[0_1px_.5px_rgba(11,20,26,.13)]";
  const field = "w-full rounded-lg border bg-white px-3 py-2 text-[15px] outline-none placeholder:text-[#8696a0] focus:border-[#00a884]";
  const trial = pricing?.trialDays ?? 0, review = pricing?.requireApproval ?? false;
  if (stage === "done") return (
    <div className="mt-2 flex justify-start" data-testid="onboard-done"><div className={bubble} style={{ background: C.theirs }}>{review ? "Your account is created. Taking you in so you can follow your registration…" : "Your school is ready. Taking you to your dashboard…"} <Loader2 className="mb-0.5 inline h-3.5 w-3.5 animate-spin" /></div></div>
  );
  if (stage === "offer") return (
    <div className="mt-2 flex justify-start" data-testid="onboard-offer">
      <div className={bubble} style={{ background: C.theirs }}>
        Want to try Rejista with your own school? I can set up your account right here{trial > 0 ? `, free for ${trial} days` : ""}. It takes a minute.
        <button type="button" data-testid="button-onboard-start" onClick={() => setStage("form")} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold text-white" style={{ background: C.accent }}>Set up my school <ArrowRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
  const submit = () => {
    setErr(null);
    if (d.name.trim().length < 2) return setErr("Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return setErr("Enter a valid email address.");
    if (d.password.length < 6) return setErr("Use at least 6 characters for the password.");
    register.mutate({ data: { adminName: d.name.trim(), email: d.email.trim(), password: d.password, acceptedTerms: true } }, {
      // A fresh page load, so the app opens signed in as the new administrator.
      onSuccess: () => { setStage("done"); setTimeout(() => window.location.assign("/"), 1400); },
      onError: (x) => setErr(errMsg(x, "Could not create the account. Check the details and try again.")),
    });
  };
  return (
    <div className="mt-2 flex justify-start" data-testid="onboard-form">
      <form noValidate className={`${bubble} w-[88%] space-y-2`} style={{ background: C.theirs }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="font-semibold">Let's set up your school</div>
        <p className="text-[12.5px]" style={{ color: C.soft }}>You'll be its administrator. These details go straight to sign-up, not into this chat.</p>
        <input data-testid="input-onboard-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Your full name" aria-label="Your full name" autoComplete="name" maxLength={160} className={field} style={{ borderColor: "#d1d7db", color: C.ink }} />
        <input data-testid="input-onboard-email" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} placeholder="Email you'll sign in with" aria-label="Email" autoComplete="email" maxLength={180} className={field} style={{ borderColor: "#d1d7db", color: C.ink }} />
        <input data-testid="input-onboard-password" type="password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} placeholder="Choose a password (6+ characters)" aria-label="Password" autoComplete="new-password" maxLength={128} className={field} style={{ borderColor: "#d1d7db", color: C.ink }} />
        {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
        <div className="flex items-center gap-2 pt-0.5">
          <button type="submit" disabled={register.isPending} data-testid="button-onboard-create" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: C.accent }}>{register.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{review ? "Create account for review" : "Create my school"}</button>
          <button type="button" onClick={() => setStage("offer")} className="h-9 rounded-full px-3 text-[13px] font-medium" style={{ color: C.soft }}>Not now</button>
        </div>
        <p className="text-[11px]" style={{ color: C.soft }}>By creating an account you agree to the <a href="/terms" target="_blank" rel="noopener" className="underline">Terms</a> and <a href="/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</a>.</p>
      </form>
    </div>
  );
}
/** Sends a question handed in from outside the chat (a tapped teaser) exactly once. */
function useAsk(ask: string | null | undefined, ready: boolean, send: (q: string) => void, onAsked?: () => void) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!ask || !ready || sent.current === ask) return;
    sent.current = ask; send(ask); onAsked?.();
  // The sender is recreated on every render; only a new question should fire this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, ready]);
}

function VisitorConversation({ session, onClose, onExpired, ask, onAsked }: { session: VisitorSession; onClose: () => void; onExpired: () => void; ask?: string | null; onAsked?: () => void }) {
  const starters = useStarters();
  const qc = useQueryClient();
  const request = { headers: { "X-Support-Token": session.token } };
  const q = useListVisitorMessages({ query: { queryKey: getListVisitorMessagesQueryKey(), refetchInterval: POLL, refetchOnWindowFocus: true, retry: false }, request });
  const send = useSendVisitorMessage({ request });
  // The server no longer knows this chat (cleared, or another site's data): start over rather than show an error forever.
  const expired = (q.error as { status?: number } | null)?.status === 401;
  useEffect(() => { if (expired) onExpired(); }, [expired, onExpired]);
  const sendQuestion = (body: string) => send.mutate({ data: { body } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListVisitorMessagesQueryKey() }) });
  useAsk(ask, q.isSuccess, sendQuestion, onAsked);
  return (
    <Conversation title="Rejista Support" subtitle="Ask how anything works" support messages={q.data} loading={q.isLoading} error={q.isError && !expired ? errMsg(q.error, "Could not load the chat.") : null}
      mineIsSupport={false} sending={send.isPending} sendError={send.isError ? errMsg(send.error, "Message not sent. Try again.") : null} starters={starters} note={ASSISTANT_NOTE} typing={send.isPending || awaitingReply(q.data)} onClose={onClose}
      // Once the assistant has answered something, it offers to set the visitor's school up.
      extra={(q.data ?? []).some((m) => m.fromSupport) && !awaitingReply(q.data) ? <OnboardInChat /> : undefined}
      onSend={sendQuestion} />
  );
}

/** Nothing to fill in first: the chat is created quietly when the visitor sends their first message. */
function VisitorFirstMessage({ onStarted, onClose, ask, onAsked }: { onStarted: (s: VisitorSession) => void; onClose: () => void; ask?: string | null; onAsked?: () => void }) {
  const starters = useStarters();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (body: string) => {
    setSending(true); setError(null);
    try {
      const chat = await startVisitorChat({});
      await sendVisitorMessage({ body }, { headers: { "X-Support-Token": chat.token } });
      onStarted({ token: chat.token, name: chat.name });
    } catch (e) { setError(errMsg(e, "Message not sent. Try again.")); setSending(false); }
  };
  useAsk(ask, true, send, onAsked);
  return <Conversation title="Rejista Support" subtitle="Ask how anything works" support messages={[]} loading={false} error={null} mineIsSupport={false} sending={sending} sendError={error} starters={starters} note={ASSISTANT_NOTE} typing={sending} onClose={onClose} onSend={send} extra={<OnboardInChat />} />;
}

/**
 * The floating button and the small phone-sized window it opens. `inApp` keeps it clear of the app's own
 * phone furniture: the bottom bar and the page's add button both sit on the right.
 */
function FloatingChat({ open, onToggle, badge = 0, inApp = false, label, teasers, onTeaser, children }: { open: boolean; onToggle: () => void; badge?: number; inApp?: boolean; label: string; teasers?: string[]; onTeaser?: (question: string) => void; children: ReactNode }) {
  // While the chat is closed, its questions take turns above the button; tapping one opens the chat and asks it.
  const [turn, setTurn] = useState(0);
  const count = teasers?.length ?? 0;
  useEffect(() => {
    if (open || count < 2) return;
    const timer = setInterval(() => setTurn((t) => t + 1), 3800);
    return () => clearInterval(timer);
  }, [open, count]);
  const teaser = !open && count ? teasers![turn % count] : null;
  return (
    <>
      {teaser && (
        <button key={teaser} type="button" data-testid="chat-teaser" onClick={() => onTeaser?.(teaser)}
          className="chat-teaser fixed bottom-[5.75rem] right-6 z-[54] max-w-[min(17rem,calc(100vw-3rem))] rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-left text-[13.5px] font-medium leading-snug shadow-[0_10px_30px_-12px_rgba(0,0,0,.45)] ring-1 ring-black/5 transition hover:-translate-y-0.5" style={{ color: C.ink }}>
          <span className="block text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: C.bar }}>People ask</span>{teaser}
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Chat with Rejista Support" data-testid="chat-window" style={{ color: C.ink }}
          className="chat-pop fixed z-[55] flex flex-col overflow-hidden bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,.5)] max-sm:inset-0 sm:bottom-24 sm:right-6 sm:h-[min(36rem,calc(100dvh-8rem))] sm:w-[23rem] sm:rounded-3xl sm:ring-1 sm:ring-black/10">
          {children}
        </div>
      )}
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Close chat" : label} data-testid="button-open-chat" data-chat-fab style={{ background: C.badge }}
        className={cn("fixed z-[55] flex h-14 items-center gap-2 rounded-full text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(0,0,0,.55)] transition hover:-translate-y-0.5",
          inApp ? "bottom-6 right-6 w-14 justify-center max-md:hidden" : "bottom-6 right-6 px-5",
          open && "max-sm:hidden", open && !inApp && "sm:w-14 sm:justify-center sm:px-0")}>
        {open ? <X className="h-6 w-6" /> : <><MessageCircle className="h-6 w-6" />{!inApp && label}</>}
        {!open && badge > 0 && <span data-testid="badge-chat-unread" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">{badge}</span>}
      </button>
    </>
  );
}

/** Landing page: the chat for visitors who want to know how Rejista works. */
const CLOSED_KEY = "rejista.support.closed";
/** How long the page is left alone before the chat pops up. */
const POP_DELAY_MS = 3000;
/**
 * A short two-note "pop", made in the browser so there is no sound file to load. Browsers only allow sound once the
 * visitor has clicked, tapped or typed on the page, so for someone who has only looked so far this stays silent.
 */
function playPop() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state !== "running") { void ctx.close(); return; }
    const now = ctx.currentTime;
    for (const [frequency, at] of [[660, 0], [880, 0.09]] as const) {
      const tone = ctx.createOscillator(), volume = ctx.createGain();
      tone.type = "sine"; tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, now + at);
      volume.gain.exponentialRampToValueAtTime(0.16, now + at + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
      tone.connect(volume).connect(ctx.destination);
      tone.start(now + at); tone.stop(now + at + 0.18);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch { /* no sound is fine */ }
}
export function VisitorChatWidget({ autoOpen = true }: { autoOpen?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  // Until the chat has been opened once, its button wears a "1" like a message waiting to be read.
  const [fresh, setFresh] = useState(true);
  const [ask, setAsk] = useState<string | null>(null);
  const teasers = useStarters();
  useEffect(() => { if (open) setFresh(false); }, [open]);
  const [session, setSession] = useState<VisitorSession | null>(null);
  // Read after mount: the landing page is also rendered on the server, where there is no browser storage.
  useEffect(() => {
    setSession(storedVisitor());
    // The chat greets visitors by popping open beside the page a few seconds after it loads, with a small sound.
    // On a phone it would cover the whole page, so there it waits behind its button; and once someone closes it,
    // it stays closed for the rest of their visit.
    let closed = false;
    try { closed = sessionStorage.getItem(CLOSED_KEY) === "1"; } catch { /* storage unavailable */ }
    if (!autoOpen || closed || !window.matchMedia("(min-width: 640px)").matches) return;
    const timer = setTimeout(() => { setOpen((already) => { if (!already) playPop(); return true; }); }, POP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoOpen]);
  const toggle = (next: boolean) => {
    setOpen(next);
    try { if (next) sessionStorage.removeItem(CLOSED_KEY); else sessionStorage.setItem(CLOSED_KEY, "1"); } catch { /* storage unavailable */ }
  };
  const remember = (s: VisitorSession | null) => {
    setSession(s);
    try { if (s) localStorage.setItem(VISITOR_KEY, JSON.stringify(s)); else localStorage.removeItem(VISITOR_KEY); } catch { /* storage unavailable: the chat lasts until the page closes */ }
  };
  return (
    <FloatingChat open={open} onToggle={() => toggle(!open)} label="Chat with us" badge={fresh ? 1 : 0} teasers={teasers} onTeaser={(question) => { setAsk(question); toggle(true); }}>
      {session ? <VisitorConversation session={session} onClose={() => toggle(false)} onExpired={() => remember(null)} ask={ask} onAsked={() => setAsk(null)} /> : <VisitorFirstMessage onStarted={remember} onClose={() => toggle(false)} ask={ask} onAsked={() => setAsk(null)} />}
    </FloatingChat>
  );
}

/** Asks the in-app helper to open; the phone's top bar uses it, since phones have no floating button. */
export const OPEN_HELP_EVENT = "rejista:open-help";
export const openHelp = () => window.dispatchEvent(new Event(OPEN_HELP_EVENT));
const HELP_SEEN_KEY = "rejista.help.seen";
/**
 * The helper's button in the phone's top bar. A spark, not a question mark: it carries a small live dot until
 * it has been opened once, and a count when a reply is waiting.
 */
export function HelpButton() {
  const unread = useGetSupportUnread({ query: { queryKey: getGetSupportUnreadQueryKey(), refetchInterval: 30_000 } }).data?.count ?? 0;
  const [fresh, setFresh] = useState(false);
  useEffect(() => { try { setFresh(localStorage.getItem(HELP_SEEN_KEY) !== "1"); } catch { /* storage unavailable */ } }, []);
  const open = () => { setFresh(false); try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch { /* storage unavailable */ } openHelp(); };
  return (
    <button type="button" onClick={open} aria-label={unread ? `Ask the assistant, ${unread} new` : "Ask the assistant"} data-testid="button-header-help" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-muted">
      <span className="help-spark flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-emerald-500 text-white shadow-[0_4px_12px_-4px_hsl(var(--primary)/.7)]"><Sparkles className="h-4 w-4" /></span>
      {unread > 0 ? <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">{unread}</span>
        : fresh && <span aria-hidden className="absolute right-1 top-1 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-background" /></span>}
    </button>
  );
}

/**
 * Inside the school app: the same helper on every page, with a count when a reply is waiting. Once in a while,
 * when the person looks stuck (see help-nudge), it opens by itself with a sound and offers to help.
 */
export function StaffChatWidget() {
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [path] = useLocation();
  const { user } = useAuthSession();
  const unread = useGetSupportUnread({ query: { queryKey: getGetSupportUnreadQueryKey(), refetchInterval: 30_000, enabled: !open } });
  const offer = (reason: NudgeReason) => { setNudge(nudgeFor(reason, user.name.trim().split(/\s+/)[0] || "there", pageName(path, false))); setOpen(true); playPop(); };
  useHelpNudge({ enabled: true, userId: user.id, path, busy: open, onNudge: offer });
  // Every successful save counts towards "this person knows what they are doing". Chatting, signing out and
  // skipping setup steps are not saves.
  const qc = useQueryClient();
  useEffect(() => qc.getMutationCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const key = String(event.mutation.options.mutationKey?.[0] ?? "");
    if (!key || /support|logout|onboarding|login/i.test(key)) return;
    nudgeSawSave(user.id);
  }), [qc, user.id]);
  useEffect(() => {
    const show = () => setOpen(true);
    // For trying an offer out by hand: window.dispatchEvent(new CustomEvent("rejista:try-nudge", { detail: "idle" }))
    const tryOut = (e: Event) => offer(((e as CustomEvent).detail as NudgeReason) || "idle");
    window.addEventListener(OPEN_HELP_EVENT, show);
    window.addEventListener("rejista:try-nudge", tryOut);
    return () => { window.removeEventListener(OPEN_HELP_EVENT, show); window.removeEventListener("rejista:try-nudge", tryOut); };
  // The offer reads the current page and name when it fires; re-binding on every page change is enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const close = () => { if (nudge) nudgeDeclined(user.id); setNudge(null); setOpen(false); };
  return (
    <FloatingChat inApp open={open} onToggle={() => open ? close() : setOpen(true)} badge={unread.data?.count ?? 0} label="Help">
      <StaffConversation onClose={close} nudge={nudge} onNudgeDone={(declined) => { if (declined) { nudgeDeclined(user.id); setOpen(false); } setNudge(null); }} />
    </FloatingChat>
  );
}
