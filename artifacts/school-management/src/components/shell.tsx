import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation } from "wouter";
import { Building2 , CalendarClock, GitMerge, MessageSquare, Library, ClipboardCheck, CalendarCheck, FileBadge, BarChart3, Plug } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { Activity, Banknote, BookOpen, CheckSquare, ClipboardList, FileText, HandHeart, Receipt, FileSpreadsheet, GraduationCap, LayoutGrid, KeyRound, LogOut, Menu, X, Settings, Users, UserCog } from "lucide-react";
import { useSession, usePerms, ROLE_LABEL, initials } from "@/lib/session";
import { cn } from "@/lib/utils";

export function Shell({ children }: { children: ReactNode }) {
  const { user, school } = useSession();
  const p = usePerms();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const logout = useLogout({ mutation: { onSuccess: async () => {
    await qc.cancelQueries();
    qc.clear();
    // Clearing a query cache does not reset mounted observers. A new document
    // also discards in-memory learner drafts when changing staff accounts.
    window.location.replace(import.meta.env.BASE_URL);
  } } });

  const nav = [
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
    { href: "/integrations", label: "Integrations", icon: Plug, show: p.integrations },
    { href: "/jobs", label: "Finance jobs", icon: Activity, show: p.financeJobs },
    { href: "/academics", label: "Academics", icon: BookOpen, show: p.manageSchool },
    { href: "/staff", label: "Staff", icon: UserCog, show: p.manageSchool },
    { href: "/audit", label: "Audit history", icon: ClipboardList, show: p.viewAudit },
    { href: "/settings", label: "School profile", icon: Settings, show: p.manageSchool },
    { href: "/schools", label: "Platform schools", icon: Building2, show: p.platform },
    { href: "/account", label: "My account", icon: KeyRound, show: true },
  ].filter((n) => n.show);

  const groups = [
    { label: "School", paths: ["/", "/students", "/guardians", "/import"] },
    { label: "Finance", paths: ["/fees", "/invoices", "/payments", "/reconciliation", "/payment-plans", "/sponsors", "/approvals"] },
    { label: "Academics", paths: ["/academics", "/curriculum", "/assessments", "/attendance", "/report-cards"] },
    { label: "Communication & reports", paths: ["/notifications", "/reports"] },
    { label: "Administration", paths: ["/staff", "/settings", "/integrations", "/jobs", "/audit", "/schools", "/account"] },
  ].map(group => ({
    label: group.label,
    items: group.paths.flatMap(path => nav.filter(item => item.href === path)),
  })).filter(group => group.items.length > 0);

  const active = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));

  const side = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-5 pb-5 pt-6">
        <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">R</div>
          <span className="font-display text-lg font-semibold tracking-tight text-sidebar-accent-foreground">Rejista</span>
        </Link>
        <div className="mt-4 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5">
          <div data-testid="text-school-name" className="truncate text-sm font-semibold text-sidebar-accent-foreground">{school.name}</div>
          <div className="font-mono text-[11px] text-sidebar-foreground/60">{school.code}{school.county ? ` · ${school.county}` : ""}</div>
        </div>
      </div>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {groups.map(group => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">{group.label}</h2>
            <div className="space-y-0.5">
              {group.items.map(n => (
                <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} onClick={() => setOpen(false)} data-testid={`link-nav-${n.href.slice(1) || "home"}`}
                  className={cn("group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
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
      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(user.name)}</div>
        <div className="min-w-0 flex-1">
          <Link href="/account" onClick={() => setOpen(false)}>
            <div data-testid="text-user-name" className="truncate text-sm font-semibold text-sidebar-accent-foreground">{user.name}</div>
            <div className="text-[11px] text-sidebar-foreground/60">{ROLE_LABEL[user.role]}</div>
          </Link>
          {logout.isError && <div role="alert" className="text-xs text-red-300">Sign-out failed. Please retry.</div>}
        </div>
        <button data-testid="button-logout" title="Sign out" aria-label="Sign out" disabled={logout.isPending} onClick={() => logout.mutate()} className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-background md:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 md:block">{side}</aside>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="font-display text-lg font-semibold">Rejista</Link>
          <Dialog.Trigger asChild><button data-testid="button-menu" aria-label="Open menu" className="rounded-md p-2 hover:bg-muted"><Menu className="h-5 w-5" /></button></Dialog.Trigger>
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/40 md:hidden" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-72 max-w-[90vw] outline-none md:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            {side}
            <Dialog.Close aria-label="Close menu" className="absolute right-3 top-3 rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"><X className="h-4 w-4" /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <main className="w-full min-w-0 px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
