import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, children, meta }: { eyebrow: string; title: string; children?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="rise flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">{eyebrow}</div>
        <h1 className="font-display text-3xl font-semibold text-foreground md:text-[2.4rem] leading-none">{title}</h1>
        {meta && <div className="mt-2 text-sm text-muted-foreground">{meta}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Panel({ title, note, children, className, action }: { title?: string; note?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("rise rounded-lg border border-card-border bg-card", className)}>
      {title && (
        <div className="flex items-baseline justify-between gap-3 border-b border-border/70 px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </div>
          {action}
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

const ctl = "h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm outline-none transition focus:border-primary focus:bg-card focus:ring-2 focus:ring-ring/20 disabled:opacity-60";

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
  return <button {...p} className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold transition active:translate-y-px disabled:pointer-events-none disabled:opacity-50", v, className)} />;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-4">{children}</div>;
}
