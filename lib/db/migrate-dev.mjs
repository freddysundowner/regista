import { spawnSync } from "node:child_process";
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("This migration command is development-only. Production schema changes use Publish.");
}
const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);