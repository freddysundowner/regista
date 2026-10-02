import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ApiError, parse } from "../lib/core";
import { decryptCredentials, digest, verifySignature } from "../lib/integrations/security";
import { recordDeliveryEvent } from "../lib/integrations/messages";

const router = Router();
// Our normalized gateway contract, not a claimed native LeadsIntel/AT callback contract.
// Enable only after the operator's gateway validates the real provider's webhook.
router.post("/integrations/message-delivery/events/:token", async (req, res) => {
  const config = await db.integrationConfig.findUnique({ where: { callbackTokenHash: digest(String(req.params.token)) } });
  if (!config?.enabled || !["leadsintel", "africastalking"].includes(config.provider)) throw new ApiError(404, "Delivery gateway not configured");
  const credentials = decryptCredentials(config.encryptedCredentials);
  if (!credentials.deliveryGatewaySecret || credentials.deliveryGatewaySecret.length < 32) throw new ApiError(503, "Authenticated delivery gateway secret (32+ characters) is not configured; native provider callbacks are not supported");
  verifySignature(credentials.deliveryGatewaySecret, req.get("X-Delivery-Timestamp") ?? "", req.rawBody ?? Buffer.alloc(0), req.get("X-Delivery-Signature") ?? "");
  const input = parse(z.object({ providerMessageId: z.string().min(1).max(200), status: z.enum(["delivered", "read", "rejected"]) }).strict(), req.body);
  await db.$transaction(tx => recordDeliveryEvent(tx, config.schoolId, config.provider, input.providerMessageId, input.status));
  res.sendStatus(204);
});
export default router;