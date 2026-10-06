import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReviewSchoolRegistration, useListPlatformAdmins, getListPlatformAdminsQueryKey, getListPlatformSchoolsQueryKey, getGetPlatformSchoolQueryKey, getGetPlatformOverviewQueryKey, getListPlatformAuditQueryKey, type School } from "@workspace/api-client-react";
import { Check, Loader2, X } from "lucide-react";
import { Field, FormError, FormActions, Btn } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function RegistrationReviewDialog({ school, open, onOpenChange, initial = "approve" }: { school: School | null; open: boolean; onOpenChange: (o: boolean) => void; initial?: "approve" | "reject" }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={`Review ${school?.name ?? "registration"}`} testid="dialog-review-registration"
      description="Approving opens the workspace for its administrator. Rejecting keeps it closed and shows them your reason.">
      {school && <ReviewForm key={school.id + initial} school={school} initial={initial} onDone={() => onOpenChange(false)} />}
    </FormDialog>
  );
}

function ReviewForm({ school, initial, onDone }: { school: School; initial: "approve" | "reject"; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const admins = useListPlatformAdmins(school.id, { query: { queryKey: getListPlatformAdminsQueryKey(school.id) } });
  const [decision, setDecision] = useState<"approve" | "reject">(school.status === "rejected" ? "approve" : initial);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useReviewSchoolRegistration();

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = reason.trim();
    if (decision === "reject" && r.length < 3) return setErr("A reason of at least 3 characters is required to reject. The applicant sees it.");
    if (r && r.length < 3) return setErr("If you add a note, make it at least 3 characters, or leave it empty.");
    if (r.length > 500) return setErr("Keep the reason under 500 characters.");
    m.mutate({ schoolId: school.id, data: { decision, ...(r ? { reason: r } : {}) } }, {
      onSuccess: (s) => {
        qc.setQueryData(getGetPlatformSchoolQueryKey(school.id), s);
        void qc.invalidateQueries({ queryKey: getListPlatformSchoolsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetPlatformSchoolQueryKey(school.id) });
        void qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey() });
        void qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey().slice(0, 1) });
        toast({ title: decision === "approve" ? `${school.name} approved` : `${school.name} rejected` });
        onDone();
      },
      onError: (x) => setErr(errMsg(x, "Review failed")),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Applicant</div>
        {admins.isLoading ? <div className="mt-1 h-4 w-40 animate-pulse rounded bg-muted" /> : admins.isError ? <p className="mt-1 text-xs text-destructive">{errMsg(admins.error, "Could not load applicant.")}</p>
          : admins.data?.length ? admins.data.map((a) => <div key={a.id} className="mt-1"><span className="font-semibold">{a.name}</span> <span className="text-muted-foreground">{a.email ?? a.phone ?? ""}</span></div>)
          : <p className="mt-1 text-xs text-muted-foreground">No administrator account found.</p>}
        <div className="mt-2 text-xs capitalize text-muted-foreground">{school.type} · code <span className="font-mono normal-case">{school.code}</span></div>
        {school.status === "rejected" && school.registrationNote && <p className="mt-2 text-xs text-muted-foreground">Previously rejected: {school.registrationNote}</p>}
      </div>
      <div role="radiogroup" aria-label="Decision" className="grid grid-cols-2 gap-2">
        {([["approve", "Approve", Check], ["reject", "Reject", X]] as const).filter(([v]) => !(v === "reject" && school.status === "rejected")).map(([v, t, I]) => (
          <button key={v} type="button" role="radio" aria-checked={decision === v} data-testid={`radio-decision-${v}`} onClick={() => setDecision(v)}
            className={cn("flex items-center gap-2 rounded-md border p-3 text-sm font-semibold transition", decision === v ? (v === "approve" ? "border-primary bg-primary/5" : "border-destructive bg-destructive/5 text-destructive") : "border-border hover:bg-muted/50")}>
            <I className="h-4 w-4" />{t}
          </button>
        ))}
      </div>
      <Field label={decision === "reject" ? "Reason" : "Note (optional)"} required={decision === "reject"} hint={decision === "reject" ? "3 to 500 characters. Shown to the applicant and recorded in the audit log." : "Recorded in the audit log."}>
        <textarea data-testid="input-review-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-primary focus:bg-card focus:ring-2 focus:ring-ring/20" />
      </Field>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-submit-review" type="submit" variant={decision === "reject" ? "danger" : "primary"} disabled={m.isPending}>
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : decision === "approve" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{decision === "approve" ? "Approve school" : "Reject registration"}
        </Btn>
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </FormActions>
    </form>
  );
}
