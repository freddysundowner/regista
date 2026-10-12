import { PgBoss } from "pg-boss";
// Creates the pg-boss schema, queues and schedules. Safe to re-run: existing queues and schedules are kept.
// Development runs it after merges; production only through the deploy script, which passes --production.
const production = process.argv.includes("--production");
if (!production && (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1")) {
  throw new Error("Development job schema installer. In production run it from deploy/install.sh (pnpm run jobs:install).");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
await boss.start();
await boss.createQueue("finance-nightly", { retryLimit: 3, retryDelay: 60, retryBackoff: true });
await boss.createQueue("finance-receipts", { retryLimit: 5, retryDelay: 30, retryBackoff: true });
await boss.schedule("finance-nightly", "0 2 * * *", {}, { tz: "Africa/Nairobi" });
await boss.schedule("finance-receipts", "* * * * *", {}, { tz: "Africa/Nairobi" });
for (const [name, cron] of [
  ["payment-pipeline", "* * * * *"], ["message-delivery", "* * * * *"],
  ["payment-followup", "* * * * *"], ["notification-outbox", "* * * * *"],
  ["school-daily", "0 6 * * *"], ["daily-reconciliation", "0 2 * * *"],
  ["database-backup", "0 3 * * *"],
]) {
  await boss.createQueue(name, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
  await boss.schedule(name, cron, {}, { tz: "Africa/Nairobi" });
}
await boss.stop();