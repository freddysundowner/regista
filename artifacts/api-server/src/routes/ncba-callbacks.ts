import { Router } from "express";
import { db } from "@workspace/db";
import { ApiError } from "../lib/core";
import { systemActor } from "../lib/integrations/security";
import { normalizeNcba, type NcbaAccount, type NcbaCredentials } from "../lib/integrations/ncba";
import { ncbaAccountForToken } from "../lib/bank-accounts";
import { ingest, needsVerification } from "../lib/payments/pipeline";

const router = Router();
/**
 * NCBA paybill-level push notification. NCBA expects {ResultCode, ResultDesc} JSON for both outcomes, so
 * refusals are answered in that shape too and logged for the school. Acknowledgement means the payment is
 * stored, not that it is allocated to a learner.
 */
router.post("/integrations/ncba/notification/:token", async (req, res) => {
  let schoolId: string | undefined;
  try {
    const { account, credentials } = await ncbaAccountForToken(String(req.params.token));
    schoolId = account.schoolId;
    const n = normalizeNcba(req.body, account as NcbaAccount, credentials as NcbaCredentials);
    const actor = await systemActor(account.schoolId);
    if (!n.hashVerified) await db.integrationEvent.create({ data: { schoolId, provider: "ncba", event: "hash_mismatch", status: "held_for_review", detail: { transactionId: n.input.providerTxnId, bankAccountId: account.id } } });
    const hold = !n.hashVerified || await needsVerification(actor, "ncba", n.input.amount, n.input.transactionTime, n.input.providerTxnId);
    await ingest(actor, n.input, hold ? "callback_hold" : "ncba_notification", n.rawPayload);
    // Only a fully verified message proves the connection works end to end.
    await db.bankAccount.update({ where: { id: account.id }, data: { lastNotificationAt: new Date(), ...(n.hashVerified && account.notificationStatus !== "live" ? { notificationStatus: "live", liveAt: new Date() } : {}) } });
    res.json({ ResultCode: "0", ResultDesc: "Received" });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (schoolId) await db.integrationEvent.create({ data: { schoolId, provider: "ncba", event: "notification_refused", status: String(error.status), detail: { reason: error.message } } }).catch(() => undefined);
    res.status(error.status).json({ ResultCode: "1", ResultDesc: error.message });
  }
});
export default router;
