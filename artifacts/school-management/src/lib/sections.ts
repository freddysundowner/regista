import { Banknote, BarChart3, BookOpenCheck, Library, Package, ReceiptText, BookOpen, CalendarDays, CheckCheck, Receipt, ClipboardCheck, Layers, UserCheck, Users, GraduationCap, CreditCard, LayoutGrid, MessageSquare, Settings, Wallet, type LucideIcon } from "lucide-react";

/** Who is looking: drives which sections, tabs and tools appear. */
export type SectionContext = {
  perms: Record<string, boolean>;
  isAdmin: boolean;
  supportSession: boolean;
  hosted: boolean;
  licensed: boolean;
  /** Approvals has work to show: the school requires a second approval, or older requests are still waiting. */
  approvals: boolean;
};
type Link = { href: string; label: string; show?: (c: SectionContext) => boolean };
export type Section = { id: string; label: string; icon: LucideIcon; group: "daily" | "finance" | "services" | "school" | "admin"; tabs: Link[]; show?: (c: SectionContext) => boolean };

/** The whole school app: daily work first, then the administration that sets it up. Every page belongs to exactly one section. */
export const SECTIONS: Section[] = [
  { id: "home", group: "daily", label: "Home", icon: LayoutGrid, tabs: [{ href: "/", label: "Home" }] },
  {
    id: "learners", group: "daily", label: "Learners", icon: GraduationCap, show: (c) => c.perms.register,
    tabs: [
      { href: "/students", label: "Register" },
      { href: "/guardians", label: "Families", show: (c) => c.perms.viewGuardians },
      { href: "/import", label: "Import", show: (c) => c.perms.importStudents },
    ],
  },
  {
    id: "classwork", group: "daily", label: "Classwork", icon: ClipboardCheck, show: (c) => c.perms.academicRead,
    tabs: [
      { href: "/attendance", label: "Attendance" },
      { href: "/assessments", label: "Marks" },
      { href: "/report-cards", label: "Report cards" },
    ],
  },
  { id: "messages", group: "daily", label: "Messages", icon: MessageSquare, show: (c) => c.perms.financeRead, tabs: [{ href: "/notifications", label: "Messages to parents" }] },
  { id: "reports", group: "daily", label: "Reports", icon: BarChart3, show: (c) => c.perms.reports, tabs: [{ href: "/reports", label: "Reports" }] },
  { id: "finances", group: "finance", label: "Finance Book", icon: BookOpenCheck, show: (c) => c.perms.financeRead, tabs: [{ href: "/finances", label: "Finance Book" }] },
  {
    id: "balances", group: "finance", label: "Fees & balances", icon: Wallet, show: (c) => c.perms.financeRead,
    tabs: [{ href: "/balances", label: "Who owes" }, { href: "/invoices", label: "Invoices" }],
  },
  {
    id: "collections", group: "finance", label: "Payments", icon: Banknote, show: (c) => c.perms.financeRead,
    tabs: [{ href: "/payments", label: "Payments" }],
  },
  {
    id: "expenses", group: "finance", label: "Expenses", icon: ReceiptText, show: (c) => c.perms.financeRead || c.perms.expenses || c.perms.purchasing,
    tabs: [
      { href: "/expenses", label: "Expenses", show: (c) => c.perms.financeRead || c.perms.expenses },
      { href: "/purchases", label: "LPOs", show: (c) => c.perms.purchasing },
      { href: "/supplier-invoices", label: "Supplier invoices", show: (c) => c.perms.purchasing },
      { href: "/suppliers", label: "Suppliers", show: (c) => c.perms.purchasing },
    ],
  },
  {
    id: "fee-setup", group: "finance", label: "Fee setup", icon: Receipt, show: (c) => c.perms.financeConfigure,
    tabs: [
      { href: "/fee-structure", label: "Fees" },
      { href: "/fee-structure/templates", label: "Fee structure" },
    ],
  },
  { id: "approvals", group: "finance", label: "Approvals", icon: CheckCheck, show: (c) => c.perms.financeRead && c.approvals, tabs: [{ href: "/approvals", label: "Approvals" }] },
  {
    id: "store", group: "services", label: "Store", icon: Package, show: (c) => c.perms.store || c.perms.procurement,
    tabs: [{ href: "/store", label: "Stock" }, { href: "/store/movements", label: "Stock in & out" }],
  },
  {
    id: "library", group: "services", label: "Library", icon: Library, show: (c) => c.perms.library,
    tabs: [{ href: "/library", label: "Books" }, { href: "/library/loans", label: "Borrowed books" }],
  },
  { id: "terms", group: "school", label: "Terms", icon: CalendarDays, show: (c) => c.perms.manageSchool, tabs: [{ href: "/term-setup", label: "Terms" }] },
  { id: "classes", group: "school", label: "Classes", icon: Layers, show: (c) => c.perms.manageSchool, tabs: [{ href: "/classes", label: "Classes" }] },
  { id: "subjects", group: "school", label: "Subjects", icon: BookOpen, show: (c) => c.perms.academicRead, tabs: [{ href: "/subjects", label: "Subjects" }] },
  { id: "staff", group: "school", label: "Staff", icon: Users, show: (c) => c.perms.manageSchool, tabs: [{ href: "/staff", label: "Staff" }] },
  { id: "teacher-assignments", group: "school", label: "Teacher assignments", icon: UserCheck, show: (c) => c.perms.manageSchool, tabs: [{ href: "/teacher-assignments", label: "Teacher assignments" }] },
  {
    id: "subscription", group: "admin", label: "Subscription", icon: CreditCard, show: (c) => c.isAdmin && !c.supportSession && (c.hosted || c.licensed),
    tabs: [
      { href: "/subscription", label: "Subscription", show: (c) => c.hosted },
      { href: "/licence", label: "Licence", show: (c) => c.licensed },
    ],
  },
  {
    id: "settings", group: "admin", label: "Settings", icon: Settings,
    tabs: [
      { href: "/settings", label: "School profile", show: (c) => c.perms.manageSchool },
      { href: "/settings/mpesa", label: "M-Pesa", show: (c) => c.perms.integrations },
      { href: "/settings/bank", label: "Bank", show: (c) => c.perms.integrations },
      // SMS and WhatsApp; the WhatsApp number page sits under it at /settings/messaging/whatsapp.
      { href: "/settings/messaging", label: "Messaging", show: (c) => c.perms.manageSchool },
      { href: "/settings/email", label: "Email", show: (c) => c.perms.manageSchool },
      { href: "/audit", label: "Audit log", show: (c) => c.perms.viewAudit },
    ],
  },
];

export const SECTION_GROUPS = [{ id: "daily", label: "Daily work" }, { id: "finance", label: "Finance" }, { id: "services", label: "Store & library" }, { id: "school", label: "School" }, { id: "admin", label: "Administration" }] as const;

export function visibleSections(c: SectionContext) {
  return SECTIONS.filter((s) => !s.show || s.show(c)).map((s) => ({
    ...s,
    tabs: s.tabs.filter((t) => !t.show || t.show(c)),
  })).filter((s) => s.tabs.length > 0);
}

const owns = (href: string, path: string) => href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
/** The section a path belongs to; learner profiles live under Learners, staff profiles under Staff. */
export function sectionFor(sections: ReturnType<typeof visibleSections>, path: string) {
  const p = path.startsWith("/students/") ? "/students" : path;
  // Longest match wins, so /settings/messaging is not mistaken for /settings.
  let best: { section: (typeof sections)[number]; len: number } | null = null;
  for (const s of sections) for (const l of s.tabs) if (owns(l.href, p) && (!best || l.href.length > best.len)) best = { section: s, len: l.href.length };
  return best?.section ?? null;
}
