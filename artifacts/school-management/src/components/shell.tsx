import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageTitleProvider, useRegisteredTitle } from "@/lib/page-title";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation } from "wouter";
import { ShieldCheck, Building2 , ScrollText, LayoutDashboard, Eye, CalendarClock, GitMerge, MessageSquare, Library, ClipboardCheck, CalendarCheck, FileBadge, BarChart3, Plug, RadioTower } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { Activity, Banknote, BookOpen, CheckSquare, ClipboardList, FileText, HandHeart, Receipt, FileSpreadsheet, GraduationCap, LayoutGrid, KeyRound, LogOut, Menu, X, Settings, Users, UserCog } from "lucide-react";
import { useAuthSession, useReadOnly, usePerms, ROLE_LABEL, initials } from "@/lib/session";
import { TenantAccessBanner, hardReset } from "@/components/platform-kit";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, ChevronLeft, PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pageName } from "@/lib/route-names";

const COLLAPSE_KEY = "rejista.sidebar.collapsed";
function readCollapsed() { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } }
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export function Shell({ children }: { children: ReactNode }) {
  return <PageTitleProvider><ShellInner>{children}</ShellInner></PageTitleProvider>;
}

function ShellInner({ children }: { children: ReactNode }) {
  const { user, school, mode, tenantAccess } = useAuthSession();
  const p = usePerms();
  const platformMode = mode === "platform";
  const ro = useReadOnly();
  const { toast } = useToast();
  const [loc, navigate] = useLocation();
  // In-app history: back only uses the browser stack when we know the previous entry is ours.
  const stack = useRef<string[]>([]);
  useEffect(() => {
    const st = stack.current;
    if (st[st.length - 1] === loc) return;
    if (st[st.length - 2] === loc) st.pop(); else st.push(loc);
  }, [loc]);
  useEffect(() => {
    document.querySelector(".app-main")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [loc]);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  // Clearing a query cache does not reset mounted observers. A new document
  // also discards in-memory learner drafts when changing staff accounts.
  const logout = useLogout({ mutation: { onSuccess: () => hardReset(qc) } });

  const N = (h: string) => pageName(h, platformMode) ?? h;
  const platformNav = [
    { href: "/", label: N("/"), icon: LayoutDashboard, show: true },
    { href: "/schools", label: N("/schools"), icon: Building2, show: true },
    { href: "/platform/subscriptions", label: N("/platform/subscriptions"), icon: Wallet, show: true },
    { href: "/platform/settings", label: N("/platform/settings"), icon: Settings, show: true },
    { href: "/platform/audit", label: N("/platform/audit"), icon: ScrollText, show: true },
    { href: "/account", label: N("/account"), icon: KeyRound, show: true },
  ];

  const tenantNav = [
    { href: "/", label: N("/"), icon: LayoutGrid, show: true },
    { href: "/students", label: N("/students"), icon: GraduationCap, show: true },
    { href: "/guardians", label: N("/guardians"), icon: Users, show: p.viewGuardians },
    { href: "/import", label: N("/import"), icon: FileSpreadsheet, show: p.importStudents },
    { href: "/fees", label: N("/fees"), icon: Receipt, show: p.financeRead },
    { href: "/invoices", label: N("/invoices"), icon: FileText, show: p.financeRead },
    { href: "/payments", label: N("/payments"), icon: Banknote, show: p.financeRead },
    { href: "/approvals", label: N("/approvals"), icon: CheckSquare, show: p.financeRead },
    { href: "/sponsors", label: N("/sponsors"), icon: HandHeart, show: p.financeRead },
    { href: "/payment-plans", label: N("/payment-plans"), icon: CalendarClock, show: p.financeRead },
    { href: "/reconciliation", label: N("/reconciliation"), icon: GitMerge, show: p.financeRead },
    { href: "/notifications", label: N("/notifications"), icon: MessageSquare, show: p.financeRead },
    { href: "/curriculum", label: N("/curriculum"), icon: Library, show: p.academicRead },
    { href: "/assessments", label: N("/assessments"), icon: ClipboardCheck, show: p.academicRead },
    { href: "/attendance", label: N("/attendance"), icon: CalendarCheck, show: p.academicRead },
    { href: "/report-cards", label: N("/report-cards"), icon: FileBadge, show: p.academicRead },
    { href: "/reports", label: N("/reports"), icon: BarChart3, show: p.reports },
    { href: "/messaging", label: N("/messaging"), icon: RadioTower, show: p.integrations },
    { href: "/integrations", label: N("/integrations"), icon: Plug, show: p.integrations },
    { href: "/jobs", label: N("/jobs"), icon: Activity, show: p.financeJobs },
    { href: "/academics", label: N("/academics"), icon: BookOpen, show: p.manageSchool },
    { href: "/staff", label: N("/staff"), icon: UserCog, show: p.manageSchool },
    { href: "/audit", label: N("/audit"), icon: ClipboardList, show: p.viewAudit },
    { href: "/settings", label: N("/settings"), icon: Settings, show: p.manageSchool },
    { href: "/subscription", label: N("/subscription"), icon: ShieldCheck, show: user.role === "school_admin" && !tenantAccess },
    { href: "/account", label: N("/account"), icon: KeyRound, show: true },
  ];
  const nav = (platformMode ? platformNav : tenantNav).filter((n) => n.show);

  const groups = platformMode ? [
    { label: "Platform", paths: ["/", "/schools", "/platform/subscriptions", "/platform/audit", "/platform/settings"] },
    { label: "Account", paths: ["/account"] },
  ].map(group => ({ label: group.label, items: group.paths.flatMap(path => nav.filter(item => item.href === path)) })) : [
    { label: "School", paths: ["/", "/students", "/guardians", "/import"] },
    { label: "Finance", paths: ["/fees", "/invoices", "/payments", "/reconciliation", "/payment-plans", "/sponsors", "/approvals"] },
    { label: "Academics", paths: ["/academics", "/curriculum", "/assessments", "/attendance", "/report-cards"] },
    { label: "Communication & reports", paths: ["/notifications", "/reports"] },
    { label: "Administration", paths: ["/staff", "/settings", "/subscription", "/messaging", "/integrations", "/jobs", "/audit", "/account"] },
  ].map(group => ({
    label: group.label,
    items: group.paths.flatMap(path => nav.filter(item => item.href === path)),
  })).filter(group => group.items.length > 0);

  const dockPriority = platformMode ? ["/", "/schools", "/platform/subscriptions", "/account"] : ["/", "/students", "/payments", "/attendance", "/fees", "/assessments", "/reports", "/account"];
  const dock = dockPriority.flatMap(path => nav.filter(item => item.href === path)).slice(0, 4);

  const parentOf = (path: string) => (/^\/students\/[^/]+/.test(path) ? "/students" : /^\/schools\/[^/]+/.test(path) ? "/schools" : "/");
  const goBack = () => {
    if (stack.current.length > 1) window.history.back();
    else { const parent = parentOf(loc); stack.current = [parent]; navigate(parent, { replace: true }); }
  };
  const fallbackTitle = (loc !== "/" ? pageName(loc, platformMode) : undefined)
    ?? (loc.startsWith("/students/") ? "Student" : loc.startsWith("/schools/") ? "School" : "Not found");
  const registered = useRegisteredTitle(loc);
  const pageTitle = registered ?? fallbackTitle;
  const isHome = loc === "/";
  useEffect(() => { document.title = `${isHome ? N("/") : pageTitle} · Rejista`; });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? "1" : "0"); } catch { /* storage unavailable */ } return n; });

  const active = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));

  const side = (compact: boolean) => (
    <div className="flex h-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground">
      <div className={cn("border-b border-sidebar-border pb-5 pt-6", compact ? "px-3" : "px-5")}>
        <div className={cn("flex items-center gap-2", compact ? "flex-col" : "justify-between")}>
          <Link href="/" onClick={() => setOpen(false)} aria-label="Rejista home" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">R</div>
            {!compact && <span className="font-display text-lg font-semibold tracking-tight text-sidebar-accent-foreground">Rejista</span>}
          </Link>
          <Tooltip><TooltipTrigger asChild>
            <button type="button" onClick={toggleCollapsed} aria-expanded={!compact} aria-controls="desktop-sidebar" aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} data-testid="button-toggle-sidebar"
              className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary">
              {compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </TooltipTrigger><TooltipContent side="right">{compact ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent></Tooltip>
        </div>
        <div className={cn(compact && "hidden", "mt-4 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5")}>
          {platformMode || !school ? (<>
            <div data-testid="text-school-name" className="truncate text-sm font-semibold text-sidebar-accent-foreground">Platform console</div>
            <div className="font-mono text-[11px] text-sidebar-foreground/60">All schools · no tenant</div>
          </>) : (<>
            <div data-testid="text-school-name" className="truncate text-sm font-semibold text-sidebar-accent-foreground">{school.name}</div>
            <div className="font-mono text-[11px] text-sidebar-foreground/60">{school.code}{school.county ? ` · ${school.county}` : ""}</div>
            {tenantAccess && <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary"><Eye className="h-3 w-3" />{tenantAccess.writeEnabled ? "Support · write" : "Support · read-only"}</div>}
          </>)}
        </div>
      </div>
      <nav aria-label="Main navigation" className={cn("min-h-0 flex-1 overflow-y-auto py-4", compact ? "space-y-3 px-2" : "space-y-5 px-3", " [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
        {groups.map(group => (
          <section key={group.label} aria-label={group.label}>
            <h2 className={compact ? "sr-only" : "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60"}>{group.label}</h2>
            {compact && <div aria-hidden className="mx-2 mb-2 border-t border-sidebar-border" />}
            <div className="space-y-0.5">
              {group.items.map(n => {
                const link = (
                <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} aria-label={compact ? n.label : undefined} onClick={() => setOpen(false)} data-testid={`link-nav-${n.href.slice(1).replace(/\//g, "-") || "home"}`}
                  className={cn("group relative flex items-center gap-3 rounded-md py-2.5 text-sm transition md:py-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary", compact ? "justify-center px-0" : "px-3",
                    active(n.href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground")}>
                  <span className={cn("absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-primary transition-transform", active(n.href) ? "scale-y-100" : "scale-y-0")} />
                  <n.icon className={cn("h-4 w-4 shrink-0", active(n.href) && "text-sidebar-primary")} />
                  {!compact && n.label}
                </Link>
                );
                return compact ? <Tooltip key={n.href}><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{n.label}</TooltipContent></Tooltip> : link;
              })}
            </div>
          </section>
        ))}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="button-account-menu" aria-label={`Account menu for ${user.name}`} className={cn("flex w-full items-center gap-3 rounded-md p-2 text-left", compact && "justify-center", "outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-primary")}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(user.name)}</span>
              <span className={cn("min-w-0 flex-1", compact && "hidden")}>
                <span data-testid="text-user-name" className="block truncate text-sm font-semibold text-sidebar-accent-foreground">{user.name}</span>
                <span className="block text-[11px] text-sidebar-foreground/60">{ROLE_LABEL[user.role]}</span>
              </span>
              {!compact && <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className={cn("z-[60]", compact ? "w-56" : "w-[var(--radix-dropdown-menu-trigger-width)]")}>
            <DropdownMenuItem asChild>
              <Link href="/account" data-testid="link-account-menu" onClick={() => setOpen(false)}><KeyRound className="h-4 w-4" />My account</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="button-logout" disabled={logout.isPending} onSelect={() => logout.mutate()}>
              <LogOut className="h-4 w-4" />{logout.isPending ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {logout.isError && <div role="alert" className="px-2 pt-2 text-xs text-red-300">Sign-out failed. Please retry.</div>}
      </div>
    </div>
  );

  return (
    <div className={cn("app-shell min-h-[100dvh] bg-background transition-[padding] duration-200", collapsed ? "md:pl-16" : "md:pl-64")}>
      <aside id="desktop-sidebar" aria-label="Sidebar" className={cn("fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 md:block", collapsed ? "w-16" : "w-64")}>{side(collapsed)}</aside>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-sidebar-border bg-sidebar px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-sidebar-foreground md:hidden">
{isHome ? (
                    <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">R</span>
            <span className="min-w-0">
              <span className="block font-display text-base font-semibold leading-tight text-sidebar-accent-foreground">Rejista</span>
              <span className="block truncate text-[11px] text-sidebar-foreground/60">{platformMode || !school ? "Platform console" : school.name}</span>
            </span>
          </Link>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <button type="button" onClick={goBack} aria-label="Back" data-testid="button-header-back" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent"><ChevronLeft className="h-6 w-6" /></button>
              <h1 data-testid="text-mobile-title" title={pageTitle} className="line-clamp-2 min-w-0 flex-1 break-words font-display text-[1.05rem] font-semibold leading-tight text-sidebar-accent-foreground">{pageTitle}</h1>
            </div>
          )}
          <Dialog.Trigger asChild><button data-testid="button-menu" aria-label="Open all sections" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent"><Menu className="h-5 w-5" /></button></Dialog.Trigger>
        </header>
        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${dock.length + 1}, minmax(0, 1fr))` }}>
            {dock.map(n => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} data-testid={`link-dock-${n.href.slice(1).replace(/\//g, "-") || "home"}`}
                className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active(n.href) ? "text-sidebar-primary" : "text-sidebar-foreground/70")}>
                <span className={cn("absolute top-0 h-[3px] w-8 rounded-b bg-sidebar-primary transition-transform", active(n.href) ? "scale-x-100" : "scale-x-0")} />
                <n.icon className="h-5 w-5" />
                <span className="max-w-full px-1 text-center leading-tight [overflow-wrap:anywhere]">{n.label}</span>
              </Link>
            ))}
            <Dialog.Trigger asChild>
              <button type="button" data-testid="button-dock-more" className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-sidebar-foreground/70">
                <Menu className="h-5 w-5" /><span>More</span>
              </button>
            </Dialog.Trigger>
          </div>
        </nav>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <Dialog.Content aria-describedby={undefined} data-testid="sheet-more"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl bg-sidebar text-sidebar-foreground outline-none md:hidden">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-sidebar-foreground/25" />
            <div className="flex shrink-0 items-center gap-3 border-b border-sidebar-border px-4 pb-3 pt-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">R</span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate font-display text-base font-semibold text-sidebar-accent-foreground">{platformMode || !school ? "Platform console" : school.name}</Dialog.Title>
                <div className="truncate font-mono text-[11px] text-sidebar-foreground/60">{platformMode || !school ? "All schools · no tenant" : `${school.code}${school.county ? ` · ${school.county}` : ""}`}{tenantAccess ? (tenantAccess.writeEnabled ? " · Support write" : " · Support read-only") : ""}</div>
              </div>
              <Dialog.Close aria-label="Close menu" data-testid="button-close-more" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-foreground"><X className="h-5 w-5" /></Dialog.Close>
            </div>
            <nav aria-label="All sections" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {groups.map(group => (
                <section key={group.label} aria-label={group.label}>
                  <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">{group.label}</h2>
                  <div className="grid grid-cols-3 gap-2">
                    {group.items.map(n => (
                      <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} onClick={() => setOpen(false)} data-testid={`link-more-${n.href.slice(1).replace(/\//g, "-") || "home"}`}
                        className={cn("flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-center text-[11.5px] font-medium leading-tight transition active:scale-95",
                          active(n.href) ? "border-sidebar-primary/60 bg-sidebar-primary/10 text-sidebar-accent-foreground" : "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/85")}>
                        <n.icon className={cn("h-5 w-5", active(n.href) ? "text-sidebar-primary" : "text-sidebar-foreground/70")} />
                        <span className="line-clamp-2">{n.label}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </nav>
            <div className="shrink-0 border-t border-sidebar-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(user.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-sidebar-accent-foreground">{user.name}</div>
                  <div className="text-[11px] text-sidebar-foreground/60">{ROLE_LABEL[user.role]}</div>
                </div>
                <Link href="/account" onClick={() => setOpen(false)} data-testid="link-more-account-menu" aria-label="My account" className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-accent"><KeyRound className="h-4 w-4" /></Link>
                <button type="button" data-testid="button-logout-mobile" disabled={logout.isPending} onClick={() => logout.mutate()} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-sidebar-accent px-4 text-sm font-semibold text-sidebar-accent-foreground disabled:opacity-50">
                  <LogOut className="h-4 w-4" />{logout.isPending ? "Signing out" : "Sign out"}
                </button>
              </div>
              {logout.isError && <div role="alert" className="pt-2 text-xs text-red-300">Sign-out failed. Please retry.</div>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <TenantAccessBanner />
      <main data-readonly={ro ? "true" : undefined} className="app-main w-full min-w-0 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 md:px-6 md:py-8 lg:px-8"
        onSubmitCapture={ro ? (e) => {
          // Read-only support session: block every form save before it reaches the API (which also refuses).
          // Forms explicitly marked data-readonly-safe run server-allowlisted read-only POSTs (report runs).
          if (e.target instanceof HTMLFormElement && e.target.hasAttribute("data-readonly-safe")) return;
          e.preventDefault(); e.stopPropagation();
          toast({ title: "Read-only support session", description: "Saving is disabled. Exit and re-enter with write access if the school asked for a change." });
        } : undefined}>{children}</main>
    </div>
  );
}
