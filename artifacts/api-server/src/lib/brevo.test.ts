import test from "node:test";
import assert from "node:assert/strict";
import { sendBrevoEmail } from "./integrations/brevo";

const email = { senderName: "Rejista Test", senderEmail: "sender@example.test", recipient: "receiver@example.test", replyTo: "reply@example.test", subject: "Test", text: "Configuration test" };
test("Brevo sends authenticated JSON once and requires provider message ID", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["api-key"], "synthetic-key");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.sender, { name: email.senderName, email: email.senderEmail });
    assert.deepEqual(body.to, [{ email: email.recipient }]);
    assert.deepEqual(body.replyTo, { email: email.replyTo });
    assert.equal(body.textContent, email.text);
    return new Response(JSON.stringify({ messageId: "test-id" }), { status: 201 });
  };
  assert.equal(await sendBrevoEmail("synthetic-key", email), "test-id");
  assert.equal(calls, 1);
});
test("Brevo rejection does not echo provider body or credentials", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("private provider detail", { status: 401 });
  await assert.rejects(sendBrevoEmail("synthetic-key", email), /rejected the API key/);
});
test("uncertain outcomes never automatically retry", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("timeout"); };
  await assert.rejects(sendBrevoEmail("synthetic-key", email), /may already have been sent/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; return new Response("{}"); };
  await assert.rejects(sendBrevoEmail("synthetic-key", email), /no message ID/);
  assert.equal(calls, 2);
});
