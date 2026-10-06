import { useRef, type KeyboardEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { BadgeCheck, Mail, RadioTower } from "lucide-react";
import { PageHeader } from "@/components/kit";
import { PlatformMessagingPage } from "@/pages/messaging-settings";
import LicencePlans from "@/pages/licence-plans";
import PlatformEmailSettings from "@/pages/platform-email-settings";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "email", label: "Email", icon: Mail },
  { id: "messaging", label: "Messaging", icon: RadioTower },
  { id: "licences", label: "Licence plans", icon: BadgeCheck },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function PlatformSettings() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const raw = new URLSearchParams(search).get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "email";
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const go = (id: TabId) => { if (id !== tab) navigate(`/platform/settings?tab=${id}`); };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault(); go(TABS[n].id); refs.current[TABS[n].id]?.focus();
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Settings" meta="Platform-wide email, messaging defaults and licence plans." />
      <div role="tablist" aria-label="Settings sections" onKeyDown={onKey}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`tab-${t.id}`} aria-selected={on} aria-controls={`panel-${t.id}`}
              tabIndex={on ? 0 : -1} data-testid={`tab-settings-${t.id}`} onClick={() => go(t.id)}
              className={cn("relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 rounded-t-md",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <t.icon className={cn("h-4 w-4", on && "text-primary")} />{t.label}
              <span className={cn("absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary transition-transform", on ? "scale-x-100" : "scale-x-0")} />
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={tab} className="rise">
        {tab === "email" ? <PlatformEmailSettings /> : tab === "messaging" ? <PlatformMessagingPage embedded /> : <LicencePlans embedded />}
      </div>
    </div>
  );
}
