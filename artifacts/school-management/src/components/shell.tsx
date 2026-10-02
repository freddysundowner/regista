import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout, getGetCurrentUserQueryKey, getGetSetupStatusQueryKey } from "@workspace/api-client-react";
import { BookOpen, ClipboardList, FileSpreadsheet, GraduationCap, LayoutGrid, LogOut, Menu, Settings, Users, UserCog, X } from "lucide-react";
import { useSession, usePerms, ROLE_LABEL, initials } from "@/lib/session";
import { cn } from "@/lib/utils";

export function Shell({ children }: { children: ReactNode }) {
  const { user, school } = useSession();
  const p = usePerms();
  const [loc, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const logout = useLogout({ mutation: { onSettled: () => {
    const setup = qc.getQueryData(getGetSetupStatusQueryKey());
    qc.clear();
    if (setup) qc.setQueryData(getGetSetupStatusQueryKey(), setup);
    navigate("/");
    qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
  } } });

  const nav = [
    { href: "/", label: "Overview", icon: LayoutGrid, show: true },
    { href: "/students", label: "Students", icon: GraduationCap, show: true },
    { href: "/guardians", label: "Guardians & families", icon: Users, show: p.viewGuardians },
    { href: "/import", label: "Import register", icon: FileSpreadsheet, show: p.importStudents },
    { href: "/academics", label: "Academics", icon: BookOpen, show: p.manageSchool },
    { href: "/staff", label: "Staff", icon: UserCog, show: p.manageSchool },
    { href: "/audit", label: "Audit history", icon: ClipboardList, show: p.viewAudit },
    { href: "/settings", label: "School profile", icon: Settings, show: p.manageSchool },
    { href: "/schools", label: "Platform schools", icon: Building2, show: p.platform },
  ].filter((n) => n.show);

  const active = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));

  const side = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-5 pb-5 pt-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">R</div>
          <span className="font-display text-lg font-semibold tracking-tight text-sidebar-accent-foreground">Rejista</span>
        </div>
        <div className="mt-4 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5">
          <div data-testid="text-school-name" className="truncate text-sm font-semibold text-sidebar-accent-foreground">{school.name}</div>
          <div className="font-mono text-[11px] text-sidebar-foreground/60">{school.code}{school.county ? ` · ${school.county}` : ""}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)} data-testid={`link-nav-${n.href.slice(1) || "home"}`}
            className={cn("group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
              active(n.href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground")}>
            <span className={cn("absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-primary transition-transform", active(n.href) ? "scale-y-100" : "scale-y-0")} />
            <n.icon className={cn("h-4 w-4", active(n.href) ? "text-sidebar-primary" : "")} />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(user.name)}</div>
        <div className="min-w-0 flex-1">
          <div data-testid="text-user-name" className="truncate text-sm font-semibold text-sidebar-accent-foreground">{user.name}</div>
          <div className="text-[11px] text-sidebar-foreground/60">{ROLE_LABEL[user.role]}</div>
        </div>
        <button data-testid="button-logout" title="Sign out" disabled={logout.isPending} onClick={() => logout.mutate()} className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-background md:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 md:block">{side}</aside>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
        <span className="font-display text-lg font-semibold">Rejista</span>
        <button data-testid="button-menu" onClick={() => setOpen(true)} className="rounded-md p-2 hover:bg-muted"><Menu className="h-5 w-5" /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{side}</div>
          <button onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-full bg-card p-2"><X className="h-4 w-4" /></button>
        </div>
      )}
      <main className="mx-auto max-w-[1240px] px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
