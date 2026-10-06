import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

type Entry = { path: string; title: string } | null;
const Ctx = createContext<{ entry: Entry; set: (e: Entry) => void } | null>(null);

/** Holds the title registered by the page on screen, keyed by the route it was registered for. */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [entry, set] = useState<Entry>(null);
  return <Ctx.Provider value={{ entry, set }}>{children}</Ctx.Provider>;
}

/** Register the current page title for the mobile app header. Cleared on unmount. */
export function usePageTitle(title: string | undefined) {
  const c = useContext(Ctx);
  const [loc] = useLocation();
  const set = c?.set;
  useEffect(() => {
    if (!set || !title) return;
    set({ path: loc, title });
    return () => set(null);
  }, [set, title, loc]);
}

/** Title for `loc`: the registered one when it belongs to this route, otherwise null. */
export function useRegisteredTitle(loc: string) {
  const c = useContext(Ctx);
  return c?.entry && c.entry.path === loc ? c.entry.title : null;
}
