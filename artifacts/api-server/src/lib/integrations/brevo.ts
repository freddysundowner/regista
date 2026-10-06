import { z } from "zod";
import { ApiError } from "../core";

export type BrevoEmail = {
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  recipient: string;
  subject: string;
  text: string;
  html?: string;
};

export class BrevoSendError extends ApiError {
  constructor(message: string, public outcome: "failed" | "uncertain") { super(502, message); }
}
/** Single attempt only: an uncertain response may already have sent an email. */
export async function sendBrevoEmail(apiKey: string, email: BrevoEmail): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: email.senderName, email: email.senderEmail },
        to: [{ email: email.recipient }],
        ...(email.replyTo ? { replyTo: { email: email.replyTo } } : {}),
        subject: email.subject,
        textContent: email.text,
        ...(email.html ? { htmlContent: email.html } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BrevoSendError("Brevo did not confirm the result. Check your Brevo transactional logs before retrying; the email may already have been sent.", "uncertain");
  }
  if (!response.ok) {
    const known: Record<number, string> = {
      400: "Brevo rejected the email. Check the sender/domain verification and recipient address in Brevo.",
      401: "Brevo rejected the API key. Replace it in Email settings.",
      402: "Brevo email credits are unavailable. Check your Brevo plan.",
      403: "Brevo denied sending. Check account permissions and your approved sender/domain.",
      429: "Brevo is rate limiting emails. Wait before trying again.",
    };
    throw new BrevoSendError(known[response.status] ?? "Brevo did not confirm acceptance. Check your transactional logs before retrying.", response.status >= 400 && response.status < 500 ? "failed" : "uncertain");
  }
  const result = z.object({ messageId: z.string().min(1) }).safeParse(await response.json().catch(() => null));
  if (!result.success) throw new BrevoSendError("Brevo returned no message ID. Delivery is uncertain; check your transactional logs before retrying.", "uncertain");
  return result.data.messageId;
}
