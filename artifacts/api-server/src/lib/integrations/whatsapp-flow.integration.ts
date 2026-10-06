// Explicit, isolated integration check: synthetic tenant only; all provider calls mocked.
// Run with: pnpm --filter @workspace/api-server exec tsx src/lib/integrations/whatsapp-flow.integration.ts
import express from "express";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { schoolWhatsappRouter } from "../../routes/whatsapp-setup";
import { encryptCredentials } from "./security";

async function main() {
  const scope = randomUUID(), userId = randomUUID(), realFetch = globalThis.fetch;
  const oldKey = db.leadsIntelPlatform.findUnique;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let submitted: any, assistedStatus = "pending", connectionStatus = "inactive", requestCount = 0;
  try {
    const school = await db.school.create({ data: { id: scope, code: `TEST-${scope}`, name: "Synthetic WhatsApp integration", type: "primary" } });
    const user = await db.user.create({ data: { id: userId, schoolId: scope, email: `synthetic-${scope}@example.invalid`, name: "Synthetic integration", role: "school_admin", passwordHash: "unusable-test-hash", isActive: false } });
    (db.leadsIntelPlatform as any).findUnique = async () => ({ encryptedCredentials: encryptCredentials({ platformKey: "synthetic-key-never-transmitted" }) });
    globalThis.fetch = (async (url: any, init: any) => {
      if (!String(url).startsWith("https://app.leadsintel.net/")) return realFetch(url, init);
      if (String(url).endsWith("/assisted-requests")) {
        requestCount++; submitted = JSON.parse(init.body);
        return Response.json({ requestId: "synthetic-request", status: "pending" }, { status: 202 });
      }
      if (String(url).includes("/assisted-requests/")) return Response.json({ status: assistedStatus, externalPlatformTenantId: scope, externalConnectionId: submitted.externalConnectionId });
      if (String(url).endsWith("/lookup")) return Response.json({ status: "active", externalPlatformTenantId: "another-school", externalConnectionId: "other-number", phoneNumberId: "other-phone" });
      return Response.json({ status: connectionStatus, externalConnectionId: submitted.externalConnectionId, phoneNumberId: `synthetic-${scope}` });
    }) as typeof fetch;
    const app = express(); app.set("trust proxy", true); app.use(express.json());
    app.use((req: any, _res, next) => { req.actor = { user, school }; req.identity = { user }; next(); });
    app.use(schoolWhatsappRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? error.statusCode ?? 500).json({ error: error.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address() as { port: number };
    const request = (path: string, data?: unknown) => realFetch(`http://127.0.0.1:${address.port}${path}`, { method: data ? "POST" : "GET", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const start = { countryCode: "254", phoneNumber: "7" + Date.now().toString().slice(-8), businessName: "Synthetic", displayName: "Synthetic" };
    let response = await request("/whatsapp/start", start);
    assert.equal(response.status, 200, await response.text());
    assert.equal(submitted.externalPlatformTenantId, scope);
    assert.match(submitted.inboundWebhookUrl, /^https:.*\/api\/whatsapp\/inbound\//);
    assert.ok(submitted.inboundWebhookSecret.length >= 32);
    assert.equal(await db.messagingAccount.count({ where: { scope } }), 0, "No premature route replacement");
    response = await request("/whatsapp/start", start);
    assert.equal(response.status, 409); assert.equal(requestCount, 1, "No duplicate provider submission");
    assistedStatus = "connected";
    response = await request("/whatsapp/refresh", {});
    assert.equal((await response.json()).connectionActive, false);
    connectionStatus = "active";
    response = await request("/whatsapp/refresh", {});
    assert.equal((await response.json()).connectionActive, true);
    const route = await db.messagingAccount.findUniqueOrThrow({ where: { scope_channel: { scope, channel: "whatsapp" } } });
    assert.equal(route.enabled, true);
    response = await request("/whatsapp/recover", { phoneNumber: "+254700000000", confirmReceiverChange: true });
    assert.equal(response.status, 403, "A school cannot recover another school's number");
    console.log("PASS: persisted assisted setup, one provider attempt, pending/connected/active separation, safe route activation, cross-school recovery blocked. No external calls.");
  } finally {
    globalThis.fetch = realFetch;
    db.leadsIntelPlatform.findUnique = oldKey;
    server?.close();
    await db.messagingAccount.deleteMany({ where: { scope } });
    await db.whatsappSetup.deleteMany({ where: { scope } });
    await db.auditLog.deleteMany({ where: { schoolId: scope } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.school.deleteMany({ where: { id: scope } });
    await db.$disconnect();
  }
}
void main();
