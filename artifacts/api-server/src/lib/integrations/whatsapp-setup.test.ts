import test from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { encryptCredentials } from "./security";
import { leadsIntelRequest, syncConnection } from "./whatsapp-setup";

test("LeadsIntel managed transport and active-state gate", async t => {
  const originalFetch = globalThis.fetch;
  const originalKey = db.leadsIntelPlatform.findUnique;
  const originalSetup = db.whatsappSetup.findUniqueOrThrow;
  const originalTransaction = db.$transaction;
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.leadsIntelPlatform.findUnique = originalKey;
    db.whatsappSetup.findUniqueOrThrow = originalSetup;
    db.$transaction = originalTransaction;
  });
  (db.leadsIntelPlatform as any).findUnique = async () => ({ encryptedCredentials: encryptCredentials({ platformKey: "synthetic-platform-key" }) });
  const calls: { url: string; body: any; auth: string }[] = [];
  let result: any = { requestId: "synthetic-request", status: "pending" };
  let code = 200;
  globalThis.fetch = (async (url: string, options: any) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined, auth: options.headers.Authorization });
    return new Response(JSON.stringify(result), { status: code });
  }) as any;
  await t.test("POSTs documented assisted-request contract using server platform key", async () => {
    await leadsIntelRequest("assisted-requests", "POST", { externalPlatformTenantId: "school-test", externalConnectionId: "number-test", countryCode: "254", phoneNumber: "700000000", businessName: "Synthetic", displayName: "Synthetic", inboundWebhookUrl: "https://example.test/webhook", inboundWebhookSecret: "synthetic" });
    assert.equal(calls[0].url, "https://app.leadsintel.net/api/external-platform/whatsapp/assisted-requests");
    assert.equal(calls[0].auth, "Bearer synthetic-platform-key");
    assert.equal(calls[0].body.externalPlatformTenantId, "school-test");
  });
  await t.test("duplicate number is explicit and no automatic retry occurs", async () => {
    code = 409;
    const before = calls.length;
    await assert.rejects(leadsIntelRequest("assisted-requests", "POST", {}), /previously submitted/);
    assert.equal(calls.length, before + 1);
    code = 200;
  });
  let receiverConfigured = "true";
  let saved: any, enabled: boolean | undefined;
  (db.whatsappSetup as any).findUniqueOrThrow = async () => ({ scope: "school-test", tenantId: "tenant/a", connectionId: "number/b", encryptedCredentials: encryptCredentials({ receiverConfigured, routingInstalled: "true" }) });
  (db as any).$transaction = async (fn: any) => fn({
    whatsappSetup: { update: async ({ data }: any) => { saved = data; } },
    messagingAccount: { updateMany: async ({ data }: any) => { enabled = data.enabled; } },
  });
  await t.test("connected setup is not active; inactive connection keeps sends disabled", async () => {
    result = { status: "inactive", externalConnectionId: "number/b" };
    await syncConnection("school-test");
    assert.equal(saved.status, "inactive");
    assert.equal(enabled, false);
    assert.match(calls.at(-1)!.url, /tenant%2Fa\/number%2Fb$/);
  });
  await t.test("only active connection with matching phone identifier enables sends", async () => {
    result = { status: "active", externalConnectionId: "number/b", phoneNumberId: "synthetic-phone-id" };
    await syncConnection("school-test");
    assert.equal(enabled, true);
    result = { status: "active", externalConnectionId: "wrong", phoneNumberId: "synthetic" };
    await assert.rejects(syncConnection("school-test"), /different connection/);
    result = { status: "active" };
    await assert.rejects(syncConnection("school-test"), /phone identifier/);
  });
  await t.test("uncertain webhook update cannot become active by status refresh", async () => {
    receiverConfigured = "false";
    const before = calls.length;
    await assert.rejects(syncConnection("school-test"), /webhook configuration was not confirmed/);
    assert.equal(calls.length, before);
  });
  await t.test("provider secrets and response body are not included in failures", async () => {
    code = 401; result = { error: "synthetic-secret-from-provider" };
    await assert.rejects(leadsIntelRequest("connections/lookup", "POST", { phoneNumber: "+254700000000" }), e => {
      assert.doesNotMatch(String(e), /synthetic-secret/);
      return true;
    });
  });
});
