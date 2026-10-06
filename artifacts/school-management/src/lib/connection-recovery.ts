/** Only failed reads may retry. Never replay a mutation whose result is unknown. */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string; status?: number };
  if ([502, 503, 504].includes(e.status ?? 0)) return true;
  return e.name === "TypeError" && /failed to fetch|load failed|networkerror|network request failed/i.test(e.message ?? "");
}

export function retryRead(failures: number, error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status && status >= 400 && status < 500) return false;
  return failures < (isConnectionFailure(error) ? 3 : 1);
}
