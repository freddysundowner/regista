import test from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { chosenAccount, resolveMessaging, messagingSettings, validateMessagingCredentials } from "./integrations/messaging-routing";
import { submitSms, SmsRejected } from "./integrations/sms-transports";

test("hybrid selection preserves overrides and legacy accounts; explicit inheritance ignores legacy; disabled overrides block fallback", async t => {
  let own: any = null, legacy: any = null;
  const shared: any = { id: "platform-account", provider: "onfon", enabled: false, environment: "live", encryptedCredentials: null, publicConfig: {}, mode: "override" };
  const originalAccount = db.messagingAccount.findUnique, originalLegacy = db.integrationConfig.findUnique;
  (db.messagingAccount as any).findUnique = async ({ where }: any) => where.scope_channel.scope === "platform" ? shared : own;
  (db.integrationConfig as any).findUnique = async () => legacy;
  t.after(() => { db.messagingAccount.findUnique = originalAccount; db.integrationConfig.findUnique = originalLegacy; });
  assert.equal((await chosenAccount("school-a", "sms")).source, "platform");
  legacy = { ...shared, id: "legacy", provider: "africastalking" };
  assert.equal((await chosenAccount("school-a", "sms")).source, "legacy");
  own = { ...shared, id: "school-override" };
  assert.equal((await chosenAccount("school-a", "sms")).account?.id, "school-override");
  await assert.rejects(resolveMessaging("school-a", "sms"), /disabled/);
  own = { mode: "inherit" };
  assert.equal((await chosenAccount("school-a", "sms")).source, "platform");
  const view = await messagingSettings("school-a");
  assert.equal(view.channels[0].canRetainCredentials, false);
  assert.equal(JSON.stringify(view).includes("encryptedCredentials"), false);
  assert.throws(() => validateMessagingCredentials("onfon", { apiKey: "fake" }, { senderId: "SCHOOL" }), /clientId/);
});

test("Onfon uses documented request, requires recipient identity, and treats ambiguous results conservatively", async () => {
  const config = { provider: "onfon", environment: "live", credentials: { apiKey: "fake", clientId: "fake-client", accessKey: "fake-access" }, publicConfig: { senderId: "SCHOOL" } };
  const transport = (value: unknown, http = 200) => (async (_url: any, init: any) => {
    assert.equal(String(_url), "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS");
    const input = JSON.parse(init.body);
    assert.equal(input.ApiKey, "fake"); assert.equal(input.MessageParameters[0].Number, "254700000000");
    assert.equal(init.headers.AccessKey, "fake-access");
    return new Response(JSON.stringify(value), { status: http });
  }) as typeof fetch;
  assert.equal(await submitSms(config, "254700000000", "Example", transport({ ErrorCode: 0, Data: [{ MobileNumber: "254700000000", MessageId: "m1" }] })), "m1");
  await assert.rejects(submitSms(config, "254700000000", "Example", transport({ ErrorCode: 21 })), SmsRejected);
  await assert.rejects(submitSms(config, "254700000000", "Example", transport({ ErrorCode: 6 })), /unknown/);
  await assert.rejects(submitSms(config, "254700000000", "Example", transport({ ErrorCode: 0, Data: [{ MobileNumber: "254711111111", MessageId: "m1" }] })), /identity/);
  await assert.rejects(submitSms(config, "254700000000", "Example", transport({}, 503)), /reconcile/);
  await assert.rejects(submitSms({ ...config, provider: "blessedtexts" }, "254700000000", "Example"), /not verified/);
});
