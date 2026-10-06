import { Router } from "express";
import { z } from "zod";
import * as schemas from "@workspace/api-zod";
import { admin, allow, body, parse, send } from "../lib/core";
import { messagingSettings, saveMessaging } from "../lib/integrations/messaging-routing";

const channelInput = z.object({ channel: z.enum(["sms", "whatsapp"]) });
// Mounted after the platform owner's identity and support-session guards.
export const platformMessagingRouter = Router();
platformMessagingRouter.get("/platform/messaging", async (_req, res) => {
  send(res, "GetPlatformMessaging", await messagingSettings(null));
});
platformMessagingRouter.put("/platform/messaging/:channel", async (req, res) => {
  const { channel } = parse(channelInput, req.params);
  send(res, "SavePlatformMessaging", await saveMessaging("platform", channel, body(schemas.SavePlatformMessagingBody.strict(), req.body), req.identity));
});
// Mounted after authenticated tenant and read-only support guards.
export const schoolMessagingRouter = Router();
schoolMessagingRouter.get("/messaging/settings", async (req, res) => {
  allow(req, admin);
  send(res, "GetSchoolMessaging", await messagingSettings(req.actor.school.id));
});
schoolMessagingRouter.put("/messaging/settings/:channel", async (req, res) => {
  allow(req, admin);
  const { channel } = parse(channelInput, req.params);
  send(res, "SaveSchoolMessaging", await saveMessaging(req.actor.school.id, channel, body(schemas.SaveSchoolMessagingBody.strict(), req.body), req.identity));
});
