import { ApiError } from "../core";

/** A definitive provider rejection is different from a timeout/unknown submission. */
export class SmsRejected extends ApiError {
  constructor(message: string) { super(503, message); }
}
type Config = { provider: string; environment: string; credentials: Record<string, string>; publicConfig: Record<string, string> };
// Official Onfon contract: https://www.docs.onfonmedia.co.ke/rest/sms/
export async function submitSms(config: Config, phone: string, content: string, transport: typeof fetch = fetch): Promise<string> {
  if (config.provider === "onfon") {
    const response = await transport("https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS", {
      method: "POST", headers: { "Content-Type": "application/json", AccessKey: config.credentials.accessKey },
      body: JSON.stringify({ ApiKey: config.credentials.apiKey, ClientId: config.credentials.clientId,
        SenderId: config.publicConfig.senderId, IsUnicode: /[^\x00-\x7F]/.test(content),
        MessageParameters: [{ Number: phone, Text: content }] }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new ApiError(503, `Onfon submission response ${response.status}; reconcile before retry.`);
    const body = await response.json() as { ErrorCode?: number | string; Data?: { MobileNumber?: string; MessageId?: string }[] };
    if (!(body.ErrorCode === 0 || /^(0|000)$/.test(String(body.ErrorCode)))) {
      const code = Number(body.ErrorCode);
      if ([3, 4, 5, 7, 8, 9, 10, 11, 13, 15, 19, 20, 21, 23, 24, 30, 35, 39, 42].includes(code)) throw new SmsRejected(`Onfon rejected submission (code ${code}).`);
      throw new ApiError(503, "Onfon submission outcome is unknown; reconcile before retry.");
    }
    const matches = Array.isArray(body.Data) ? body.Data.filter(d => String(d.MobileNumber).replace(/^\+/, "") === phone) : [];
    if (matches.length !== 1 || !matches[0].MessageId) throw new ApiError(503, "Onfon response lacks a unique recipient/message identity; reconcile before retry.");
    return String(matches[0].MessageId);
  }
  if (config.provider !== "africastalking") throw new ApiError(503, "SMS provider contract is not verified.");
  const form = new URLSearchParams({ username: config.credentials.username, to: `+${phone}`, message: content });
  if (config.publicConfig.senderId) form.set("from", config.publicConfig.senderId);
  const response = await transport(`https://${config.environment === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com"}/version1/messaging`,
    { method: "POST", headers: { apiKey: config.credentials.apiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new ApiError(503, `SMS submission failed (${response.status})`);
  const body = await response.json() as { SMSMessageData?: { Recipients?: { statusCode: number; messageId: string }[] } };
  const recipient = body.SMSMessageData?.Recipients?.[0];
  if (!recipient || ![100, 101, 102].includes(recipient.statusCode)) {
    if (recipient) throw new SmsRejected(`SMS recipient rejected (${recipient.statusCode})`);
    throw new ApiError(503, "SMS submission outcome is unknown; reconcile before retry.");
  }
  if (!recipient.messageId) throw new ApiError(503, "SMS response lacks a message identity; reconcile before retry.");
  return recipient.messageId;
}
