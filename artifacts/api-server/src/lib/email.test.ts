import test from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { cleanEmailHtml, queueWelcome, resolveEmailAccount } from "./email";
import { csrf } from "./core";

test("email HTML strips scripts, event handlers, unsafe links and external images", () => {
  const result = cleanEmailHtml('<h2>Hello</h2><p><strong>Welcome</strong><script>alert(1)</script><img src="https://tracking.test/x"><a href="javascript:alert(1)" onclick="bad()">Bad</a><a href="https://example.test">Good</a></p>');
  assert.match(result.html, /<strong>Welcome<\/strong>/);
  assert.doesNotMatch(result.html, /script|onclick|javascript:|<img/);
  assert.match(result.html, /https:\/\/example.test/);
  assert.throws(() => cleanEmailHtml("<p><br></p>"), /Write an email/);
});
test("welcome is durable, idempotent by user, and skipped when email is disabled", async () => {
  const calls: any[] = [];
  const tx: any = {
    messagingAccount: { findUnique: async () => ({ enabled: false, encryptedCredentials: null }) },
    emailCampaign: { upsert: async (data: any) => { calls.push(data); } },
  };
  await queueWelcome(tx, { id: "synthetic-id", name: "<script>name</script>", email: "test@example.test" }, { name: "Test school", status: "pending" });
  assert.equal(calls[0].where.scope_idempotencyKey.idempotencyKey, "welcome:synthetic-id");
  assert.equal(calls[0].create.recipients.create.status, "skipped");
  assert.match(calls[0].create.text, /awaiting administrator approval/);
  assert.doesNotMatch(calls[0].create.html, /<script>/);
  tx.messagingAccount.findUnique = async () => ({ enabled: true, encryptedCredentials: "opaque" });
  await queueWelcome(tx, { id: "synthetic-id", name: "Test", email: "test@example.test" }, { name: "Test school", status: "active" });
  assert.equal(calls[1].create.recipients.create.status, "queued");
  assert.deepEqual(calls[1].update, {});
});
test("school email never falls back to platform account", async t => {
  const original = db.messagingAccount.findUnique;
  t.after(() => { db.messagingAccount.findUnique = original; });
  const scopes: string[] = [];
  (db.messagingAccount as any).findUnique = async ({ where }: any) => { scopes.push(where.scope_channel.scope); return null; };
  await assert.rejects(resolveEmailAccount("school-test"), /own Brevo/);
  assert.deepEqual(scopes, ["school-test"]);
});
test("unsubscribe capability accepts private origins without weakening admin CSRF", () => {
  const check = (path: string) => {
    let error: unknown;
    csrf({ method: "POST", path, protocol: "https", get: (name: string) => name === "origin" ? "null" : name === "host" ? "app.example.test" : undefined } as any, {} as any, ((e?: unknown) => { error = e; }) as any);
    return error;
  };
  assert.equal(check("/api/email/unsubscribe/12345678-1234-1234-1234-123456789abc"), undefined);
  assert.ok(check("/api/platform/emails") instanceof Error);
  assert.ok(check("/api/email/unsubscribe/not-a-token") instanceof Error);
});
