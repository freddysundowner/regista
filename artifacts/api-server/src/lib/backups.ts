import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "./core";
import { storedObject } from "./school-files";

export function postgresEnvironment(connection: string) {
  const url = new URL(connection);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new ApiError(503, "Invalid PostgreSQL connection configuration");
  return {
    PATH: process.env.PATH, HOME: process.env.HOME,
    PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer", PGCONNECT_TIMEOUT: "20",
  };
}
export async function databaseBackup() {
  if (!process.env.DATABASE_URL) throw new ApiError(503, "Database connection is not configured");
  const id = randomUUID(), key = `platform/backups/${new Date().toISOString().slice(0, 10)}/${id}`;
  const target = storedObject(`${key}.dump`), hash = createHash("sha256");
  let bytes = 0;
  const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--lock-wait-timeout=30000"], { env: postgresEnvironment(process.env.DATABASE_URL), stdio: ["ignore", "pipe", "ignore"] });
  const finished = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new ApiError(503, "pg_dump executable unavailable")));
    child.once("close", code => code === 0 ? resolve() : reject(new ApiError(503, "Database backup process failed")));
  });
  try {
    await Promise.all([finished, pipeline(child.stdout!, new Transform({ transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); bytes += chunk.length; callback(null, chunk); } }), target.createWriteStream({ resumable: true, contentType: "application/octet-stream", metadata: { cacheControl: "private, no-store" } }))]);
    const manifest = { id, createdAt: new Date().toISOString(), dumpKey: `${key}.dump`, bytes, sha256: hash.digest("hex"), scope: "PostgreSQL only; object files and encryption keys require separate retention", restoreVerified: false };
    await storedObject(`${key}.json`).save(JSON.stringify(manifest), { contentType: "application/json", resumable: false });
    return manifest;
  } catch (error) {
    child.kill("SIGTERM");
    await target.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
}