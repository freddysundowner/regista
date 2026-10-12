import { db } from "@workspace/db";
import { logger } from "./logger";
import { queueMessage } from "./integrations/messages";
import { financeSummary } from "./finance/books";

/**
 * A short "how is the school doing" message to each school administrator's phone: weekly by default, on Monday
 * morning, or monthly on the 1st. It goes by SMS, or by WhatsApp when the school has an approved WhatsApp template
 * for it. The school chooses how often, or turns it off, in its settings.
 */
export type DigestSettings = { statusDigest?: "off" | "weekly" | "monthly"; statusDigestChannel?: "sms" | "whatsapp"; messageTemplates?: Record<string, unknown> };
const nairobi = (now: Date) => new Date(now.getTime() + 3 * 3600_000);
const kes = (amount: string) => `KES ${Math.round(Number(amount)).toLocaleString("en-KE")}`;

/** The period this run belongs to ("2026-W41" or "2026-10"), or null when today is not a sending day. */
export function digestPeriod(frequency: string | undefined, now = new Date()) {
  const day = nairobi(now);
  if (frequency === "monthly") return day.getUTCDate() === 1 ? day.toISOString().slice(0, 7) : null;
  if (frequency === "off") return null;
  if (day.getUTCDay() !== 1) return null;
  // ISO week number, so each Monday gets a key of its own.
  const thursday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 3));
  const week = Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The message itself: what came in, what is owed, and what is waiting for someone. Kept to a couple of SMS parts. */
export async function digestText(school: { id: string; name: string }, frequency: "weekly" | "monthly", now = new Date()) {
  const since = new Date(now.getTime() - (frequency === "monthly" ? 30 : 7) * 86_400_000);
  const [summary, payments, unmatched, approvals, learners] = await Promise.all([
    financeSummary(school.id),
    db.financeRecord.aggregate({ where: { schoolId: school.id, kind: "payment", status: "posted", createdAt: { gte: since } }, _sum: { amount: true }, _count: true }),
    db.matchException.count({ where: { schoolId: school.id, status: "open" } }),
    db.financeRecord.count({ where: { schoolId: school.id, status: "pending" } }),
    db.student.count({ where: { schoolId: school.id, status: "active" } }),
  ]);
  const span = frequency === "monthly" ? "the last 30 days" : "the last 7 days";
  const parts = [
    `Rejista update for ${school.name}: ${learners.toLocaleString("en-KE")} active learner${learners === 1 ? "" : "s"}.`,
    `Fees received in ${span}: ${kes(String(payments._sum.amount ?? 0))} from ${payments._count} payment${payments._count === 1 ? "" : "s"}.`,
    summary.termName && Number(summary.expected.billed) > 0 ? `${summary.termName}: ${summary.expected.percentPaid}% of fees paid.` : "",
    Number(summary.owed.total) > 0 ? `Still owed: ${kes(summary.owed.total)} by ${summary.owed.learners} learner${summary.owed.learners === 1 ? "" : "s"}.` : "No fee balances outstanding.",
    unmatched ? `${unmatched} payment${unmatched === 1 ? " needs" : "s need"} a learner.` : "",
    approvals ? `${approvals} request${approvals === 1 ? "" : "s"} waiting for approval.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Queues today's digests. Safe to run more than once a day: each administrator gets one per period. */
export async function queueStatusDigests(now = new Date()) {
  for (const school of await db.school.findMany({ where: { status: "active" } })) {
    try {
      const settings = (school.settings ?? {}) as DigestSettings;
      const frequency = settings.statusDigest ?? "weekly";
      const period = digestPeriod(frequency, now);
      if (!period || frequency === "off") continue;
      const admins = await db.user.findMany({ where: { schoolId: school.id, role: "school_admin", isActive: true, phone: { not: null } }, select: { id: true, phone: true } });
      if (!admins.length) continue;
      // WhatsApp only goes out through an approved template; without one for this message, SMS is used.
      const channel = settings.statusDigestChannel === "whatsapp" && settings.messageTemplates?.school_digest ? "whatsapp" : "sms";
      const content = await digestText(school, frequency, now);
      for (const admin of admins) {
        await queueMessage(db, school.id, { phone: admin.phone!, channel, template: "school_digest", content, idempotencyKey: `digest:${period}:${admin.id}` });
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, schoolId: school.id }, "Status digest could not be prepared");
    }
  }
}
