import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Building2 , CalendarClock, GitMerge, MessageSquare, Library, ClipboardCheck, CalendarCheck, FileBadge, BarChart3, Plug } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { Activity, Banknote, BookOpen, CheckSquare, ClipboardList, FileText, HandHeart, Receipt, FileSpreadsheet, GraduationCap, LayoutGrid, KeyRound, LogOut, Settings, Users, UserCog } from "lucide-react";
import { useSession, usePerms, ROLE_LABEL } from "@/lib/session";

export function Shell({ children }: { children: ReactNode }) {
  const { user, school } = useSession();
  const p = usePerms();
  const [loc, navigate] = useLocation();
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

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="font-display text-lg font-semibold">Rejista</Link>
        <div className="min-w-0 flex-1">
          <div data-testid="text-school-name" className="truncate text-sm font-semibold">{school.name}</div>
          <div className="text-[11px] text-muted-foreground">{school.code}</div>
        </div>
        <nav aria-label="Main navigation" className="order-last w-full sm:order-none sm:w-auto">
          <select aria-label="Navigate to page" data-testid="select-navigation" value={nav.find(n => active(n.href))?.href ?? ""} onChange={e => navigate(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm sm:w-56">
            <option value="" disabled>Navigate to page</option>
            {groups.map(group => <optgroup key={group.label} label={group.label}>
              {group.items.map(n => <option key={n.href} value={n.href}>{n.label}</option>)}
            </optgroup>)}
          </select>
        </nav>
        <Link href="/account" className="hidden min-w-0 max-w-48 sm:block">
          <div data-testid="text-user-name" className="truncate text-sm font-semibold">{user.name}</div>
          <div className="text-[11px] text-muted-foreground">{ROLE_LABEL[user.role]}</div>
        </Link>
        <button data-testid="button-logout" title="Sign out" aria-label="Sign out" disabled={logout.isPending} onClick={() => logout.mutate()} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-50">
          <LogOut className="h-4 w-4" />
        </button>
        {logout.isError && <div role="alert" className="w-full text-xs text-destructive">Sign-out failed. Please retry.</div>}
      </header>
      <main className="w-full min-w-0 px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
