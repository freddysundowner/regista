import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** True when every word typed appears somewhere in the given fields (case-insensitive). */
export function matches(text: string, ...fields: (string | number | null | undefined)[]) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter((f) => f != null).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The same search box on every list: icon, placeholder that says what it searches, and a clear button. */
export function ListSearch({ value, onChange, placeholder, className, testid }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; testid?: string }) {
  return (
    <div className={cn("relative min-w-[12rem] flex-1", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid ?? "list-search"}
        className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 [&::-webkit-search-cancel-button]:hidden" />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}
