import { useGetInstallation, getGetInstallationQueryKey } from "@workspace/api-client-react";

/** Deployment mode rarely changes; cached for the session and refreshed after a licence install. */
export function useInstallation() {
  const q = useGetInstallation({ query: { queryKey: getGetInstallationQueryKey(), staleTime: 5 * 60_000, retry: 2 } });
  const data = q.data;
  const standalone = data?.mode === "standalone";
  return {
    query: q,
    standalone,
    hosted: data ? data.mode === "hosted" : true,
    licensed: standalone && data?.licensing === "licensed",
    licence: data?.licence ?? null,
  };
}
