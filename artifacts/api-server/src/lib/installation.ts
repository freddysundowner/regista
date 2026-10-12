import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { db } from "@workspace/db";
import { ApiError, type Identity } from "./core";
import { platformAudit } from "./platform";

/**
 * DEPLOYMENT_MODE=hosted (default): multi-school SaaS with registration, subscriptions and online payments.
 * DEPLOYMENT_MODE=standalone: one school on its own server. STANDALONE_LICENSING=licensed (default) verifies an
 * offline licence signed by the vendor's key (LICENCE_PUBLIC_KEY); STANDALONE_LICENSING=open runs without expiry.
 */
export const isStandalone = () => process.env.DEPLOYMENT_MODE === "standalone";
export const standaloneLicensing = () => process.env.STANDALONE_LICENSING === "open" ? "open" as const : "licensed" as const;
export function requireHosted() {
  if (isStandalone()) throw new ApiError(404, "This feature is not available on a standalone installation.");
}

const PREFIX = "RJL1";
const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
function keyFrom(env: string, kind: "private" | "public"): KeyObject | null {
  const raw = process.env[env]?.trim();
  if (!raw) return null;
  try {
    if (raw.includes("BEGIN")) return kind === "private" ? createPrivateKey(raw.replace(/\\n/g, "\n")) : createPublicKey(raw.replace(/\\n/g, "\n"));
    const der = Buffer.from(raw, "base64");
    return kind === "private" ? createPrivateKey({ key: der, format: "der", type: "pkcs8" }) : createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new ApiError(503, `${env} is not a valid Ed25519 ${kind} key.`);
  }
}

type LicencePayload = { v: 1; id: string; school: string; maxLearners: number | null; issuedAt: string; expiresAt: string | null };
export function signLicence(payload: LicencePayload) {
  const key = keyFrom("LICENCE_SIGNING_KEY", "private");
  if (!key) throw new ApiError(503, "LICENCE_SIGNING_KEY is not configured on this server. Generate a key pair with the licence:keygen script.");
  const body = b64url(JSON.stringify(payload));
  return `${PREFIX}.${body}.${b64url(sign(null, Buffer.from(`${PREFIX}.${body}`), key))}`;
}
export function readLicence(text: string): { ok: true; payload: LicencePayload } | { ok: false; reason: "unconfigured" | "invalid" } {
  const key = keyFrom("LICENCE_PUBLIC_KEY", "public");
  if (!key) return { ok: false, reason: "unconfigured" };
  const [prefix, body, signature, ...rest] = text.replace(/\s+/g, "").split(".");
  if (prefix !== PREFIX || !body || !signature || rest.length) return { ok: false, reason: "invalid" };
  try {
    if (!verify(null, Buffer.from(`${PREFIX}.${body}`), key, Buffer.from(signature, "base64url"))) return { ok: false, reason: "invalid" };
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicencePayload;
    if (payload.v !== 1 || typeof payload.school !== "string") return { ok: false, reason: "invalid" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

type LicenceState = { status: "active" | "expired" | "missing" | "invalid" | "unconfigured"; schoolName: string | null; expiresAt: string | null; maxLearners: number | null; issuedAt: string | null };
function stateOf(text: string | null | undefined, now = new Date()): LicenceState {
  const empty = { schoolName: null, expiresAt: null, maxLearners: null, issuedAt: null };
  if (!text) return { status: keyFrom("LICENCE_PUBLIC_KEY", "public") ? "missing" : "unconfigured", ...empty };
  const read = readLicence(text);
  if (!read.ok) return { status: read.reason, ...empty };
  const p = read.payload;
  const expired = !!p.expiresAt && new Date(p.expiresAt) <= now;
  return { status: expired ? "expired" : "active", schoolName: p.school, expiresAt: p.expiresAt, maxLearners: p.maxLearners, issuedAt: p.issuedAt };
}

let cache: { at: number; state: LicenceState } | null = null;
async function installedState() {
  if (cache && Date.now() - cache.at < 30_000) return cache.state;
  const row = await db.platformSettings.findUnique({ where: { id: "default" }, select: { installedLicence: true } });
  cache = { at: Date.now(), state: stateOf(row?.installedLicence) };
  return cache.state;
}
export async function installationView() {
  if (!isStandalone()) return { mode: "hosted" as const, licensing: null, licence: null };
  const licensing = standaloneLicensing();
  return { mode: "standalone" as const, licensing, licence: licensing === "open" ? null : await installedState() };
}
/** Null when access is allowed; otherwise the reason shown to staff. */
export async function standaloneBlock() {
  if (!isStandalone() || standaloneLicensing() === "open") return null;
  const state = await installedState();
  if (state.status === "active") return null;
  if (state.status === "expired") return "This installation's Rejista licence has expired. An administrator can enter a renewed licence under Settings → Licence.";
  if (state.status === "unconfigured") return "This installation is missing LICENCE_PUBLIC_KEY, so its licence cannot be checked. Contact your Rejista provider.";
  return "This installation does not have a valid Rejista licence yet. An administrator can enter one under Settings → Licence.";
}
export async function standaloneLearnerLimit() {
  if (standaloneLicensing() === "open") return null;
  const state = await installedState();
  return state.status === "active" ? state.maxLearners : null;
}
export async function installLicence(identity: Identity, text: string) {
  if (!isStandalone() || standaloneLicensing() === "open") throw new ApiError(404, "This installation does not use licences.");
  const compact = text.replace(/\s+/g, "");
  const state = stateOf(compact);
  if (state.status === "unconfigured") throw new ApiError(503, "This server is missing LICENCE_PUBLIC_KEY, so licences cannot be checked.");
  if (state.status === "invalid") throw new ApiError(400, "That licence is not valid. Paste the full licence exactly as you received it.");
  if (state.status === "expired") throw new ApiError(400, "That licence has already expired. Ask your Rejista provider for a renewed one.");
  await db.$transaction(async tx => {
    await tx.platformSettings.upsert({ where: { id: "default" }, create: { id: "default", installedLicence: compact }, update: { installedLicence: compact } });
    await platformAudit(tx, identity, "installation.licence_installed", `Standalone licence installed for ${state.schoolName}`, identity.user.schoolId, undefined, undefined,
      { schoolName: state.schoolName, expiresAt: state.expiresAt, maxLearners: state.maxLearners });
  });
  cache = null;
  return installationView();
}

// ---------- Hosted side: issuing licences for standalone installs ----------
export async function listStandaloneLicences() {
  requireHosted();
  return db.standaloneLicence.findMany({ orderBy: { issuedAt: "desc" }, take: 500 });
}
export async function issueStandaloneLicence(identity: Identity, input: { requestId: string; schoolName: string; expiresAt?: Date | null; maxLearners: number | null; note?: string }) {
  requireHosted();
  const existing = await db.standaloneLicence.findUnique({ where: { id: input.requestId } });
  if (existing) return existing;
  const schoolName = input.schoolName.trim();
  if (schoolName.length < 2) throw new ApiError(400, "Enter the school's name.");
  if (input.expiresAt && input.expiresAt <= new Date()) throw new ApiError(400, "The expiry date must be in the future.");
  const issuedAt = new Date();
  const licence = signLicence({ v: 1, id: input.requestId || randomUUID(), school: schoolName, maxLearners: input.maxLearners,
    issuedAt: issuedAt.toISOString(), expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null });
  return db.$transaction(async tx => {
    const row = await tx.standaloneLicence.create({ data: { id: input.requestId, schoolName, maxLearners: input.maxLearners, issuedAt,
      expiresAt: input.expiresAt ?? null, note: (input.note ?? "").trim(), licence, createdById: identity.user.id } });
    await platformAudit(tx, identity, "installation.licence_issued", `Standalone licence issued for ${schoolName}`, null, row.id, undefined,
      { schoolName, expiresAt: row.expiresAt, maxLearners: row.maxLearners });
    return row;
  });
}
