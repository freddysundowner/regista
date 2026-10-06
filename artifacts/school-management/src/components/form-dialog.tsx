import { useRef, type ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared accessible dialog for create/edit/action forms.
 * - Radix gives focus trap, focus return to trigger, Escape and backdrop close.
 * - Content unmounts when closed, so form state resets on every open.
 * - Callers keep the dialog open on error and close it in onSuccess.
 * - `busy` blocks dismissal while a mutation is in flight.
 * - size "full" is a full-screen workflow dialog for long forms.
 */
export function FormDialog({ open, onOpenChange, title, description, children, size = "md", busy, testid }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: ReactNode; children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full"; busy?: boolean; testid?: string;
}) {
  const block = (e: Event) => { if (busy) e.preventDefault(); };
  const w = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl", full: "" }[size];
  const full = size === "full";
  const opener = useRef<HTMLElement | null>(null);
  return (
    <D.Root open={open} onOpenChange={(o) => { if (!o && busy) return; onOpenChange(o); }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <D.Content
          data-testid={testid ?? "form-dialog"}
          onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          onEscapeKeyDown={block} onPointerDownOutside={block} onInteractOutside={block}
          className={cn(
            "fixed z-50 flex flex-col border border-card-border bg-card shadow-lg outline-none",
            full
              ? "inset-0 pt-[env(safe-area-inset-top)] sm:inset-4 sm:rounded-lg sm:pt-0"
              : cn("inset-x-0 bottom-0 max-h-[94dvh] rounded-t-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg", w),
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border/70 px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700/80">Rejista</div>
              <D.Title className="font-display text-xl font-semibold leading-tight">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close disabled={busy} aria-label="Close dialog" data-testid="button-dialog-close" className="-mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          <div onFocusCapture={(e) => {
            // Keep the focused field visible above the on-screen keyboard on phones.
            const t = e.target as HTMLElement;
            if (window.matchMedia("(max-width: 767px)").matches && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 280);
          }} className={cn("dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]", full && "mx-auto w-full max-w-6xl")}>{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
