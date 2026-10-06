import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, RotateCw, SlidersHorizontal, ChevronDown, MoveHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { usePageTitle } from "@/lib/page-title";

export function PageHeader({ eyebrow, title, children, meta }: { eyebrow: string; title: string; children?: ReactNode; meta?: ReactNode }) {
  // On phones inner pages show their title in the app header (shell); the in-page block is desktop-only.
  usePageTitle(title);
  const [loc] = useLocation();
  const inner = loc !== "/";
  return (
    <header className={cn("page-header rise flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between", inner && "page-header-inner max-md:border-0 max-md:pb-0")}>
      <div className={cn("min-w-0", inner && "max-md:hidden")}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">{eyebrow}</div>
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight text-foreground [overflow-wrap:anywhere] md:text-[2.4rem] md:leading-none">{title}</h1>
        {meta && <div className="mt-2 text-sm text-muted-foreground">{meta}</div>}
      </div>
      {children && <div className="page-actions flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Panel({ title, note, children, className, action }: { title?: string; note?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("rise min-w-0 max-w-full rounded-lg border border-card-border bg-card", className)}>
      {title && (
        <div className="flex min-w-0 flex-col items-stretch justify-between gap-3 border-b border-border/70 px-4 py-3 md:flex-row md:flex-wrap md:items-baseline sm:px-5">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </div>
          {action && <div className="panel-actions min-w-0 max-w-full">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className, required }: { label: string; hint?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold text-foreground/80">
        {label}
        {required && <span className="ml-0.5 text-amber-700">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const ctl = "h-11 w-full text-base sm:h-9 sm:text-sm rounded-md border border-input bg-background/60 px-3 outline-none transition focus:border-primary focus:bg-card focus:ring-2 focus:ring-ring/20 disabled:opacity-60";

export function TextInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(ctl, className)} />;
}

export function NativeSelect({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cn(ctl, "appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%23577' stroke-width='1.5'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

export function FormError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return (
    <div data-testid="text-form-error" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {msg}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border/60">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-5 py-3.5">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${[28, 16, 20, 12][j % 4]}%`, animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="max-w-sm text-sm text-muted-foreground">{msg}</p>
      {onRetry && (
        <button data-testid="button-retry" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="ruled flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-primary/40 bg-card text-primary">{icon}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

const tones: Record<string, string> = {
  active: "bg-emerald-700/10 text-emerald-800 border-emerald-700/20",
  valid: "bg-emerald-700/10 text-emerald-800 border-emerald-700/20",
  transferred: "bg-sky-800/10 text-sky-900 border-sky-800/20",
  graduated: "bg-amber-600/15 text-amber-900 border-amber-700/25",
  left: "bg-stone-500/10 text-stone-700 border-stone-500/20",
  inactive: "bg-stone-500/10 text-stone-700 border-stone-500/20",
  error: "bg-destructive/10 text-destructive border-destructive/25",
  duplicate: "bg-amber-600/15 text-amber-900 border-amber-700/25",
  current: "bg-primary/10 text-primary border-primary/25",
};

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", tones[tone] ?? tones.left)}>{children}</span>;
}

export function Btn({ variant = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" }) {
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_1px_0_hsl(188_52%_14%)]",
    ghost: "hover:bg-muted text-foreground",
    outline: "border border-input bg-card hover:bg-muted",
    danger: "border border-destructive/30 text-destructive hover:bg-destructive/5",
  }[variant];
  return <button {...p} className={cn("inline-flex h-11 min-w-11 items-center sm:h-9 sm:min-w-0 justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold transition active:translate-y-px disabled:pointer-events-none disabled:opacity-50", v, className)} />;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-4">{children}</div>;
}

/**
 * Wraps a regular <table>. Desktop: unchanged table in a contained horizontal scroller.
 * Phone (<768px): every row becomes a card; each cell is labelled from its column header
 * (columns hidden on desktop-small breakpoints are revealed inside the card).
 */
export function CardTable({ children, className, testid }: { children: ReactNode; className?: string; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const label = () => {
      const heads = Array.from(el.querySelectorAll("thead th")).map((th) => (th.querySelector(".sr-only") ? "" : (th.textContent ?? "").trim()));
      el.querySelectorAll("tbody tr").forEach((tr) => {
        let i = 0;
        Array.from(tr.children).forEach((td) => {
          const h = heads[i] ?? "";
          if (h && td.getAttribute("data-label") !== h) td.setAttribute("data-label", h);
          if (!h && td.hasAttribute("data-label")) td.removeAttribute("data-label");
          i += Number((td as HTMLTableCellElement).colSpan || 1);
        });
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return <div ref={ref} data-testid={testid} className={cn("rt-cards overflow-x-auto", className)}>{children}</div>;
}

/** Dense editable grid: stays a grid on phones, scrolls inside its box with a visible swipe hint. */
export function DenseScroll({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-1.5 text-[11px] font-medium text-muted-foreground md:hidden"><MoveHorizontal className="h-3.5 w-3.5" />Swipe sideways to see every column</div>
      <div className={cn("dense-scroll overflow-auto overscroll-x-contain", className)}>{children}</div>
    </div>
  );
}

/**
 * Filter toolbar. Always visible on desktop; on phones the extra filters collapse behind
 * an accessible toggle with an active-count badge. `lead` (usually search) stays visible.
 */
export function Filters({ lead, children, active = 0, className, onClear }: { lead?: ReactNode; children: ReactNode; active?: number; className?: string; onClear?: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useRef(`filters-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lead && <div className="min-w-0 flex-1 md:min-w-[14rem]">{lead}</div>}
      <button type="button" aria-expanded={open} aria-controls={id} data-testid="button-toggle-filters" onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold md:hidden", !lead && "w-full justify-center", active ? "border-primary/40 bg-primary/5 text-primary" : "border-input bg-card")}>
        <SlidersHorizontal className="h-4 w-4" />{lead ? <span className="sr-only">Filters</span> : "Filters"}
        {active > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{active}</span>}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <div id={id} className={cn(open ? "grid" : "hidden", "w-full gap-2 md:flex md:w-auto md:flex-wrap md:items-center", className)}>
        {children}
        {onClear && active > 0 && <button type="button" onClick={onClear} className="h-11 rounded-md px-3 text-sm font-semibold text-primary hover:bg-muted md:h-9">Clear filters</button>}
      </div>
    </div>
  );
}

/**
 * Phone-only floating primary action. Sits above the bottom navigation and safe area.
 * Only render it for an action the user is actually permitted to take.
 */
export function Fab({ label, icon, onClick, testid }: { label: string; icon: ReactNode; onClick: () => void; testid: string }) {
  return <>
    {createPortal(
      <button type="button" data-testid={testid} onClick={onClick}
        className="fab fixed right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-primary pl-4 pr-5 text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_-8px_hsl(188_52%_14%/0.6)] ring-1 ring-sidebar-primary/40 transition active:scale-95 md:hidden">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">{icon}</span>{label}
      </button>, document.body)}
  </>;
}
