import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import * as schemas from "@workspace/api-zod";
import { z } from "zod";
import { ApiError, authenticateIdentity, body, parse, send } from "../lib/core";
import { installLicence, installationView, issueStandaloneLicence, listStandaloneLicences, requireHosted } from "../lib/installation";
import { requirePlatform } from "../lib/platform";
import { licenceView, publicPackages } from "../lib/licensing";
import {
  PROVIDERS, PROVIDER_NAME, availableMethods, requireApproval, saveRegistrationSettings, checkoutView, generateKeys, listGateways, listKeys, paystackWebhook, sunpayCallback, sunpayWebhook,
  pricingView, redeemKey, refreshCheckout, revealKey, revokeKey, saveGateway, savePricing, startCheckout, stripeWebhook, type Provider,
} from "../lib/billing";
import { logger } from "../lib/logger";

type RawRequest = Request & { rawBody?: Buffer };

/** Unauthenticated: published price for the landing page and provider webhooks (each verified by signature or secret token). */
export const publicBilling = Router();
publicBilling.get("/installation", async (_req, res) => { send(res, "GetInstallation", await installationView()); });
publicBilling.put("/installation/licence", authenticateIdentity, async (req, res) => {
  if (!["super_admin", "school_admin"].includes(req.identity.user.role)) throw new ApiError(403, "Only administrators can install a licence.");
  send(res, "InstallLicence", await installLicence(req.identity, body(schemas.InstallLicenceBody.strict(), req.body).licence));
});
publicBilling.use(["/public/pricing", "/billing/webhooks"], (_req, _res, next) => { try { requireHosted(); next(); } catch (error) { next(error); } });
publicBilling.get("/public/pricing", async (_req, res) => {
  const [pricing, methods, approval, packages] = await Promise.all([pricingView(), availableMethods(), requireApproval(), publicPackages()]);
  res.set("Cache-Control", "public, max-age=60");
  send(res, "GetPublicPricing", { ...pricing, requireApproval: approval, packages, paymentMethods: methods.map(id => ({ id, name: PROVIDER_NAME[id] })) });
});
publicBilling.post("/billing/webhooks/stripe", async (req, res) => {
  await stripeWebhook((req as RawRequest).rawBody, req.get("stripe-signature"));
  res.json({ received: true });
});
publicBilling.post("/billing/webhooks/paystack", async (req, res) => {
  await paystackWebhook((req as RawRequest).rawBody, req.get("x-paystack-signature"));
  res.json({ received: true });
});
publicBilling.post("/billing/webhooks/sunpay", async (req, res) => {
  await sunpayWebhook((req as RawRequest).rawBody, req.get("x-webhook-signature"));
  res.json({ received: true });
});
publicBilling.post("/billing/webhooks/sunpay/:checkoutId", async (req, res) => {
  const { checkoutId } = parse(z.object({ checkoutId: z.string().uuid() }), req.params);
  try { await sunpayCallback(checkoutId); }
  catch (error) {
    // Acknowledge anyway; the school's status poll reconciles the payment.
    logger.error({ err: error instanceof Error ? error.message : error }, "SunPay callback processing failed");
  }
  res.json({ received: true });
});

/** Mounted inside the platform router's owner and read-only-grant guards. */
export const platformBilling = Router();
platformBilling.use(["/platform/pricing", "/platform/payment-gateways", "/platform/licence-keys", "/platform/registration-settings", "/platform/standalone-licences"],
  (_req, _res, next) => { try { requireHosted(); next(); } catch (error) { next(error); } });
platformBilling.get("/platform/standalone-licences", async (req, res) => { requirePlatform(req); send(res, "ListStandaloneLicences", await listStandaloneLicences()); });
platformBilling.post("/platform/standalone-licences", async (req, res) => {
  requirePlatform(req);
  send(res, "IssueStandaloneLicence", await issueStandaloneLicence(req.identity, body(schemas.IssueStandaloneLicenceBody.strict(), req.body)), 201);
});
const provider = z.object({ provider: z.enum(PROVIDERS) });
const keyId = z.object({ keyId: z.string().uuid() });
platformBilling.get("/platform/pricing", async (req, res) => { requirePlatform(req); send(res, "GetPlatformPricing", await pricingView()); });
platformBilling.put("/platform/pricing", async (req, res) => {
  requirePlatform(req);
  send(res, "UpdatePlatformPricing", await savePricing(req.identity, body(schemas.UpdatePlatformPricingBody.strict(), req.body)));
});
platformBilling.get("/platform/registration-settings", async (req, res) => { requirePlatform(req); send(res, "GetRegistrationSettings", { requireApproval: await requireApproval() }); });
platformBilling.put("/platform/registration-settings", async (req, res) => {
  requirePlatform(req);
  send(res, "UpdateRegistrationSettings", await saveRegistrationSettings(req.identity, body(schemas.UpdateRegistrationSettingsBody.strict(), req.body)));
});
platformBilling.get("/platform/payment-gateways", async (req, res) => { requirePlatform(req); send(res, "ListPaymentGateways", await listGateways()); });
platformBilling.put("/platform/payment-gateways/:provider", async (req, res) => {
  requirePlatform(req);
  const p = parse(provider, req.params).provider as Provider;
  send(res, "UpdatePaymentGateway", await saveGateway(req.identity, p, body(schemas.UpdatePaymentGatewayBody.strict(), req.body)));
});
platformBilling.get("/platform/licence-keys", async (req, res) => { requirePlatform(req); send(res, "ListLicenceKeys", await listKeys()); });
platformBilling.post("/platform/licence-keys", async (req, res) => {
  requirePlatform(req);
  send(res, "GenerateLicenceKeys", await generateKeys(req.identity, body(schemas.GenerateLicenceKeysBody.strict(), req.body)), 201);
});
platformBilling.post("/platform/licence-keys/:keyId/reveal", async (req, res) => {
  requirePlatform(req);
  send(res, "RevealLicenceKey", await revealKey(req.identity, parse(keyId, req.params).keyId));
});
platformBilling.post("/platform/licence-keys/:keyId/revoke", async (req, res) => {
  requirePlatform(req);
  send(res, "RevokeLicenceKey", await revokeKey(req.identity, parse(keyId, req.params).keyId));
});

/** Registered on the school subscription router, after its school-admin and active-school checks. */
const redeemLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: "Too many licence key attempts. Try again in 15 minutes." }); } });
export function registerSchoolBilling(router: Router) {
  router.post("/school/subscription/orders/:orderId/checkout", async (req, res) => {
    const { orderId } = parse(z.object({ orderId: z.string().uuid() }), req.params);
    const input = body(schemas.StartSubscriptionCheckoutBody.strict(), req.body);
    const origin = req.get("origin") ?? `${req.protocol}://${req.get("host")}`;
    const checkout = await startCheckout(req.identity, req.identity.user.schoolId!, orderId, input, origin);
    send(res, "StartSubscriptionCheckout", checkoutView(checkout), 201);
  });
  router.get("/school/subscription/checkouts/:checkoutId", async (req, res) => {
    const { checkoutId } = parse(z.object({ checkoutId: z.string().uuid() }), req.params);
    send(res, "GetSubscriptionCheckout", checkoutView(await refreshCheckout(req.identity.user.schoolId!, checkoutId)));
  });
  router.post("/school/subscription/redeem", redeemLimit, async (req, res) => {
    const { code } = body(schemas.RedeemLicenceKeyBody.strict(), req.body);
    send(res, "RedeemLicenceKey", licenceView(await redeemKey(req.identity, req.identity.user.schoolId!, code)), 201);
  });
}
