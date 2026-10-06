import { fmtDate, fmtDateTime } from "./datetime";
/** Presentation only: stored audit records are never rewritten. */
export const ACTION_LABELS: Record<string, string> = {
  login: "Signed in", logout: "Signed out", password_changed: "Changed own password",
  "school.provisioned": "School created", "school.updated": "School details updated",
  "school.registration_approved": "School registration approved", "school.registration_rejected": "School registration declined",
  "admin.created": "Administrator added", "admin.updated": "Administrator details updated",
  "admin.password_reset": "Administrator password reset",
  "tenant.entered": "School support session started", "tenant.exited": "School support session ended",
  "billing.invoice_created": "Subscription invoice issued", "billing.invoice_voided": "Subscription invoice voided",
  "billing.payment_recorded": "Subscription payment recorded", "billing.payment_reversed": "Subscription payment reversed",
  "messaging.platform_updated": "Platform messaging default updated", "messaging.school_updated": "School messaging routing updated",
  "licence.plan_created": "Licence plan created", "licence.plan_updated": "Licence plan updated",
  "licence.issued": "Licence granted", "licence.revoked": "Licence revoked",
  "licence.payment_activated": "Licence activated by payment", "licence.payment_revoked": "Licence suspended after payment reversal",
  "licence.renewal_requested": "Licence renewal requested", "licence.renewal_cancelled": "Licence renewal cancelled",
};
const ACTIONS: Record<string, string> = {
  created: "Created", updated: "Updated", deleted: "Removed", approved: "Approved", rejected: "Declined",
  registration_submitted: "Submitted school registration", current_cleared: "Removed current designation",
  privacy_exported: "Exported personal data", privacy_updated: "Updated privacy settings",
  verification_revoked: "Revoked verification", anonymized: "Anonymized personal details",
  promotion_previewed: "Previewed student promotion", promotion_committed: "Completed student promotion",
  graduated: "Graduated", promoted: "Promoted", imported: "Imported", locked: "Locked", unlocked: "Unlocked",
};
export function readable(value: string): string {
  const text = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._-]/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "Not recorded";
}
type Entry = { action: string; entityType?: string; before?: unknown; after?: unknown };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function actionLabel(entry: Entry): string {
  const before = record(entry.before), after = record(entry.after);
  if (entry.action === "admin.updated" && typeof after.isActive === "boolean" && before.isActive !== after.isActive)
    return after.isActive ? "Administrator enabled" : "Administrator disabled";
  if (entry.action === "school.updated" && before.status !== after.status && typeof after.status === "string")
    return `School ${after.status === "active" ? "activated" : readable(after.status).toLowerCase()}`;
  if (ACTION_LABELS[entry.action]) return ACTION_LABELS[entry.action];
  const support = entry.action.startsWith("tenant.");
  const action = support ? entry.action.slice(7) : entry.action;
  const label = ACTIONS[action] ?? readable(action);
  return `${support ? "Support session: " : ""}${label}${entry.entityType && !["login", "logout", "password_changed"].includes(action) ? ` · ${readable(entry.entityType)}` : ""}`;
}
export function subjectLabel(entry: Entry): string | null {
  const data = { ...record(entry.before), ...record(entry.after) };
  for (const key of ["name", "number", "description", "admissionNo", "reference"]) {
    if (typeof data[key] === "string" && data[key]) return data[key] as string;
  }
  const name = [data.firstName, data.middleName, data.lastName].filter(v => typeof v === "string" && v).join(" ");
  return name || null;
}
const hidden = { test: (key: string) => key === "id" || /Ids?$/.test(key) || /^(createdAt|updatedAt|sessionVersion)$|password|token|secret|credential|hash/i.test(key) };
function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, v]) => {
    if (hidden.test(key)) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return v && typeof v === "object" && !Array.isArray(v)
      ? Object.entries(flatten(v, path)) : [[path, v]];
  }));
}
export function changeRows(before: unknown, after: unknown) {
  const a = flatten(before), b = flatten(after);
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
    .filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map(key => ({ key, label: key.split(".").map(readable).join(" / "), before: a[key], after: b[key] }));
}
export function displayValue(value: unknown, key = ""): string {
  if (value === undefined || value === null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(v => displayValue(v)).join("; ") : "None";
  if (typeof value === "object") return Object.entries(record(value)).filter(([k]) => !hidden.test(k)).map(([k, v]) => `${readable(k)}: ${displayValue(v, k)}`).join(", ") || "No descriptive details";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(text) && Number.isFinite(Date.parse(text))) {
    const calendarField = /(?:Date|On)$|(?:periodStart|periodEnd)$/.test(key);
    return calendarField ? fmtDate(text.slice(0, 10)) : fmtDateTime(text);
  }
  if (/(status|method|role|type)$/i.test(key)) return readable(text);
  return text;
}
