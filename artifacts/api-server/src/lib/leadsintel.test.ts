import test from "node:test";
import assert from "node:assert/strict";
import { checkLeadsIntelConnection } from "./integrations/leadsintel";

test("connection check uses authenticated encoded GET without submitting a message", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://app.leadsintel.net/api/external-platform/whatsapp/connections/tenant%2Fa/connection%2Fb");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-not-a-real-key");
    assert.equal(init?.body, undefined);
    return new Response(JSON.stringify({ status: "active", externalConnectionId: "connection/b", displayPhoneNumber: "+254700000000" }));
  };
  const result = await checkLeadsIntelConnection({ platformKey: "synthetic-not-a-real-key", tenantId: "tenant/a" }, "connection/b");
  assert.equal(result.status, "active");
  assert.equal(result.displayPhoneNumber, "+254700000000");
});

test("inactive status is not reported as active", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "disconnected" }));
  assert.equal((await checkLeadsIntelConnection({ platformKey: "synthetic", tenantId: "tenant" }, "connection")).status, "disconnected");
});

test("malformed responses, missing keys and rejected credentials fail explicitly", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(checkLeadsIntelConnection({}, "connection"), /required/);
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  await assert.rejects(checkLeadsIntelConnection({ platformKey: "synthetic", tenantId: "tenant" }, "connection"), /rejected the platform key/);
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "active", externalConnectionId: "wrong" }));
  await assert.rejects(checkLeadsIntelConnection({ platformKey: "synthetic", tenantId: "tenant" }, "connection"), /unexpected/);
});
