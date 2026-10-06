import { db, Prisma } from "@workspace/db";
import { ApiError, lock, type Identity } from "../core";
import { platformAudit } from "../platform";
import { decryptCredentials, digest, encryptCredentials } from "./security";
import { platformKey } from "./whatsapp-setup";

export type Channel = "sms" | "whatsapp";
export const providerKeys: Record<string, string[]> = {
  onfon: ["apiKey", "clientId", "accessKey"],
  blessedtexts: ["apiKey"],
  africastalking: ["apiKey", "username"],
  leadsintel: ["platformKey", "tenantId"],
};
const legacyProvider = (channel: Channel) => channel === "sms" ? "africastalking" : "leadsintel";
type Account = Prisma.MessagingAccountGetPayload<{}>;
export async function chosenAccount(schoolId: string | null, channel: Channel) {
  if (schoolId) {
    const override = await db.messagingAccount.findUnique({ where: { scope_channel: { scope: schoolId, channel } } });
    if (override?.mode === "override") return { account: override, source: "school" as const };
    // Existing school accounts are explicit overrides until the administrator chooses inheritance.
    if (!override) {
      const legacy = await db.integrationConfig.findUnique({ where: { schoolId_provider: { schoolId, provider: legacyProvider(channel) } } });
      if (legacy) return { account: legacy, source: "legacy" as const };
    }
  }
  return { account: await db.messagingAccount.findUnique({ where: { scope_channel: { scope: "platform", channel } } }), source: "platform" as const };
}
export function validateMessagingCredentials(provider: string, credentials: Record<string, string>, publicConfig: Record<string, string>, validateGateway = true) {
  if (!providerKeys[provider]) throw new ApiError(400, "Unsupported messaging provider.");
  for (const key of providerKeys[provider]) if (!credentials[key]?.trim()) throw new ApiError(400, `${key} is required for ${provider}.`);
  if (["onfon", "blessedtexts"].includes(provider) && !publicConfig.senderId?.trim()) throw new ApiError(400, "An approved sender ID is required.");
  if (provider === "leadsintel" && !publicConfig.connectionId?.trim()) throw new ApiError(400, "WhatsApp connection ID is required.");
  if (validateGateway && (!!credentials.callbackToken !== !!credentials.deliveryGatewaySecret)) throw new ApiError(400, "Delivery gateway token and signature secret must be supplied together.");
  if (validateGateway && credentials.callbackToken && (!/^[A-Za-z0-9_-]{32,128}$/.test(credentials.callbackToken) || credentials.deliveryGatewaySecret.length < 32)) throw new ApiError(400, "Delivery gateway token and secret must each have at least 32 characters.");
}
/** Resolves exactly one payer/account. Disabled or invalid overrides never silently use platform funds. */
export async function resolveMessaging(schoolId: string, channel: Channel) {
  const { account, source } = await chosenAccount(schoolId, channel);
  if (!account?.enabled || !account.provider) throw new ApiError(503, `${channel.toUpperCase()} account is not configured or is disabled.`);
  if (account.provider === "blessedtexts") throw new ApiError(503, "Blessed Text sending requires verified API response documentation.");
  if (!account.encryptedCredentials) throw new ApiError(503, "Messaging account credentials are not configured.");
  const credentials = decryptCredentials(account.encryptedCredentials);
  if (credentials.managedPlatformKey === "true") credentials.platformKey = await platformKey();
  const publicConfig = account.publicConfig as Record<string, string>;
  // Preserve the old AT account's sender-id location without exposing it in responses.
  const config: Record<string, string> = { ...publicConfig, senderId: publicConfig.senderId ?? credentials.senderId ?? "" };
  validateMessagingCredentials(account.provider, credentials, config, false);
  return { config: account, credentials, publicConfig: config, provider: account.provider,
    accountId: source === "legacy" ? null : account.id, source };
}
export async function messagingSettings(schoolId: string | null) {
  const channels = await Promise.all((["sms", "whatsapp"] as const).map(async channel => {
    const { account, source } = await chosenAccount(schoolId, channel);
    const own = schoolId ? await db.messagingAccount.findUnique({ where: { scope_channel: { scope: schoolId, channel } } }) : account as Account | null;
    const pub = (account?.publicConfig ?? {}) as Record<string, string>;
    const configured = !!account?.encryptedCredentials;
    const status = !configured ? "not_configured" : account?.provider === "blessedtexts" ? "contract_required" : !account?.enabled ? "disabled" : "unverified";
    return { channel, mode: own?.mode ?? (source === "legacy" || !schoolId ? "override" : "inherit"),
      source: account ? source : "none", provider: account?.provider ?? null, enabled: account?.enabled ?? false,
      configured, canRetainCredentials: !!own?.encryptedCredentials && own.mode === "override",
      environment: account?.environment ?? "live", senderId: pub.senderId ?? "", connectionId: pub.connectionId ?? "",
      status, reason: status === "contract_required" ? "Blessed Text API response documentation is required before sending can be enabled."
        : status === "not_configured" ? "No messaging account is configured."
        : status === "disabled" ? "This account is disabled. It will not use a different account for this channel."
        : "Account saved; live connectivity and delivery have not been verified. Accepted submissions are not delivery confirmations." };
  }));
  return { channels };
}
type Input = { mode: string; provider?: string; enabled: boolean; environment?: string; senderId?: string; connectionId?: string; credentials?: Record<string, string> };
export async function saveMessaging(scope: string, channel: Channel, input: Input, identity: Identity) {
  const platform = scope === "platform";
  if (input.mode === "inherit" && platform) throw new ApiError(400, "Platform accounts cannot inherit.");
  if (input.mode === "override") {
    if (!input.provider || !providerKeys[input.provider] || ((channel === "whatsapp") !== (input.provider === "leadsintel"))) throw new ApiError(400, "Choose a provider supported by this channel.");
    if (input.provider === "blessedtexts" && input.enabled) throw new ApiError(409, "Blessed Text requires verified API response documentation before sending can be enabled. Save it disabled for now.");
    if (input.environment === "sandbox" && input.provider !== "africastalking") throw new ApiError(400, "This provider has no verified sandbox transport.");
  }
  await db.$transaction(async tx => {
    await lock(tx, `messaging:${scope}:${channel}`);
    const old = await tx.messagingAccount.findUnique({ where: { scope_channel: { scope, channel } } });
    let data;
    if (input.mode === "inherit") {
      data = { mode: "inherit", provider: null, enabled: false, encryptedCredentials: null, publicConfig: {}, callbackTokenHash: null };
    } else {
      const pub = { senderId: input.senderId ?? "", connectionId: input.connectionId ?? "" };
      const sameProvider = old?.mode === "override" && old.provider === input.provider;
      let credentials = input.credentials;
      if (!credentials && sameProvider && old?.encryptedCredentials) credentials = decryptCredentials(old.encryptedCredentials);
      if (credentials) validateMessagingCredentials(input.provider!, credentials, pub);
      if (input.enabled && !credentials) throw new ApiError(400, "Credentials are required before enabling a provider.");
      const allowed = [...providerKeys[input.provider!], "callbackToken", "deliveryGatewaySecret"];
      if (credentials && Object.keys(credentials).some(k => !allowed.includes(k))) throw new ApiError(400, "Unexpected credential field.");
      data = { mode: "override", provider: input.provider, enabled: input.enabled, environment: input.environment ?? "live",
        publicConfig: pub, encryptedCredentials: credentials ? encryptCredentials(credentials) : null,
        callbackTokenHash: credentials?.callbackToken ? digest(credentials.callbackToken) : null };
    }
    const account = await tx.messagingAccount.upsert({ where: { scope_channel: { scope, channel } }, create: { scope, channel, ...data }, update: data });
    await platformAudit(tx, identity, platform ? "messaging.platform_updated" : "messaging.school_updated",
      platform ? "Platform messaging default updated" : input.mode === "inherit" ? "School switched to platform messaging default" : "School messaging override updated",
      platform ? null : scope, account.id, undefined,
      { channel, mode: account.mode, provider: account.provider, enabled: account.enabled, credentialsChanged: input.credentials !== undefined || input.mode === "inherit" });
  });
  return messagingSettings(platform ? null : scope);
}
