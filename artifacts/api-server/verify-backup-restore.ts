import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { postgresEnvironment } from "./src/lib/backups";
import { storedObject } from "./src/lib/school-files";

const source = process.env.DATABASE_URL, destination = process.env.RESTORE_TEST_DATABASE_URL, manifestKey = process.env.BACKUP_MANIFEST_KEY;
if (!source || !destination || !manifestKey || process.env.RESTORE_TEST_CONFIRM !== "DESTROY_DISPOSABLE_RESTORE_TEST") throw new Error("Explicit disposable restore URL, backup manifest and destructive-test confirmation required");
const target = new URL(destination), original = new URL(source);
if (!/^\/school_restore_test_[a-z0-9_]+$/.test(target.pathname) || (target.hostname === original.hostname && (target.port || "5432") === (original.port || "5432") && target.pathname === original.pathname)) throw new Error("Restore target must be a distinct, disposable school_restore_test_* database");
if (!/^platform\/backups\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.json$/.test(manifestKey)) throw new Error("Invalid backup manifest key");
const [manifestBytes] = await storedObject(manifestKey).download();
const manifest = JSON.parse(manifestBytes.toString()) as { dumpKey: string; sha256: string };
if (manifest.dumpKey !== manifestKey.replace(/\.json$/, ".dump")) throw new Error("Backup manifest path mismatch");
// Validate the archive before any destructive action on the disposable target.
const hash = createHash("sha256");
for await (const chunk of storedObject(manifest.dumpKey).createReadStream()) hash.update(chunk);
if (hash.digest("hex") !== manifest.sha256) throw new Error("Backup checksum mismatch");
const child = spawn("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--dbname", decodeURIComponent(target.pathname.slice(1))], { env: postgresEnvironment(destination), stdio: ["pipe", "ignore", "ignore"] });
const finished = new Promise<void>((resolve, reject) => {
  child.once("error", () => reject(new Error("pg_restore executable unavailable")));
  child.once("close", code => code === 0 ? resolve() : reject(new Error("Disposable restore failed")));
});
await Promise.all([finished, pipeline(storedObject(manifest.dumpKey).createReadStream(), child.stdin!)]);
const restored = new PrismaClient({ datasourceUrl: destination });
try {
  const mismatches = await restored.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM student_balances b
    WHERE b.balance <> COALESCE((SELECT SUM(l.debit-l.credit) FROM ledger_entries l WHERE l."schoolId"=b."schoolId" AND l."studentId"=b."studentId"),0)`;
  if (Number(mismatches[0].count) !== 0) throw new Error("Restored balance cache does not reconcile with ledger");
  console.log(JSON.stringify({ status: "verified", schools: await restored.school.count(), students: await restored.student.count(), ledgerEntries: await restored.ledgerEntry.count(), scope: "Disposable PostgreSQL restore; external object contents not restored" }));
} finally { await restored.$disconnect(); }