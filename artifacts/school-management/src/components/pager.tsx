import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Rows per page for every record list. */
export const PAGE_SIZE = 25;

export type PagerState = { page: number; onPage: (page: number) => void; size: number; total?: number; pages?: number; hasNext?: boolean; busy?: boolean };

/**
 * Pages a list that is already loaded. Goes back to page 1 whenever `resetKey` changes,
 * so pass the filters and search that shape the list.
 */
export function usePaged<T>(items: readonly T[] | undefined, resetKey?: unknown, size = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(resetKey ?? null);
  useEffect(() => setPage(1), [key]);
  const total = items?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  return { rows: (items ?? []).slice((current - 1) * size, current * size), pager: { page: current, pages, total, size, onPage: setPage } satisfies PagerState };
}

/** Page state for a list the server pages. Goes back to page 1 whenever `resetKey` changes. */
export function useServerPage(resetKey?: unknown, size = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(resetKey ?? null);
  useEffect(() => setPage(1), [key]);
  return { page, size, setPage, pager: (rows: number, busy?: boolean, total?: number): PagerState =>
    ({ page, size, onPage: setPage, busy, total, pages: total === undefined ? undefined : Math.max(1, Math.ceil(total / size)), hasNext: total === undefined ? rows >= size : page * size < total }) };
}

function numbers(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, page - 1), to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

/** The same footer under every list: what's showing, and previous / page numbers / next. Hidden when everything fits on one page. */
export function Pager({ page, onPage, size, total, pages, hasNext, busy, className }: PagerState & { className?: string }) {
  const last = pages ?? (hasNext ? page + 1 : page);
  const canNext = pages !== undefined ? page < pages : !!hasNext;
  if (page === 1 && !canNext) return null;
  const go = (n: number) => { onPage(n); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };
  const from = (page - 1) * size + 1;
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-input bg-card px-2 text-xs font-semibold hover:bg-muted disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="Pages" data-testid="pager" className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground", className)}>
      <span data-testid="pager-range">
        {total !== undefined ? <>Showing {from.toLocaleString("en-KE")}–{Math.min(page * size, total).toLocaleString("en-KE")} of {total.toLocaleString("en-KE")}</> : <>Page {page}</>}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} aria-label="Previous page" data-testid="pager-prev" disabled={page === 1 || busy} onClick={() => go(page - 1)}><ChevronLeft className="h-4 w-4" /></button>
        {pages !== undefined && <span className="hidden items-center gap-1 sm:flex">
          {numbers(page, last).map((n, i) => n === "…" ? <span key={`gap-${i}`} className="px-1">…</span> : (
            <button key={n} type="button" aria-current={n === page ? "page" : undefined} disabled={busy} onClick={() => go(n)}
              className={cn(btn, n === page && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>{n}</button>
          ))}
        </span>}
        {pages !== undefined && <span className="px-2 sm:hidden">{page} of {pages}</span>}
        <button type="button" className={btn} aria-label="Next page" data-testid="pager-next" disabled={!canNext || busy} onClick={() => go(page + 1)}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
}
