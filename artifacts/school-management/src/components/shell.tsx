import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageTitleProvider, useRegisteredTitle } from "@/lib/page-title";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation } from "wouter";
import { BadgeCheck, ShieldCheck, Building2 , ScrollText, LayoutDashboard, Eye, CalendarClock, GitMerge, MessageSquare, Library, ClipboardCheck, CalendarCheck, FileBadge, BarChart3, Plug, RadioTower } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { Activity, Banknote, BookOpen, CheckSquare, ClipboardList, FileText, HandHeart, Receipt, FileSpreadsheet, GraduationCap, LayoutGrid, KeyRound, LogOut, Menu, X, Settings, Users, UserCog } from "lucide-react";
import { useAuthSession, useReadOnly, usePerms, ROLE_LABEL, initials } from "@/lib/session";
import { TenantAccessBanner, hardReset } from "@/components/platform-kit";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, ChevronLeft } from "lucide-react";
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

  const platformNav = [
    { href: "/", label: "Platform overview", icon: LayoutDashboard, show: true },
    { href: "/schools", label: "Schools", icon: Building2, show: true },
    { href: "/platform/licence-plans", label: "Licence plans", icon: BadgeCheck, show: true },
    { href: "/platform/messaging", label: "Messaging defaults", icon: RadioTower, show: true },
    { href: "/platform/audit", label: "Platform audit", icon: ScrollText, show: true },
    { href: "/account", label: "My account", icon: KeyRound, show: true },
  ];

  const tenantNav = [
    { href: "/", label: "Overview", icon: LayoutGrid, show: true },
    { href: "/students", label: "Students", icon: GraduationCap, show: true },
    { href: "/guardians", label: "Guardians & families", icon: Users, show: p.viewGuardians },
    { href: "/import", label: "Import register", icon: FileSpreadsheet, show: p.importStudents },
    { href: "/fees", label: "Fees", icon: Receipt, show: p.financeRead },
    { href: "/invoices", label: "Invoices", icon: FileText, show: p.financeRead },
    { href: "/payments", label: "Payments", icon: Banknote, show: p.financeRead },
    { href: "/approvals", label: "Approvals", icon: CheckSquare, show: p.financeRead },
    { href: "/sponsors", label: "Sponsors", icon: HandHeart, show: p.financeRead },
    { href: "/payment-plans", label: "Payment plans", icon: CalendarClock, show: p.financeRead },
    { href: "/reconciliation", label: "Reconciliation", icon: GitMerge, show: p.financeRead },
    { href: "/notifications", label: "Messages", icon: MessageSquare, show: p.financeRead },
    { href: "/curriculum", label: "Curriculum", icon: Library, show: p.academicRead },
    { href: "/assessments", label: "Assessments", icon: ClipboardCheck, show: p.academicRead },
    { href: "/attendance", label: "Attendance", icon: CalendarCheck, show: p.academicRead },
    { href: "/report-cards", label: "Report cards", icon: FileBadge, show: p.academicRead },
    { href: "/reports", label: "Reports", icon: BarChart3, show: p.reports },
    { href: "/messaging", label: "Messaging routing", icon: RadioTower, show: p.integrations },
    { href: "/integrations", label: "Integrations", icon: Plug, show: p.integrations },
    { href: "/jobs", label: "Finance jobs", icon: Activity, show: p.financeJobs },
    { href: "/academics", label: "Academics", icon: BookOpen, show: p.manageSchool },
    { href: "/staff", label: "Staff", icon: UserCog, show: p.manageSchool },
    { href: "/audit", label: "Audit history", icon: ClipboardList, show: p.viewAudit },
    { href: "/settings", label: "School profile", icon: Settings, show: p.manageSchool },
    { href: "/subscription", label: "Subscription", icon: ShieldCheck, show: user.role === "school_admin" && !tenantAccess },
    { href: "/account", label: "My account", icon: KeyRound, show: true },
  ];
  const nav = (platformMode ? platformNav : tenantNav).filter((n) => n.show);

  const groups = platformMode ? [
    { label: "Platform", paths: ["/", "/schools", "/platform/licence-plans", "/platform/messaging", "/platform/audit"] },
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

  const dockPriority = platformMode ? ["/", "/schools", "/platform/audit", "/account"] : ["/", "/students", "/payments", "/attendance", "/fees", "/assessments", "/reports", "/account"];
  const dock = dockPriority.flatMap(path => nav.filter(item => item.href === path)).slice(0, 4);
  const dockLabel: Record<string, string> = { "/": "Home", "/platform/audit": "Audit", "/account": "Account" };

  const parentOf = (path: string) => (/^\/students\/[^/]+/.test(path) ? "/students" : /^\/schools\/[^/]+/.test(path) ? "/schools" : "/");
  const goBack = () => {
    if (stack.current.length > 1) window.history.back();
    else { const parent = parentOf(loc); stack.current = [parent]; navigate(parent, { replace: true }); }
  };
  const fallbackTitle = (loc === "/subscription" ? "Subscription" : loc === "/platform/licence-plans" ? "Licence plans" : loc === "/platform/messaging" ? "Messaging defaults" : loc === "/messaging" ? "Messaging routing" : undefined) ?? nav.find((n) => n.href !== "/" && n.href === loc)?.label
    ?? (loc.startsWith("/students/") ? "Student" : loc.startsWith("/schools/") ? "School" : "Not found");
  const registered = useRegisteredTitle(loc);
  const pageTitle = registered ?? fallbackTitle;
  const isHome = loc === "/";

  const active = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));

  const side = (
    <div className="flex h-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-5 pb-5 pt-6">
        <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">R</div>
          <span className="font-display text-lg font-semibold tracking-tight text-sidebar-accent-foreground">Rejista</span>
        </Link>
        <div className="mt-4 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5">
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
      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map(group => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">{group.label}</h2>
            <div className="space-y-0.5">
              {group.items.map(n => (
                <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} onClick={() => setOpen(false)} data-testid={`link-nav-${n.href.slice(1) || "home"}`}
                  className={cn("group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition md:py-2",
                    active(n.href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground")}>
                  <span className={cn("absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-primary transition-transform", active(n.href) ? "scale-y-100" : "scale-y-0")} />
                  <n.icon className={cn("h-4 w-4 shrink-0", active(n.href) && "text-sidebar-primary")} />
                  {n.label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="button-account-menu" aria-label={`Account menu for ${user.name}`} className="flex w-full items-center gap-3 rounded-md p-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-primary">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(user.name)}</span>
              <span className="min-w-0 flex-1">
                <span data-testid="text-user-name" className="block truncate text-sm font-semibold text-sidebar-accent-foreground">{user.name}</span>
                <span className="block text-[11px] text-sidebar-foreground/60">{ROLE_LABEL[user.role]}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="z-[60] w-[var(--radix-dropdown-menu-trigger-width)]">
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
    <div className="app-shell min-h-[100dvh] bg-background md:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 md:block">{side}</aside>
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
                <span className="max-w-full truncate px-1">{dockLabel[n.href] ?? n.label.split(" ")[0]}</span>
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
