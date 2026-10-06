import { Router } from "express";
import { z } from "zod";
import * as schemas from "@workspace/api-zod";
import { admin, allow, body, parse, send, ApiError } from "../lib/core";
import { chosenAccount, messagingSettings, saveMessaging } from "../lib/integrations/messaging-routing";
import { decryptCredentials } from "../lib/integrations/security";
import { checkLeadsIntelConnection } from "../lib/integrations/leadsintel";

async function checkConnection(schoolId: string | null) {
  const { account } = await chosenAccount(schoolId, "whatsapp");
  if (account?.provider !== "leadsintel" || !account.encryptedCredentials) throw new ApiError(400, "Save a LeadsIntel account before checking its connection.");
  const pub = account.publicConfig as Record<string, string>;
  return checkLeadsIntelConnection(decryptCredentials(account.encryptedCredentials), pub.connectionId);
}

const channelInput = z.object({ channel: z.enum(["sms", "whatsapp"]) });
// Mounted after the platform owner's identity and support-session guards.
export const platformMessagingRouter = Router();
platformMessagingRouter.get("/platform/messaging/whatsapp/connection", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  send(res, "CheckPlatformWhatsappConnection", await checkConnection(null));
});
platformMessagingRouter.get("/platform/messaging", async (_req, res) => {
  send(res, "GetPlatformMessaging", await messagingSettings(null));
});
platformMessagingRouter.put("/platform/messaging/:channel", async (req, res) => {
  const { channel } = parse(channelInput, req.params);
  send(res, "SavePlatformMessaging", await saveMessaging("platform", channel, body(schemas.SavePlatformMessagingBody.strict(), req.body), req.identity));
});
// Mounted after authenticated tenant and read-only support guards.
export const schoolMessagingRouter = Router();
schoolMessagingRouter.get("/messaging/settings/whatsapp/connection", async (req, res) => {
  allow(req, admin);
  res.set("Cache-Control", "no-store");
  send(res, "CheckSchoolWhatsappConnection", await checkConnection(req.actor.school.id));
});
schoolMessagingRouter.get("/messaging/settings", async (req, res) => {
  allow(req, admin);
  send(res, "GetSchoolMessaging", await messagingSettings(req.actor.school.id));
});
schoolMessagingRouter.put("/messaging/settings/:channel", async (req, res) => {
  allow(req, admin);
  const { channel } = parse(channelInput, req.params);
  send(res, "SaveSchoolMessaging", await saveMessaging(req.actor.school.id, channel, body(schemas.SaveSchoolMessagingBody.strict(), req.body), req.identity));
});
