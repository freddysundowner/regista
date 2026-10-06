import { z } from "zod";
import { ApiError } from "../core";

const connectionResponse = z.object({
  status: z.string().min(1),
  externalConnectionId: z.string().optional(),
  displayPhoneNumber: z.string().optional(),
});

/** A read-only provider check. Never submits a message or reconnects a number. */
export async function checkLeadsIntelConnection(
  credentials: Record<string, string>, connectionId: string,
) {
  if (!credentials.platformKey || !credentials.tenantId || !connectionId) {
    throw new ApiError(503, "LeadsIntel platform key, tenant ID and connection ID are required.");
  }
  let response: Response;
  try {
    response = await fetch(`https://app.leadsintel.net/api/external-platform/whatsapp/connections/${encodeURIComponent(credentials.tenantId)}/${encodeURIComponent(connectionId)}`, {
      headers: { Authorization: `Bearer ${credentials.platformKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(503, "Could not reach LeadsIntel. No message was sent; try checking again later.");
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "LeadsIntel rejected the platform key.",
      404: "LeadsIntel could not find this connection under the saved account.",
      409: "The LeadsIntel connection is inactive.",
      429: "LeadsIntel is rate limiting connection checks. Try again later.",
    };
    throw new ApiError(503, messages[response.status] ?? "LeadsIntel could not confirm the connection. Try again later.");
  }
  const parsed = connectionResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success || (parsed.data.externalConnectionId && parsed.data.externalConnectionId !== connectionId)) {
    throw new ApiError(503, "LeadsIntel returned an unexpected connection response.");
  }
  return { status: parsed.data.status, displayPhoneNumber: parsed.data.displayPhoneNumber, checkedAt: new Date().toISOString() };
}
