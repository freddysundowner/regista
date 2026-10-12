import { Link } from "wouter";
import { useListStudents, getListStudentsQueryKey, StudentStatus } from "@workspace/api-client-react";
import { ArrowRight, UserPlus } from "lucide-react";

const ACTIVE = { status: StudentStatus.active };

/** Whether the school has at least one active learner; null while loading. */
export function useHasLearners() {
  const q = useListStudents(ACTIVE, { query: { queryKey: getListStudentsQueryKey(ACTIVE), staleTime: 15_000 } });
  return q.isLoading ? null : (q.data?.length ?? 0) > 0;
}

/** Billing needs learners: explain why nothing can be invoiced yet, and go straight to adding one. */
export function NoLearnersNotice({ onGo }: { onGo?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="no-learners-notice">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><UserPlus className="h-6 w-6" /></span>
      <h3 className="text-lg font-semibold">Add a learner first</h3>
      <p className="max-w-md text-sm text-muted-foreground">Invoices are made for each learner, so there's nothing to bill yet. Add at least one learner on the Register, then come back to generate this term's invoices.</p>
      <Link href="/students" onClick={onGo} data-testid="link-add-learners"
        className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Add learners<ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
