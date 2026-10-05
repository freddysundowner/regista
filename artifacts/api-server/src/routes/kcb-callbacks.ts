import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { ApiError } from "../lib/core";
import { decryptCredentials, digest, systemActor } from "../lib/integrations/security";
import { normalizeKcb, verifyKcbSignature } from "../lib/integrations/kcb";
import { ingest } from "../lib/payments/pipeline";

const router = Router();
export function kcbHandler(kind: "account" | "till") {
  return async (req: Request, res: Response) => {
    const config = await db.integrationConfig.findUnique({ where: { callbackTokenHash: digest(String(req.params.token)) } });
    if (!config?.enabled || config.provider !== "bank") throw new ApiError(404, "KCB callback configuration not found");
    const credentials = decryptCredentials(config.encryptedCredentials);
    if (!credentials.kcbPublicKey) throw new ApiError(503, "KCB signing public key is not configured");
    verifyKcbSignature(credentials.kcbPublicKey, req.rawBody ?? Buffer.alloc(0), req.get("Signature") ?? "");
    const normalized = normalizeKcb(kind, req.body, { ...(config.publicConfig as { accountNumber?: string }), tillBusinessKey: credentials.tillBusinessKey });
    // Acknowledge only after durable ingest. Matching/ledger posting uses the
    // existing worker; an acknowledgement is not a claim of student allocation.
    await ingest(await systemActor(config.schoolId), normalized.input, "kcb_signed_notification", req.body);
    res.json(normalized.acknowledgement);
  };
}
for (const kind of ["account", "till"] as const) {
  router.post(`/integrations/kcb/${kind}-notification/:token`, kcbHandler(kind));
}
export default router;
