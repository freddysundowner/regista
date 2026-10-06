import { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { ApiError, admin, allow, body, lock, audit } from "../lib/core";
import { platformAudit } from "../lib/platform";
import { decryptCredentials, encryptCredentials } from "../lib/integrations/security";
import { connectionPath, leadsIntelRequest, platformKey, remoteConnection, setupSecrets, setupState, syncConnection } from "../lib/integrations/whatsapp-setup";

export const platformWhatsappRouter = Router(), schoolWhatsappRouter = Router(), whatsappInboundRouter = Router();
const assistedStatus = z.enum(["pending", "awaiting_code", "connected", "failed", "cancelled"]);
const origin = (req: Request) => {
  const value = `${req.protocol}://${req.get("host")}`;
  if (!value.startsWith("https://")) throw new ApiError(409, "Open Settings through the public HTTPS app URL before connecting WhatsApp.");
  return value;
};
async function record(req: Request, scope: string, action: string) {
  await db.$transaction(tx => scope === "platform"
    ? platformAudit(tx, req.identity, action, "WhatsApp connection settings updated", null, scope)
    : audit(tx, req.actor, action, "whatsapp_setup", scope));
}
function mount(router: Router, platform: boolean) {
  const path = platform ? "/platform/whatsapp" : "/whatsapp";
  const scopeOf = (req: Request) => { if (!platform) allow(req, admin); return platform ? "platform" : req.actor.school.id; };
  router.get(path, async (req, res) => { res.json(await setupState(scopeOf(req))); });
  if (platform) router.put(`${path}/key`, async (req, res) => {
    const input = body(schemas.SaveLeadsIntelPlatformKeyBody.strict(), req.body);
    if (!input.apiKey.trim()) throw new ApiError(400, "Enter the platform API key.");
    const encryptedCredentials = encryptCredentials({ platformKey: input.apiKey.trim() });
    await db.leadsIntelPlatform.upsert({ where: { id: "platform" }, create: { id: "platform", encryptedCredentials }, update: { encryptedCredentials } });
    await record(req, "platform", "whatsapp.platform_key_updated");
    res.json(await setupState("platform"));
  });
  router.post(`${path}/start`, async (req, res) => {
    const scope = scopeOf(req), base = origin(req);
    const input = body(schemas.StartPlatformWhatsappSetupBody.strict(), req.body);
    await platformKey();
    const phoneNumber = `+${input.countryCode}${input.phoneNumber}`;
    if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber) || !input.businessName.trim() || !input.displayName.trim()) throw new ApiError(400, "Enter a valid international number and business names.");
    const setup = await db.$transaction(async tx => {
      await lock(tx, `whatsapp:${scope}`);
      if (await tx.whatsappSetup.findUnique({ where: { scope } })) throw new ApiError(409, "A setup already exists. Refresh it or recover the existing number; do not resubmit.");
      if (await tx.whatsappSetup.findUnique({ where: { phoneNumber } })) throw new ApiError(409, "This number already has a setup request.");
      return tx.whatsappSetup.create({ data: { scope, tenantId: scope, phoneNumber, businessName: input.businessName.trim(), displayName: input.displayName.trim(), encryptedCredentials: setupSecrets() } });
    });
    await record(req, scope, "whatsapp.setup_requested");
    try {
      const result = z.object({ requestId: z.string().min(1), status: assistedStatus }).parse(await leadsIntelRequest("assisted-requests", "POST", {
        ...input, externalPlatformTenantId: scope, externalConnectionId: setup.connectionId,
        inboundWebhookUrl: `${base}/api/whatsapp/inbound/${setup.webhookToken}`,
        inboundWebhookSecret: decryptCredentials(setup.encryptedCredentials).inboundWebhookSecret,
      }));
      await db.whatsappSetup.update({ where: { scope }, data: { requestId: result.requestId, status: result.status,
        encryptedCredentials: encryptCredentials({ ...decryptCredentials(setup.encryptedCredentials), receiverConfigured: "true" }) } });
    } catch (e) {
      await db.whatsappSetup.update({ where: { scope }, data: { status: "uncertain", error: e instanceof ApiError ? e.message : "Setup result could not be verified. Contact LeadsIntel; do not resubmit." } });
    }
    res.json(await setupState(scope));
  });
  router.post(`${path}/refresh`, async (req, res) => {
    const scope = scopeOf(req), setup = await db.whatsappSetup.findUnique({ where: { scope } });
    if (!setup) throw new ApiError(409, "Connect or recover a number first.");
    if (setup.requestId && setup.status !== "active") {
      const remote = z.object({ status: assistedStatus, errorCode: z.string().nullable().optional(), externalPlatformTenantId: z.string().optional(), externalConnectionId: z.string().optional() }).parse(await leadsIntelRequest(`assisted-requests/${encodeURIComponent(setup.requestId)}`));
      if ((remote.externalPlatformTenantId && remote.externalPlatformTenantId !== setup.tenantId) || (remote.externalConnectionId && remote.externalConnectionId !== setup.connectionId)) throw new ApiError(502, "LeadsIntel returned a different setup request.");
      await db.whatsappSetup.update({ where: { scope }, data: { status: remote.status, error: remote.errorCode ? `${remote.errorCode}. Contact LeadsIntel to recover this request; do not resubmit the number.` : "" } });
      if (remote.status !== "connected") { res.json(await setupState(scope)); return; }
    }
    await syncConnection(scope);
    res.json(await setupState(scope));
  });
  router.post(`${path}/recover`, async (req, res) => {
    const scope = scopeOf(req), base = origin(req);
    const input = body(schemas.RecoverPlatformWhatsappBody.strict(), req.body);
    if (!input.confirmReceiverChange) throw new ApiError(400, "Confirm that incoming messages should be routed to this app.");
    const remote = remoteConnection.extend({ externalPlatformTenantId: z.string(), externalConnectionId: z.string() }).parse(await leadsIntelRequest("connections/lookup", "POST", { phoneNumber: input.phoneNumber }));
    const previous = await db.whatsappSetup.findUnique({ where: { scope } });
    const legacy = scope === "platform" ? null : await db.integrationConfig.findUnique({ where: { schoolId_provider: { schoolId: scope, provider: "leadsintel" } } });
    const account = await db.messagingAccount.findUnique({ where: { scope_channel: { scope, channel: "whatsapp" } } });
    const old = account?.encryptedCredentials ? decryptCredentials(account.encryptedCredentials) : legacy?.encryptedCredentials ? decryptCredentials(legacy.encryptedCredentials) : {};
    if (!platform && remote.externalPlatformTenantId !== scope && !(old.tenantId === remote.externalPlatformTenantId && ((account?.publicConfig ?? legacy?.publicConfig) as any)?.connectionId === remote.externalConnectionId)) throw new ApiError(403, "This number is not assigned to your school. Ask the platform administrator to verify its ownership.");
    if (remote.status !== "active") throw new ApiError(409, "The existing connection is inactive. Contact LeadsIntel; lookup cannot reactivate it.");
    if (previous && previous.phoneNumber !== input.phoneNumber) throw new ApiError(409, "A different number is already assigned here. It must be disconnected before replacement.");
    const setup = await db.$transaction(async tx => {
      await lock(tx, `whatsapp:${scope}`);
      const linked = await tx.whatsappSetup.findFirst({ where: { OR: [{ phoneNumber: input.phoneNumber }, { tenantId: remote.externalPlatformTenantId, connectionId: remote.externalConnectionId }] } });
      if (linked && linked.scope !== scope) throw new ApiError(403, "This number belongs to another account.");
      return tx.whatsappSetup.upsert({ where: { scope }, create: { scope, tenantId: remote.externalPlatformTenantId, connectionId: remote.externalConnectionId, phoneNumber: input.phoneNumber, businessName: "", displayName: "", encryptedCredentials: setupSecrets(), status: "recovering" },
        update: { tenantId: remote.externalPlatformTenantId, connectionId: remote.externalConnectionId, status: "recovering", error: "", requestId: null,
          encryptedCredentials: previous ? encryptCredentials({ ...decryptCredentials(previous.encryptedCredentials), receiverConfigured: "false", routingInstalled: "false" }) : setupSecrets() } });
    });
    await record(req, scope, "whatsapp.recovery_requested");
    try {
      await leadsIntelRequest(connectionPath(setup.tenantId, setup.connectionId), "PATCH", { inboundWebhookUrl: `${base}/api/whatsapp/inbound/${setup.webhookToken}`, inboundWebhookSecret: decryptCredentials(setup.encryptedCredentials).inboundWebhookSecret });
      await db.whatsappSetup.update({ where: { scope }, data: { encryptedCredentials: encryptCredentials({ ...decryptCredentials(setup.encryptedCredentials), receiverConfigured: "true" }) } });
      await syncConnection(scope);
    } catch (e) {
      await db.whatsappSetup.update({ where: { scope }, data: { status: "uncertain", error: e instanceof ApiError ? e.message : "Could not verify the recovered connection." } });
    }
    res.json(await setupState(scope));
  });
}
mount(platformWhatsappRouter, true); mount(schoolWhatsappRouter, false);

whatsappInboundRouter.post("/whatsapp/inbound/:token", async (req, res) => {
  const setup = await db.whatsappSetup.findUnique({ where: { webhookToken: String(req.params.token) } });
  if (!setup) throw new ApiError(404, "Connection not found.");
  const timestamp = req.get("X-LeadIntel-Timestamp") ?? "", signature = req.get("X-LeadIntel-Signature") ?? "", eventId = req.get("X-LeadIntel-Event-Id");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature) || !eventId || eventId.length > 500) throw new ApiError(401, "Invalid webhook signature.");
  const expected = createHmac("sha256", decryptCredentials(setup.encryptedCredentials).inboundWebhookSecret).update(`${timestamp}.`).update(req.rawBody ?? Buffer.alloc(0)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new ApiError(401, "Invalid webhook signature.");
  if (!setup.phoneNumberId || req.body?.metadata?.phone_number_id !== setup.phoneNumberId) throw new ApiError(403, "Webhook phone does not match this connection.");
  await db.$transaction(async tx => {
    await lock(tx, `whatsapp-event:${eventId}`);
    if (await tx.whatsappInbound.findUnique({ where: { eventId } })) return;
    await tx.whatsappInbound.create({ data: { eventId, scope: setup.scope, payload: req.body } });
    if (setup.scope !== "platform" && Array.isArray(req.body.messages)) {
      for (const message of req.body.messages) {
        const at = new Date(Number(message.timestamp) * 1000);
        if (typeof message.from === "string" && /^\d{7,15}$/.test(message.from) && Number.isFinite(at.getTime()) && at.getTime() <= Date.now() + 300000 && at.getTime() >= Date.now() - 86400000) {
          await tx.guardian.updateMany({ where: { schoolId: setup.scope, phone: `+${message.from}`, OR: [{ whatsappLastInboundAt: null }, { whatsappLastInboundAt: { lt: at } }] }, data: { whatsappLastInboundAt: at } });
        }
      }
    }
  });
  res.sendStatus(202);
});
