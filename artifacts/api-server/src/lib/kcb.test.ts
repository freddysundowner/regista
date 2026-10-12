import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID, randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { normalizeKcb, verifyKcbSignature, kcbPublicKey, kcbTime, kcbTillTime, kcbTillDate } from "./integrations/kcb";
import { saveIntegration } from "./integrations/security";
import { kcbHandler } from "../routes/kcb-callbacks";
import { processPayment } from "./payments/pipeline";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const notification = {
  transactionReference: "SYNTH-KCB-1", requestId: "request-1", timestamp: "20250519133054",
  transactionAmount: "1000.50", currency: "KES", customerReference: "ADM-001",
  customerName: "Synthetic payer", creditAccountIdentifier: "SYNTH-ACCOUNT-A",
};
function signed(body: unknown) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { rawBody, signature: sign("RSA-SHA256", rawBody, keys.privateKey).toString("base64") };
}
test("KCB signatures authenticate exact bytes, reject tampering, wrong key and missing signature", () => {
  const s = signed(notification);
  verifyKcbSignature(pem, s.rawBody, s.signature);
  assert.throws(() => verifyKcbSignature(pem, Buffer.from(JSON.stringify({ ...notification, transactionAmount: "1" })), s.signature));
  assert.throws(() => verifyKcbSignature(pem, s.rawBody, ""));
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => verifyKcbSignature(other, s.rawBody, s.signature));
  assert.throws(() => kcbPublicKey(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()));
});
test("KCB validates receiving identity, currency, decimal precision and EAT times", () => {
  const cfg = { accountNumber: notification.creditAccountIdentifier };
  assert.equal(normalizeKcb("account", notification, cfg).input.amount, "1000.50");
  assert.throws(() => normalizeKcb("account", notification, { accountNumber: "OTHER" }));
  for (const patch of [{ currency: "USD" }, { transactionAmount: "0" }, { transactionAmount: "1.001" }, { transactionReference: "" }]) {
    assert.throws(() => normalizeKcb("account", { ...notification, ...patch }, cfg));
  }
  assert.equal(kcbTime("20250519133054").toISOString(), "2025-05-19T10:30:54.000Z");
  assert.equal(kcbTime("202505191330").toISOString(), "2025-05-19T10:30:00.000Z");
  assert.throws(() => kcbTime("20250230133000"));
  assert.equal(kcbTillTime("Mon May 19 13:30:54 EAT 2025").toISOString(), "2025-05-19T10:30:54.000Z");
  const till = { header: { messageID: "1", originatorConversationID: "2", timeStamp: "20250519133100" },
    requestPayload: { primaryData: { businessKey: "TILL-A", businessKeyType: "notifyBiller" },
      additionalData: { notificationData: { businessKey: "ADM-001", businessKeyType: "BillReferenceNumber",
        transactionID: "FT-1", transactionAmt: "100", currency: "KES", transactionDate: "Mon May 19 13:30:54 EAT 2025" } } } };
  assert.equal(normalizeKcb("till", till, { tillBusinessKey: "TILL-A" }).input.accountReference, "ADM-001");
  assert.throws(() => normalizeKcb("till", till, { tillBusinessKey: "ADM-001" }));
});

test("KCB formats from its PDF samples are accepted, and unreadable times are kept but flagged", () => {
  // Till sample from the PDF: "queryBiller" and a bare date, timed from the header on the same day.
  const pdfTill = { header: { messageID: "m", originatorConversationID: "", channelCode: "202", timeStamp: "20201102101010" },
    requestPayload: { primaryData: { businessKey: "000000", businessKeyType: "queryBiller" },
      additionalData: { notificationData: { businessKey: "P-INV-001", businessKeyType: "BillReferenceNumber", debitMSISDN: "254722520441",
        transactionAmt: "100.00", transactionDate: "20201102", transactionID: "FT235373", firstName: "James", currency: "KES", transactionType: "vooma", balance: "0.00" } } } };
  const till = normalizeKcb("till", pdfTill, { tillBusinessKey: "000000" });
  assert.equal(till.timeTrusted, true);
  assert.equal(till.input.transactionTime.toISOString(), "2020-11-02T07:10:10.000Z");
  assert.equal(kcbTillDate("20201102", "20201103000000").toISOString(), "2020-11-01T21:00:00.000Z");
  assert.equal(kcbTillDate("20250519133054").toISOString(), "2025-05-19T10:30:54.000Z");
  // Account sample from the PDF has a 13-digit timestamp: stored with the receipt time and flagged, not refused.
  const account = normalizeKcb("account", { ...notification, timestamp: "2021111103005" }, { accountNumber: notification.creditAccountIdentifier });
  assert.equal(account.timeTrusted, false);
  assert.ok(Math.abs(account.input.transactionTime.getTime() - Date.now()) < 5000);
  assert.equal(normalizeKcb("account", notification, { accountNumber: notification.creditAccountIdentifier }).timeTrusted, true);
});

test("KCB signed handler and real ledger: isolation, duplicate retries, conflicts, unmatched and disabled callbacks", async t => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development-only rollback fixtures");
  const transaction = db.$transaction.bind(db), rollback = new Error("rollback KCB test");
  const restore: (() => void)[] = [];
  const oldKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    await assert.rejects(transaction(async tx => {
      const replace = (target: any, method: string, fn: any) => {
        const previous = target[method];
        target[method] = fn;
        restore.push(() => { target[method] = previous; });
      };
      replace(db, "$transaction", (fn: any) => fn(tx));
      // Global reads in callbacks use the same uncommitted, isolated fixture.
      for (const [model, methods] of Object.entries({
        integrationConfig: ["findUnique"], school: ["findUniqueOrThrow"],
        user: ["findFirst"], incomingPayment: ["findUnique", "findFirst", "findUniqueOrThrow"],
      })) for (const method of methods) replace((db as any)[model], method, (...args: any[]) => (tx as any)[model][method](...args));
      const school = await tx.school.create({ data: { code: `KCB-${randomUUID()}`, name: "Synthetic KCB", type: "primary" } });
      const other = await tx.school.create({ data: { code: `KCB-${randomUUID()}`, name: "Other synthetic KCB", type: "primary" } });
      const user = await tx.user.create({ data: { schoolId: school.id, name: "Synthetic admin", role: "school_admin", email: `${randomUUID()}@example.invalid`, passwordHash: "unusable" } });
      const userB = await tx.user.create({ data: { schoolId: other.id, name: "Synthetic admin", role: "school_admin", email: `${randomUUID()}@example.invalid`, passwordHash: "unusable" } });
      const student = await tx.student.create({ data: { schoolId: school.id, admissionNo: "ADM-001", firstName: "Synthetic", lastName: "Student" } });
      await tx.student.create({ data: { schoolId: other.id, admissionNo: "ADM-001", firstName: "Other", lastName: "Student" } });
      const token = randomBytes(32).toString("hex");
      const input = { provider: "bank", environment: "sandbox", enabled: true, accountNumber: notification.creditAccountIdentifier, credentials: { callbackToken: token, kcbPublicKey: pem } };
      await saveIntegration({ school, user }, input);
      await assert.rejects(saveIntegration({ school: other, user: userB }, { ...input, credentials: { ...input.credentials, callbackToken: randomBytes(32).toString("hex") } }), /another school/);
      const invoke = async (body: any, signatureOverride?: string, tokenOverride = token) => {
        const s = signed(body);
        let response: any;
        await kcbHandler("account")({ params: { token: tokenOverride }, body, rawBody: s.rawBody,
          get: () => signatureOverride ?? s.signature } as any, { json: (v: any) => { response = v; } } as any);
        return response;
      };
      assert.equal((await invoke(notification)).statusCode, "0");
      await invoke(notification);
      const rows = await tx.incomingPayment.findMany({ where: { schoolId: school.id } });
      assert.equal(rows.length, 1);
      await assert.rejects(invoke({ ...notification, transactionAmount: "2" }), /conflicting/);
      await assert.rejects(invoke({ ...notification, customerReference: "OTHER" }), /conflicting/);
      await assert.rejects(invoke(notification, "invalid"), /signature/);
      await assert.rejects(invoke(notification, undefined, "unknown"), /not found/);
      await assert.rejects(invoke({ ...notification, creditAccountIdentifier: "WRONG" }), /does not match/);
      await processPayment(school.id, rows[0].id);
      await processPayment(school.id, rows[0].id);
      assert.equal(await tx.paymentStudentAllocation.count({ where: { schoolId: school.id, studentId: student.id } }), 1);
      const ledger = await tx.ledgerEntry.findMany({ where: { schoolId: school.id, studentId: student.id, type: "payment" } });
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].credit.toFixed(2), "1000.50");
      assert.equal(await tx.ledgerEntry.count({ where: { schoolId: other.id } }), 0);
      await invoke({ ...notification, transactionReference: "SYNTH-UNKNOWN", customerReference: "UNKNOWN" });
      const unmatched = await tx.incomingPayment.findFirstOrThrow({ where: { schoolId: school.id, providerTxnId: "SYNTH-UNKNOWN" } });
      await processPayment(school.id, unmatched.id);
      assert.equal((await tx.incomingPayment.findUniqueOrThrow({ where: { id: unmatched.id } })).status, "unmatched");
      await tx.integrationConfig.update({ where: { schoolId_provider: { schoolId: school.id, provider: "bank" } }, data: { enabled: false } });
      await assert.rejects(invoke(notification), /not found/);
      throw rollback;
    }, { timeout: 30000 }), error => error === rollback);
  } finally {
    for (const undo of restore.reverse()) undo();
    if (oldKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = oldKey;
  }
});
