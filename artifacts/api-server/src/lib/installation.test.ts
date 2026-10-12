import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), pub: publicKey.export({ format: "der", type: "spki" }).toString("base64") };
};

test("standalone licences verify offline and reject tampering or foreign keys", async () => {
  const vendor = pair(), other = pair();
  process.env.LICENCE_SIGNING_KEY = vendor.priv;
  process.env.LICENCE_PUBLIC_KEY = vendor.pub;
  const { signLicence, readLicence } = await import("./installation");
  const payload = { v: 1 as const, id: "11111111-1111-4111-8111-111111111111", school: "Test Academy", maxLearners: 500, issuedAt: new Date().toISOString(), expiresAt: null };
  const licence = signLicence(payload);
  const read = readLicence(licence);
  assert.ok(read.ok);
  if (read.ok) assert.equal(read.payload.maxLearners, 500);
  // Wrapped across lines when pasted.
  assert.ok(readLicence(licence.replace(/(.{20})/g, "$1\n")).ok);

  const [prefix, body, sig] = licence.split(".");
  const forged = Buffer.from(JSON.stringify({ ...payload, maxLearners: 100000 })).toString("base64url");
  assert.deepEqual(readLicence(`${prefix}.${forged}.${sig}`), { ok: false, reason: "invalid" });
  assert.deepEqual(readLicence(`${prefix}.${body}`), { ok: false, reason: "invalid" });

  process.env.LICENCE_SIGNING_KEY = other.priv;
  const foreign = signLicence(payload);
  assert.deepEqual(readLicence(foreign), { ok: false, reason: "invalid" });

  delete process.env.LICENCE_PUBLIC_KEY;
  assert.deepEqual(readLicence(licence), { ok: false, reason: "unconfigured" });
});
