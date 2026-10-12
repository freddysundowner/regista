import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { financeBoss } from "../jobs/finance";
import { sendDelivery } from "../lib/integrations/messages";
import { renderFinancePdf } from "../lib/finance/documents";
import { readUrl, storedObject, usesLocalStorage } from "../lib/school-files";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development-only controlled verification");
const school = await db.school.create({ data: { code: `SERVICE-VERIFY-${randomUUID()}`, name: "Disposable service verification", type: "primary", status: "suspended" } });
const boss = financeBoss(), queue = `verify-modules-${randomUUID()}`;
const objectKey = `${school.id}/verification/${randomUUID()}.pdf`;
let objectCreated = false;
try {
  await boss.start();
  await boss.createQueue(queue, { retryLimit: 0 });
  const message = await db.messageDelivery.create({ data: { schoolId: school.id, phone: "254700000000", channel: "sms", template: "verification", content: "Must never be sent", idempotencyKey: randomUUID() } });
  // Isolated queue executes the production delivery handler only against this
  // school's absent configuration. No external provider call can be reached.
  await boss.work(queue, async () => { await sendDelivery(message.id, school.id); });
  const id = await boss.send(queue, {});
  let state = "";
  for (let i = 0; i < 40; i++) {
    const row = await db.$queryRaw<{ state: string }[]>`SELECT state FROM pgboss.job WHERE id=${id}::uuid AND name=${queue}`;
    state = row[0]?.state ?? "";
    if (state === "failed") break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(state, "failed", "Unconfigured integration must fail the real pg-boss job");
  const saved = await db.messageDelivery.findUniqueOrThrow({ where: { id: message.id } });
  assert.equal(saved.status, "failed"); assert.match(saved.error ?? "", /not configured/);
  console.log("PASS: isolated pg-boss execution failed visibly on absent provider configuration; no provider sends");
  const bytes = await renderFinancePdf([{ text: "Controlled synthetic storage verification" }]);
  await storedObject(objectKey).save(bytes, { contentType: "application/pdf", resumable: false }); objectCreated = true;
  const [download] = await storedObject(objectKey).download();
  assert.deepEqual(download, bytes);
  if (!usesLocalStorage()) {
    const { downloadUrl } = await readUrl(objectKey, "");
    const fetched = await fetch(downloadUrl);
    assert.equal(fetched.ok, true, "Private storage signing"); assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), bytes);
  }
  console.log("PASS: real PDF upload, private object download and signed URL download; synthetic object will be removed");
} finally {
  if (objectCreated) await storedObject(objectKey).delete({ ignoreNotFound: true });
  await boss.deleteQueue(queue).catch(() => undefined);
  await boss.stop().catch(() => undefined);
  await db.messageDelivery.deleteMany({ where: { schoolId: school.id } });
  await db.school.delete({ where: { id: school.id } });
  await db.$disconnect();
}