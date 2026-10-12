import test from "node:test";
import assert from "node:assert/strict";
import { generateNcbaCredentials, ncbaHash, ncbaTime, normalizeNcba, NCBA_TILL_PAYBILL } from "./integrations/ncba";

const credentials = { notificationUsername: "rejista-abcd2345", notificationPassword: "Pw-synthetic-123456", notificationSecretKey: "SecretKeySynthetic0123456789abcd" };
function signed(body: Record<string, string>) {
  return { ...body, Username: credentials.notificationUsername, Password: credentials.notificationPassword, Hash: ncbaHash(credentials.notificationSecretKey, body as never) };
}
const paybill = { TransType: "PAYBILL", TransID: "RK70O1A9HU", TransTime: "20231107163508", TransAmount: "100.0", BusinessShortCode: "488488", BillRefNumber: "ADM-001", Mobile: "254711111111", name: "JOHN DOE", created_at: "2023-11-07 16:35:37.0" };
const till = { TransType: "Pay Bill", TransID: "RK91U5J2AD", FTRef: "FTC231009BMZG", TransTime: "20231109112200", TransAmount: "2.0", BusinessShortCode: NCBA_TILL_PAYBILL, BillRefNumber: "000001", Narrative: "ADM-002", Mobile: "254711111111", name: "JOHN DOE" };

test("NCBA hash follows the documented recipe: Base64 of the lowercase SHA-256 hex", () => {
  const hash = ncbaHash("k", { TransType: "a", TransID: "b", TransTime: "c", TransAmount: "d", BusinessShortCode: "e", BillRefNumber: "f", Mobile: "g", name: "h" });
  // Independently computed: printf 'kabcdefgh1' | shasum -a 256 | cut -d' ' -f1 | tr -d '\n' | base64
  assert.equal(hash, "NjBiZGM4YmU0YzlmYmQ1MjYxN2RjNTcxMjVkN2I5NGMxOGI3NjgwZWY2MGQwMWVlMjQxMzE2MmE5YWEzZTVlOA==");
});

test("NCBA paybill notification becomes a payment referenced by BillRefNumber, without stored secrets", () => {
  const n = normalizeNcba(signed(paybill), { collectionType: "paybill", collectionNumber: "488488" }, credentials);
  assert.equal(n.hashVerified, true);
  assert.equal(n.input.provider, "ncba");
  assert.equal(n.input.providerTxnId, "RK70O1A9HU");
  assert.equal(n.input.accountReference, "ADM-001");
  assert.equal(n.input.amount, "100.0");
  assert.equal(n.input.transactionTime.toISOString(), "2023-11-07T13:35:08.000Z");
  assert.equal(n.input.payerPhone, "254711111111");
  for (const secret of ["Username", "Password", "Hash"]) assert.equal(secret in n.rawPayload, false);
});

test("NCBA Till payments arrive under 880100 with the till in BillRefNumber and the reference in Narrative", () => {
  const n = normalizeNcba(signed(till), { collectionType: "ncba_till", collectionNumber: "000001" }, credentials);
  assert.equal(n.input.accountReference, "ADM-002");
  assert.throws(() => normalizeNcba(signed(till), { collectionType: "ncba_till", collectionNumber: "000002" }, credentials), /does not match/);
  assert.throws(() => normalizeNcba(signed({ ...till, BusinessShortCode: "488488" }), { collectionType: "ncba_till", collectionNumber: "000001" }, credentials), /does not match/);
});

test("NCBA treats an N/A reference as missing and drops hashed phone numbers", () => {
  const n = normalizeNcba(signed({ ...paybill, BillRefNumber: "N/A", Mobile: "a".repeat(64) }), { collectionType: "paybill", collectionNumber: "488488" }, credentials);
  assert.equal(n.input.accountReference, undefined);
  assert.equal(n.input.payerPhone, undefined);
});

test("NCBA refuses wrong credentials and another school's shortcode, and flags a wrong hash for review", () => {
  const account = { collectionType: "paybill" as const, collectionNumber: "488488" };
  assert.throws(() => normalizeNcba({ ...signed(paybill), Password: "wrong" }, account, credentials), /credentials/);
  assert.throws(() => normalizeNcba({ ...signed(paybill), Username: "someone-else" }, account, credentials), /credentials/);
  assert.throws(() => normalizeNcba(signed(paybill), { ...account, collectionNumber: "999999" }, credentials), /does not match/);
  // Right username and password but the amount was changed after hashing: kept, but not trusted.
  assert.equal(normalizeNcba({ ...signed(paybill), TransAmount: "100000.0" }, account, credentials).hashVerified, false);
  assert.throws(() => normalizeNcba({ ...signed(paybill), TransAmount: "-5" }, account, credentials));
});

test("NCBA TransTime is Nairobi time and refuses impossible or future dates", () => {
  assert.equal(ncbaTime("20240111100431").toISOString(), "2024-01-11T07:04:31.000Z");
  assert.throws(() => ncbaTime("20240231100431"), /Invalid/);
  assert.throws(() => ncbaTime("240111100431"), /Unsupported/);
  assert.throws(() => ncbaTime("29990101000000"), /Invalid/);
});

test("Generated NCBA credentials are unique and avoid look-alike characters", () => {
  const a = generateNcbaCredentials(), b = generateNcbaCredentials();
  assert.notEqual(a.notificationSecretKey, b.notificationSecretKey);
  assert.notEqual(a.callbackToken, b.callbackToken);
  for (const v of Object.values(a)) assert.doesNotMatch(v.replace(/^rejista-(stk-)?/, ""), /[0O1lI]/);
  assert.ok(a.callbackToken.length >= 40 && a.notificationSecretKey.length >= 32);
});
