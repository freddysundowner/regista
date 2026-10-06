import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { ApiError } from "../core";
import { decryptCredentials, encryptCredentials } from "./security";
import { z } from "zod";

export async function platformKey() {
  const config = await db.leadsIntelPlatform.findUnique({ where: { id: "platform" } });
  if (!config) throw new ApiError(409, "The platform administrator must configure the LeadsIntel platform API key first.");
  return decryptCredentials(config.encryptedCredentials).platformKey;
}
export async function leadsIntelRequest(path: string, method = "GET", payload?: unknown) {
  const key = await platformKey();
  let response: Response;
  try {
    response = await fetch(`https://app.leadsintel.net/api/external-platform/whatsapp/${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new ApiError(502, "LeadsIntel did not confirm the result. Do not resubmit a setup request; recover the number or contact LeadsIntel."); }
  if (!response.ok) {
    const messages: Record<number, string> = { 401: "LeadsIntel rejected the platform key.", 403: "LeadsIntel denied this request.", 404: "LeadsIntel could not find this number or request.", 409: "This number was previously submitted or is already connected. Recover its connection; do not submit it again.", 429: "LeadsIntel is rate limiting requests. Wait before checking again." };
    throw new ApiError(502, messages[response.status] ?? "LeadsIntel rejected the request. Contact LeadsIntel before resubmitting.");
  }
  if (response.status === 204) return {};
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new ApiError(502, "LeadsIntel returned an unrecognized result. Do not resubmit setup.");
  return data;
}
export const remoteConnection = z.object({
  status: z.string(), externalConnectionId: z.string().optional(), externalPlatformTenantId: z.string().optional(),
  phoneNumberId: z.string().min(1).optional(), displayPhoneNumber: z.string().optional(),
});
export const connectionPath = (tenantId: string, connectionId: string) => `connections/${encodeURIComponent(tenantId)}/${encodeURIComponent(connectionId)}`;
export function setupSecrets() { return encryptCredentials({ inboundWebhookSecret: randomBytes(32).toString("hex") }); }
export async function setupState(scope: string) {
  const [setup, central, own, legacy] = await Promise.all([
    db.whatsappSetup.findUnique({ where: { scope } }), db.leadsIntelPlatform.count(),
    db.messagingAccount.findUnique({ where: { scope_channel: { scope, channel: "whatsapp" } } }),
    scope === "platform" ? null : db.integrationConfig.findUnique({ where: { schoolId_provider: { schoolId: scope, provider: "leadsintel" } } }),
  ]);
  return { platformKeyConfigured: central > 0, hasOwnConnection: !!setup, status: setup?.status ?? "not_started",
    phoneNumber: setup?.phoneNumber ?? "", businessName: setup?.businessName ?? "", displayName: setup?.displayName ?? "",
    error: setup?.error ?? "", ...(setup?.requestId ? { requestId: setup.requestId } : {}),
    connectionActive: setup?.status === "active", inherited: scope !== "platform" && (own?.mode === "inherit" || (!own && !legacy)),
    legacyConfigured: !setup && !!(own?.encryptedCredentials || legacy?.encryptedCredentials) };
}
export async function syncConnection(scope: string) {
  const setup = await db.whatsappSetup.findUniqueOrThrow({ where: { scope } });
  if (decryptCredentials(setup.encryptedCredentials).receiverConfigured !== "true") throw new ApiError(409, "The webhook configuration was not confirmed. Recover this number before enabling it.");
  const remote = remoteConnection.parse(await leadsIntelRequest(connectionPath(setup.tenantId, setup.connectionId)));
  if (remote.externalConnectionId && remote.externalConnectionId !== setup.connectionId) throw new ApiError(502, "LeadsIntel returned a different connection.");
  if (remote.externalPlatformTenantId && remote.externalPlatformTenantId !== setup.tenantId) throw new ApiError(502, "LeadsIntel returned a different tenant.");
  if (remote.status === "active" && !remote.phoneNumberId) throw new ApiError(502, "LeadsIntel did not return the phone identifier needed for secure incoming messages.");
  await db.$transaction(async tx => {
    const secrets = decryptCredentials(setup.encryptedCredentials);
    if (remote.status === "active" && secrets.routingInstalled !== "true") {
      const old = await tx.messagingAccount.findUnique({ where: { scope_channel: { scope, channel: "whatsapp" } } });
      const pub = (old?.publicConfig ?? {}) as Record<string, string>;
      const data = { mode: "override", provider: "leadsintel", environment: "live", enabled: true,
        encryptedCredentials: encryptCredentials({ tenantId: setup.tenantId, managedPlatformKey: "true" }),
        publicConfig: { ...pub, connectionId: setup.connectionId } };
      await tx.messagingAccount.upsert({ where: { scope_channel: { scope, channel: "whatsapp" } }, create: { scope, channel: "whatsapp", ...data }, update: data });
      secrets.routingInstalled = "true";
    } else if (secrets.routingInstalled === "true") {
      await tx.messagingAccount.updateMany({ where: { scope, channel: "whatsapp", mode: "override" }, data: { enabled: remote.status === "active" } });
    }
    await tx.whatsappSetup.update({ where: { scope }, data: { status: remote.status, phoneNumberId: remote.phoneNumberId, error: "", encryptedCredentials: encryptCredentials(secrets) } });
  });
}
