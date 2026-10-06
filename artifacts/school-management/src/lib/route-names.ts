/** Canonical page names, shared by sidebar, mobile dock/menu, header and document title. */
export const PLATFORM_PAGE_NAMES: Record<string, string> = {
  "/": "Platform overview",
  "/schools": "Schools",
  "/platform/subscriptions": "Subscriptions",
  "/platform/settings": "Settings",
  "/platform/settings/whatsapp": "WhatsApp configuration",
  "/platform/emails": "Emails",
  "/platform/audit": "Platform audit",
  "/account": "My account",
};
export const TENANT_PAGE_NAMES: Record<string, string> = {
  "/settings/whatsapp": "WhatsApp configuration",
  "/": "Overview", "/students": "Students", "/guardians": "Guardians & families", "/import": "Import register",
  "/fees": "Fees", "/invoices": "Invoices", "/payments": "Payments", "/approvals": "Approvals", "/sponsors": "Sponsors",
  "/payment-plans": "Payment plans", "/reconciliation": "Reconciliation", "/notifications": "Messages",
  "/curriculum": "Curriculum", "/assessments": "Assessments", "/attendance": "Attendance", "/report-cards": "Report cards",
  "/reports": "Reports", "/messaging": "Messaging routing", "/integrations": "Integrations", "/jobs": "Finance jobs",
  "/academics": "Academics", "/staff": "Staff", "/audit": "Audit history", "/settings": "Settings", "/emails": "Emails",
  "/subscription": "Subscriptions", "/account": "My account",
};
export function pageName(path: string, platform: boolean) {
  return (platform ? PLATFORM_PAGE_NAMES : TENANT_PAGE_NAMES)[path];
}
