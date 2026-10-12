/** Canonical page names, shared by sidebar, mobile dock/menu, header and document title. */
export const PLATFORM_PAGE_NAMES: Record<string, string> = {
  "/": "Platform overview",
  "/schools": "Schools",
  "/platform/subscriptions": "Subscriptions",
  "/platform/support": "Support",
  "/platform/knowledge": "Knowledge base",
  "/platform/settings": "Settings",
  "/platform/settings/whatsapp": "WhatsApp configuration",
  "/platform/emails": "Emails",
  "/platform/audit": "Platform audit",
  "/account": "My account",
};
export const TENANT_PAGE_NAMES: Record<string, string> = {
  "/settings/messaging/whatsapp": "WhatsApp number",
  "/": "Home", "/students": "Learners", "/guardians": "Guardians & families", "/import": "Import register",
  "/fees": "Fees", "/finances": "Finance Book", "/expenses": "Expenses", "/purchases": "LPOs", "/supplier-invoices": "Supplier invoices", "/suppliers": "Suppliers", "/store": "Store", "/store/movements": "Stock in & out", "/library": "Library", "/library/loans": "Borrowed books", "/balances": "Who owes", "/invoices": "Invoices", "/payments": "Payments", "/approvals": "Approvals", "/sponsors": "Sponsors",
  "/payment-plans": "Payment plans", "/reconciliation": "Unmatched payments", "/notifications": "Messages",
  "/curriculum": "Curriculum", "/assessments": "Assessments", "/attendance": "Attendance", "/report-cards": "Report cards",
  "/reports": "Reports", "/messaging": "Messaging routing", "/integrations": "Integrations", "/settings/mpesa": "M-Pesa", "/settings/bank": "Bank", "/jobs": "Finance jobs",
  "/academics": "Academics", "/staff": "Staff", "/audit": "Audit history", "/settings": "School profile", "/settings/messaging": "Messaging", "/settings/email": "Email", "/emails": "Emails",
  "/support": "Support", "/subscription": "Subscription", "/licence": "Licence", "/term-setup": "Terms", "/classes": "Classes", "/subjects": "Subjects", "/teacher-assignments": "Teacher assignments", "/fee-structure": "Fee setup", "/fee-structure/templates": "Fee structure", "/account": "My account",
};
export function pageName(path: string, platform: boolean) {
  return (platform ? PLATFORM_PAGE_NAMES : TENANT_PAGE_NAMES)[path];
}
