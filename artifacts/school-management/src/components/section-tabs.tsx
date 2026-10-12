import { Link, useLocation } from "wouter";
import { sectionFor, type visibleSections } from "@/lib/sections";
import { cn } from "@/lib/utils";

/** Tabs for the section the current page belongs to. A section with one page shows none. */
export function SectionTabs({ sections }: { sections: ReturnType<typeof visibleSections> }) {
  const [loc] = useLocation();
  const section = sectionFor(sections, loc);
  if (!section || section.tabs.length < 2) return null;
  const path = loc.startsWith("/students/") ? "/students" : loc;
  // A tab is active on its own page and the pages under it, unless a longer tab owns them (Fee structure vs Fee structure PDFs).
  const on = (href: string) => path === href || path.startsWith(`${href}/`) && !section.tabs.some((t) => t.href !== href && path.startsWith(t.href) && t.href.length > href.length);
  // Phone: a page opened from a list (one learner, one member of staff) is its own screen with a back arrow, so the section's tabs are left off it.
  const inner = !section.tabs.some((t) => t.href === loc);
  return (
    <nav aria-label={`${section.label} pages`} className={cn("-mx-4 mb-6 flex items-center gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", inner && "max-md:hidden")} data-testid="section-tabs">
      {section.tabs.map((t) => {
        const active = on(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} data-testid={`section-tab-${t.href.slice(1).replace(/\//g, "-")}`}
            className={cn("relative shrink-0 whitespace-nowrap px-3.5 py-3 text-sm font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
            <span className={cn("absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary transition-transform", active ? "scale-x-100" : "scale-x-0")} />
          </Link>
        );
      })}
    </nav>
  );
}
