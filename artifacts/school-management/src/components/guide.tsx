import { useGetOnboarding, getGetOnboardingQueryKey, type Onboarding } from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/session";

/** The setup guide is for a school's own administrators, not platform support sessions. */
function useGuideEnabled() {
  const s = useAuthSession();
  return s.mode === "tenant" && !s.tenantAccess && (s.user.role === "school_admin" || s.user.role === "principal");
}
export function useOnboarding() {
  const enabled = useGuideEnabled();
  const q = useGetOnboarding({ query: { queryKey: getGetOnboardingQueryKey(), enabled, refetchOnWindowFocus: true, staleTime: 5_000,
    refetchInterval: (query) => query.state.data && !finished(query.state.data) ? 20_000 : false } });
  const data = enabled ? q.data : undefined;
  const open = data ? data.steps.filter((x) => !x.done && !x.skipped) : [];
  return { data, enabled, current: open[0] ?? null, doneCount: data ? data.steps.filter((x) => x.done).length : 0, total: data?.steps.length ?? 0 };
}
const finished = (d: Onboarding) => d.steps.every((x) => x.done || x.skipped);
