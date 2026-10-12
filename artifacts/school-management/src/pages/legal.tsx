import { useEffect } from "react";
import { Link } from "wouter";
import { APP_INITIAL } from "@/lib/brand";
import { LEGAL, LEGAL_UPDATED, type LegalDoc } from "@/lib/legal";

/** The public Terms and Privacy Policy pages. */
export default function LegalPage({ doc, signedIn = false }: { doc: LegalDoc["slug"]; signedIn?: boolean }) {
  const d = LEGAL[doc];
  const other = LEGAL[doc === "terms" ? "privacy" : "terms"];
  useEffect(() => { document.title = d.title; window.scrollTo({ top: 0 }); }, [d]);
  return (
    <div className="min-h-[100dvh] bg-muted/40 text-foreground">
      <header className="sticky top-0 z-20 bg-muted/40 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <nav className="mx-auto flex h-16 w-[90%] items-center justify-between gap-4">
          <Link href="/" aria-label="Rejista home" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">{APP_INITIAL}</span>
            <span className="font-display text-xl font-semibold tracking-tight">Rejista</span>
          </Link>
          <Link href="/" data-testid="link-legal-home" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">{signedIn ? "Back to the system" : "Home"}</Link>
        </nav>
      </header>

      <main className="mx-auto w-[90%] max-w-3xl pb-24 pt-10 lg:pt-14" data-testid={`legal-${d.slug}`}>
        <h1 className="text-[clamp(1.75rem,4.5vw,2.75rem)] font-semibold leading-tight tracking-[-0.03em]">{d.heading}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        <p className="mt-5 text-lg text-muted-foreground">{d.intro}</p>
        <div className="mt-10 space-y-9">
          {d.sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-xl font-semibold tracking-[-0.01em]">{s.title}</h2>
              {s.body.map((p, i) => <p key={i} className="mt-3 text-[15px] leading-relaxed">{p}</p>)}
              {s.points && <ul className="mt-3 space-y-2 text-[15px] leading-relaxed">{s.points.map((p, i) => <li key={i} className="flex gap-3"><span aria-hidden className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" /><span>{p}</span></li>)}</ul>}
            </section>
          ))}
        </div>
        <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">See also the <Link href={`/${other.slug}`} data-testid="link-legal-other" className="font-semibold text-primary hover:underline">{other.heading}</Link>.</p>
      </main>

      <footer className="border-t border-border"><div className="mx-auto flex w-[90%] items-center justify-between py-8 text-sm text-muted-foreground"><span>{d.heading}</span><span>© {new Date().getFullYear()} Rejista</span></div></footer>
    </div>
  );
}
