import { db } from "@workspace/db";
import { verifyLedger } from "./src/jobs/finance";
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development verification runner only");
try {
  const schools = await db.school.findMany({ select: { id: true } });
  let mismatches = 0;
  for (const school of schools) mismatches += (await verifyLedger(school.id)).length;
  console.info(`Ledger verification: ${schools.length} schools checked, ${mismatches} mismatches`);
  if (mismatches) process.exitCode = 1;
} finally { await db.$disconnect(); }