import { useRef, type ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared accessible dialog for create/edit/action forms.
 * - Radix gives focus trap, focus return to trigger, Escape and backdrop close.
 * - Content unmounts when closed, so form state resets on every open.
 * - Callers keep the dialog open on error and close it in onSuccess.
 * - `busy` blocks dismissal while a mutation is in flight.
 * - size "full" is a full-screen workflow dialog for long forms.
 * - On a phone the longer forms (size "lg", "xl" and "full") open as a full page: a plain bar with a back arrow,
 *   no dimmed page behind, the Save bar resting at the bottom. Short ones ("sm", "md") slide up as a sheet.
 *   `phonePage` overrides that either way, for a short-sized form that is long, or the reverse.
 * - Either way the form is sized to the part of the screen that is visible (see useVisibleArea), so when the
 *   keyboard is up it shrinks to sit above it and its Save bar is never buried.
 */
export function FormDialog({ open, onOpenChange, title, description, children, size = "md", busy, testid, phonePage }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: ReactNode; children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full"; busy?: boolean; testid?: string; phonePage?: boolean;
}) {
  const block = (e: Event) => { if (busy) e.preventDefault(); };
  const w = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl", full: "" }[size];
  const full = size === "full";
  const page = phonePage ?? (size === "lg" || size === "xl" || full);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <D.Root open={open} onOpenChange={(o) => { if (!o && busy) return; onOpenChange(o); }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <D.Content
          data-testid={testid ?? "form-dialog"}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            // Phone: the form opens with nothing focused, so the keyboard (or a date's calendar) only comes up
            // when the person taps a field, and they see the whole form first.
            if (window.matchMedia("(max-width: 767px)").matches) { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          onEscapeKeyDown={block} onPointerDownOutside={block} onInteractOutside={block}
          className={cn(
            "fixed inset-x-0 z-50 flex flex-col border border-card-border bg-card shadow-lg outline-none",
            page ? "phone-page max-sm:top-[var(--vvt,0px)] max-sm:h-[var(--vvh,100dvh)] max-sm:rounded-none max-sm:border-0 max-sm:bg-background max-sm:pt-[env(safe-area-inset-top)] max-sm:shadow-none"
              : "max-sm:top-[calc(var(--vvt,0px)+var(--vvh,100dvh))] max-sm:max-h-[calc(var(--vvh,100dvh)*0.96)] max-sm:-translate-y-full max-sm:rounded-t-xl",
            full ? "sm:inset-4 sm:rounded-lg" : cn("sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg", w),
          )}
        >
          <div className={cn("flex items-start justify-between gap-4 border-b border-border/70 px-4 py-3.5 max-sm:items-center max-sm:py-1.5 sm:px-5 sm:py-4", page && "max-sm:justify-start max-sm:gap-0 max-sm:border-0 max-sm:px-1.5 max-sm:!py-0")}>
            {page && <D.Close disabled={busy} aria-label="Back" data-testid="button-dialog-back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-muted disabled:opacity-40 sm:hidden"><ChevronLeft className="h-6 w-6" /></D.Close>}
            <div className="min-w-0">
              <D.Title className="font-display text-xl font-semibold leading-tight max-sm:text-[1.0625rem]">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted-foreground max-sm:sr-only">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close disabled={busy} aria-label="Close dialog" data-testid="button-dialog-close" className={cn("-mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40", page && "max-sm:hidden")}>
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
