import { spawnSync } from "node:child_process";
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Finance acceptance tests are development-only");
const result = spawnSync("pnpm", ["--filter", "@workspace/api-server", "exec", "tsx", "--test", "src/lib/finance.test.ts"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);