import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_INITIAL } from "@/lib/brand";
import { PageTitleProvider, useRegisteredTitle } from "@/lib/page-title";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation } from "wouter";
import { ShieldCheck, Building2 , ScrollText, LayoutDashboard, Eye, CalendarClock, GitMerge, MessageSquare, Library, ClipboardCheck, CalendarCheck, FileBadge, BarChart3, Plug, Mail } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout, useGetSchool, getGetSchoolQueryKey, useGetFinanceOverview, getGetFinanceOverviewQueryKey, useGetPlatformSupportUnread, getGetPlatformSupportUnreadQueryKey } from "@workspace/api-client-react";
import { Activity, Banknote, BookOpen, CheckSquare, ClipboardList, FileText, HandHeart, Receipt, FileSpreadsheet, GraduationCap, LayoutGrid, KeyRound, LogOut, Menu, X, Settings, Users, UserCog } from "lucide-react";
import { useAuthSession, useReadOnly, usePerms, ROLE_LABEL, initials } from "@/lib/session";
import { TenantAccessBanner, hardReset } from "@/components/platform-kit";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, ChevronLeft, Headset, PanelLeftClose, PanelLeftOpen, Wallet, Wand2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pageName } from "@/lib/route-names";

const COLLAPSE_KEY = "rejista.sidebar.collapsed";
function readCollapsed() { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } }
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useInstallation } from "@/lib/installation";
import { SectionTabs } from "@/components/section-tabs";
import { StaffChatWidget, HelpButton } from "@/components/support-chat";
import { TermLine } from "@/components/home-panels";
import { InstallPrompt } from "@/components/install-prompt";
import { visibleSections, sectionFor, SECTION_GROUPS } from "@/lib/sections";

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
  const install = useInstallation();
  // Questions waiting for a person, shown as a count beside Support in the platform menu.
  const deskUnread = useGetPlatformSupportUnread({ query: { queryKey: getGetPlatformSupportUnreadQueryKey(), enabled: platformMode, refetchInterval: 30_000 } });
  const badgeFor = (href: string) => href === "/platform/support" ? deskUnread.data?.count ?? 0 : 0;
  const platformNav = [
    { href: "/", label: N("/"), icon: LayoutDashboard, show: true },
    { href: "/schools", label: N("/schools"), icon: Building2, show: true },
    { href: "/platform/subscriptions", label: N("/platform/subscriptions"), icon: Wallet, show: install.hosted },
    { href: "/licence", label: N("/licence"), icon: ShieldCheck, show: install.licensed },
    { href: "/platform/support", label: N("/platform/support"), icon: Headset, show: true },
    { href: "/platform/knowledge", label: N("/platform/knowledge"), icon: BookOpen, show: true },
    { href: "/platform/emails", label: N("/platform/emails"), icon: Mail, show: true },
    { href: "/platform/settings", label: N("/platform/settings"), icon: Settings, show: true },
    { href: "/platform/audit", label: N("/platform/audit"), icon: ScrollText, show: true },
    { href: "/account", label: N("/account"), icon: KeyRound, show: true },
  ];

  const schoolQ = useGetSchool({ query: { queryKey: getGetSchoolQueryKey(), enabled: !platformMode } });
  const finance = useGetFinanceOverview({ query: { queryKey: getGetFinanceOverviewQueryKey(), enabled: !platformMode && p.financeRead } });
  const approvals = schoolQ.data?.settings?.requireSecondApproval !== false || (finance.data?.pendingApprovals ?? 0) > 0;
  const sections = visibleSections({ perms: p as unknown as Record<string, boolean>, isAdmin: user.role === "school_admin", supportSession: !!tenantAccess, hosted: install.hosted, licensed: install.licensed, approvals });
  const tenantNav = sections.map((sec) => ({ href: sec.tabs[0].href, label: sec.label, icon: sec.icon, group: sec.group, show: true }));
  const currentSection = platformMode ? null : sectionFor(sections, loc);
  const nav = (platformMode ? platformNav : tenantNav).filter((n) => n.show);

  const groups = platformMode ? [
    { label: "Platform", paths: ["/", "/schools", "/platform/subscriptions", "/licence", "/platform/support", "/platform/knowledge", "/platform/emails", "/platform/audit", "/platform/settings"] },
    { label: "Account", paths: ["/account"] },
  ].map(group => ({ label: group.label, items: group.paths.flatMap(path => nav.filter(item => item.href === path)) })) : SECTION_GROUPS.map((g) => ({ label: g.label, items: tenantNav.filter((n) => n.group === g.id) })).filter((g) => g.items.length);

  // Phone bar: Home, Learners and the two money pages first, then whatever else this person has.
  const dockPriority = platformMode ? ["/", "/schools", "/platform/subscriptions", "/account"] : [...new Set(["/", "/students", "/invoices", "/payments", ...nav.map((n) => n.href)])];
  const dock = dockPriority.flatMap(path => nav.filter(item => item.href === path)).slice(0, 4);

  // The phone's top-left button goes "up", not through everything visited. A page with a name of its own (any tab
  // or menu page: Learners, Payments, Fees...) closes straight to Home, however many pages were opened on the way.
  // A page inside one of those (a learner, a class, a member of staff) goes back to the list it belongs to.
  const named = (path: string) => !!pageName(path, platformMode);
  const topLevel = named(loc);
  const parentOf = (path: string) => { let up = path.replace(/\/[^/]*$/, ""); while (up && !named(up)) up = up.replace(/\/[^/]*$/, ""); return up || "/"; };
  const goBack = () => {
    const target = topLevel ? "/" : parentOf(loc);
    const st = stack.current;
    // When the page we want is the one we just came from, step back to it so the browser's own history stays short.
    if (st.length > 1 && st[st.length - 2] === target) window.history.back();
    else { stack.current = [target]; navigate(target, { replace: true }); }
  };
  const fallbackTitle = (loc !== "/" ? pageName(loc, platformMode) : undefined)
    ?? (loc.startsWith("/students/") ? "Student" : loc.startsWith("/classes/") ? "Class" : loc.startsWith("/staff/") ? "Staff member" : loc.startsWith("/schools/") ? "School" : "Not found");
  const registered = useRegisteredTitle(loc);
  const pageTitle = registered ?? fallbackTitle;
  const isHome = loc === "/";
  useEffect(() => { document.title = `${isHome ? N("/") : pageTitle} · Rejista`; });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? "1" : "0"); } catch { /* storage unavailable */ } return n; });

  const active = (h: string) => platformMode ? (h === "/" ? loc === "/" : loc.startsWith(h)) : currentSection?.tabs[0].href === h;

  const side = (compact: boolean) => (
    <div className="flex h-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground">
      <div className={cn("border-b border-sidebar-border pb-5 pt-6", compact ? "px-3" : "px-5")}>
        <div className={cn("flex items-center gap-2", compact ? "flex-col" : "justify-between")}>
          <Link href="/" onClick={() => setOpen(false)} aria-label="Rejista home" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">{APP_INITIAL}</div>
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
                  {badgeFor(n.href) > 0 && <span data-testid="badge-support-unread" className={cn("flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-[11px] font-semibold text-sidebar-primary-foreground", compact ? "absolute right-1 top-0.5 h-4 min-w-4 px-1 text-[10px]" : "ml-auto")}>{badgeFor(n.href)}</span>}
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
        {/* Phone: the app bar. Home names the school with the current term under it; every other page is a back arrow and its name. Help and the account sit on the right of both. */}
        <header className="sticky top-0 z-20 flex items-center gap-2 bg-background/90 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md md:hidden">
          {isHome ? (
            <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-base font-bold text-primary-foreground">{APP_INITIAL}</span>
              <span className="min-w-0">
                <span data-testid="text-mobile-title" className="block truncate font-display text-[1.05rem] font-semibold leading-tight">{platformMode || !school ? "Platform console" : school.name}</span>
                <span data-testid="text-mobile-subtitle" className="block truncate text-[11px] text-muted-foreground">{platformMode || !school ? "Rejista" : <TermLine fallback="Rejista" />}</span>
              </span>
            </Link>
          ) : (
            <>
              <button type="button" onClick={goBack} aria-label={topLevel ? "Close, back to Home" : "Back"} data-testid="button-header-back" className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-muted">{topLevel ? <X className="h-[22px] w-[22px]" /> : <ChevronLeft className="h-6 w-6" />}</button>
              <h1 data-testid="text-mobile-title" title={pageTitle} className="min-w-0 flex-1 truncate font-display text-[1.15rem] font-semibold leading-tight">{pageTitle}</h1>
            </>
          )}
          <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
            {!platformMode && !tenantAccess && <HelpButton />}
            <Link href="/account" aria-label={`My account, ${user.name}`} data-testid="link-header-account" className="flex h-10 w-10 items-center justify-center rounded-full active:bg-muted">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(user.name)}</span>
            </Link>
          </div>
        </header>
        {/* Phone: the bottom bar is icons on the page's own background, each with its name under it. */}
        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
          <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${dock.length + 1}, minmax(0, 1fr))` }}>
            {dock.map(n => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} aria-label={n.label} data-testid={`link-dock-${n.href.slice(1).replace(/\//g, "-") || "home"}`}
                className={cn("flex h-14 flex-col items-center justify-center gap-0.5 transition active:scale-95", active(n.href) ? "text-primary" : "text-muted-foreground/80")}>
                <n.icon className="h-[22px] w-[22px]" strokeWidth={active(n.href) ? 2.4 : 1.8} />
                <span className={cn("max-w-full truncate px-1 text-[10px] leading-none", active(n.href) ? "font-semibold" : "font-medium")}>{n.label}</span>
              </Link>
            ))}
            <Dialog.Trigger asChild>
              <button type="button" data-testid="button-dock-more" aria-label="More" className={cn("flex h-14 flex-col items-center justify-center gap-0.5 transition active:scale-95", open ? "text-primary" : "text-muted-foreground/80")}>
                <Menu className="h-[22px] w-[22px]" strokeWidth={1.8} />
                <span className="text-[10px] font-medium leading-none">More</span>
              </button>
            </Dialog.Trigger>
          </div>
        </nav>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <Dialog.Content aria-describedby={undefined} data-testid="sheet-more"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl bg-card text-foreground outline-none md:hidden">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-foreground/20" />
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 pb-3 pt-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-base font-bold text-primary-foreground">{APP_INITIAL}</span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate font-display text-base font-semibold text-foreground">{platformMode || !school ? "Platform console" : school.name}</Dialog.Title>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{platformMode || !school ? "All schools · no tenant" : `${school.code}${school.county ? ` · ${school.county}` : ""}`}{tenantAccess ? (tenantAccess.writeEnabled ? " · Support write" : " · Support read-only") : ""}</div>
              </div>
              <Dialog.Close aria-label="Close menu" data-testid="button-close-more" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><X className="h-5 w-5" /></Dialog.Close>
            </div>
            <nav aria-label="All sections" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {groups.map(group => (
                <section key={group.label} aria-label={group.label}>
                  <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</h2>
                  <div className="grid grid-cols-3 gap-2">
                    {group.items.map(n => (
                      <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} onClick={() => setOpen(false)} data-testid={`link-more-${n.href.slice(1).replace(/\//g, "-") || "home"}`}
                        className={cn("flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-center text-[11.5px] font-medium leading-tight transition active:scale-95",
                          active(n.href) ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-muted/50 text-foreground/85")}>
                        <n.icon className={cn("h-5 w-5", active(n.href) ? "text-primary" : "text-muted-foreground")} />
                        <span className="line-clamp-2">{n.label}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </nav>
            <div className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initials(user.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{user.name}</div>
                  <div className="text-[11px] text-muted-foreground">{ROLE_LABEL[user.role]}</div>
                </div>
                <Link href="/account" onClick={() => setOpen(false)} data-testid="link-more-account-menu" aria-label="My account" className="flex h-11 w-11 items-center justify-center rounded-full bg-muted"><KeyRound className="h-4 w-4" /></Link>
                <button type="button" data-testid="button-logout-mobile" disabled={logout.isPending} onClick={() => logout.mutate()} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-muted px-4 text-sm font-semibold text-foreground disabled:opacity-50">
                  <LogOut className="h-4 w-4" />{logout.isPending ? "Signing out" : "Sign out"}
                </button>
              </div>
              {logout.isError && <div role="alert" className="pt-2 text-xs text-red-700">Sign-out failed. Please retry.</div>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <TenantAccessBanner />
      <InstallPrompt />
      <main data-readonly={ro ? "true" : undefined} className="app-main w-full min-w-0 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 md:px-6 md:py-8 lg:px-8"
        onSubmitCapture={ro ? (e) => {
          // Read-only support session: block every form save before it reaches the API (which also refuses).
          // Forms explicitly marked data-readonly-safe run server-allowlisted read-only POSTs (report runs).
          if (e.target instanceof HTMLFormElement && e.target.hasAttribute("data-readonly-safe")) return;
          e.preventDefault(); e.stopPropagation();
          toast({ title: "Read-only support session", description: "Saving is disabled. Exit and re-enter with write access if the school asked for a change." });
        } : undefined}>{!platformMode && <SectionTabs sections={sections} />}{children}</main>
      {/* The helper floats over every school page. The platform owner answers from their own console instead. */}
      {!platformMode && !tenantAccess && <StaffChatWidget />}
    </div>
  );
}
