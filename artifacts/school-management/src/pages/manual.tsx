import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, Search, UserRound } from "lucide-react";
import { APP_INITIAL } from "@/lib/brand";
import { MANUAL, type ManualChapter } from "@/lib/manual";
import { VisitorChatWidget } from "@/components/support-chat";

export const MANUAL_TITLE = "Rejista user manual · How to use the school management system";
export const MANUAL_DESCRIPTION = "Step-by-step guide to Rejista: setting up a school, learners, fees and billing, M-Pesa and bank payments, attendance, marks, report cards, reports and staff accounts.";

function matches(chapter: ManualChapter, needle: string): ManualChapter | null {
  if (!needle) return chapter;
  const has = (text?: string) => !!text && text.toLowerCase().includes(needle);
  const topics = chapter.topics.filter((t) => has(t.title) || has(t.intro) || has(t.who) || t.steps?.some(has) || t.notes?.some(has));
  return has(chapter.title) || has(chapter.summary) ? chapter : topics.length ? { ...chapter, topics } : null;
}

/** The public user manual: every chapter on one page, with a contents list and a search box. */
export default function ManualPage({ signedIn = false }: { signedIn?: boolean }) {
  const [term, setTerm] = useState("");
  useEffect(() => { document.title = MANUAL_TITLE; }, []);
  const chapters = useMemo(() => MANUAL.map((c) => matches(c, term.trim().toLowerCase())).filter((c): c is ManualChapter => !!c), [term]);
  return (
    <div className="min-h-[100dvh] bg-muted/40 text-foreground">
      <header className="sticky top-0 z-20 bg-muted/40 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <nav className="mx-auto flex h-16 w-[90%] items-center justify-between gap-4">
          <Link href="/" aria-label="Rejista home" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">{APP_INITIAL}</span>
            <span className="font-display text-xl font-semibold tracking-tight">Rejista</span>
          </Link>
          <Link href="/" data-testid="link-manual-home" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">{signedIn ? "Back to the system" : "Home"}</Link>
        </nav>
      </header>

      <main className="mx-auto w-[90%] pb-24 pt-10 lg:pt-14">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary"><BookOpen className="h-4 w-4" />User manual</div>
          <h1 className="mt-2 text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-tight tracking-[-0.03em]">How to use Rejista</h1>
          <p className="mt-3 text-lg text-muted-foreground">Every part of the system, step by step, in the order a school sets it up. Names such as Add staff or Submit register are the buttons and menu items you will see on screen.</p>
          <label className="mt-6 flex items-center gap-2.5 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-primary/40">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input data-testid="input-manual-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search the manual, e.g. receipt, import, register" aria-label="Search the manual" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70" />
          </label>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="Manual contents" className="lg:sticky lg:top-24 lg:self-start" data-testid="manual-contents">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contents</div>
            <ol className="flex gap-2 overflow-x-auto pb-1 text-sm lg:block lg:space-y-0.5 lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {chapters.map((c, i) => (
                <li key={c.id} className="shrink-0"><a href={`#${c.id}`} className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-muted-foreground ring-1 ring-foreground/10 transition hover:bg-card hover:text-foreground lg:whitespace-normal lg:ring-0"><span className="mr-2 tabular-nums text-muted-foreground/60">{i + 1}</span>{c.title}</a></li>
              ))}
            </ol>
          </nav>

          <div className="space-y-14">
            {!chapters.length && <p className="rounded-2xl bg-card p-6 text-muted-foreground ring-1 ring-foreground/[.06]" data-testid="manual-no-results">Nothing in the manual matches "{term.trim()}". Try a shorter word, or ask in the chat.</p>}
            {chapters.map((c) => (
              <section key={c.id} id={c.id} className="scroll-mt-24" data-testid={`manual-${c.id}`}>
                <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{c.title}</h2>
                <p className="mt-1.5 text-muted-foreground">{c.summary}</p>
                <div className="mt-6 space-y-4">
                  {c.topics.map((t) => (
                    <article key={t.title} className="rounded-2xl bg-card p-5 ring-1 ring-foreground/[.06] sm:p-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="text-lg font-semibold">{t.title}</h3>
                        {t.who && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{t.who}</span>}
                      </div>
                      {t.intro && <p className="mt-2 text-[15px] text-muted-foreground">{t.intro}</p>}
                      {t.steps && <ol className="mt-3 space-y-2.5">{t.steps.map((s, i) => (
                        <li key={i} className="flex gap-3 text-[15px] leading-relaxed"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span><span>{s}</span></li>
                      ))}</ol>}
                      {t.notes && <ul className={`space-y-1.5 text-sm text-muted-foreground ${t.steps ? "mt-4 border-t border-dashed border-border pt-3" : "mt-3"}`}>{t.notes.map((n, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" /><span>{n}</span></li>)}</ul>}
                    </article>
                  ))}
                </div>
              </section>
            ))}

            {!signedIn && <div className="flex flex-col items-start justify-between gap-5 rounded-3xl bg-primary px-6 py-8 text-primary-foreground sm:px-9 md:flex-row md:items-center">
              <div><h2 className="text-2xl font-semibold tracking-[-0.02em]">Ready to try it?</h2><p className="mt-1.5 text-primary-foreground/75">Create an account and follow the Getting started chapter.</p></div>
              <Link href="/register" data-testid="button-manual-start" className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-card px-6 text-[15px] font-semibold text-foreground transition hover:-translate-y-px">Get started <ArrowRight className="h-4 w-4" /></Link>
            </div>}
          </div>
        </div>
      </main>

      {!signedIn && <VisitorChatWidget autoOpen={false} />}
      <footer className="border-t border-border"><div className="mx-auto flex w-[90%] items-center justify-between py-8 text-sm text-muted-foreground"><span>Rejista user manual</span><span>© {new Date().getFullYear()} Rejista</span></div></footer>
    </div>
  );
}
