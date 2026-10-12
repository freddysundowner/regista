import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetStudentRemoval, useRemoveStudent, getGetStudentRemovalQueryKey, type Student } from "@workspace/api-client-react";
import { Loader2, Trash2 } from "lucide-react";
import { Btn, Field, TextInput, FormError, FormActions, SkeletonRows } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Admin-only. Shows exactly what goes before anything is erased, and asks for the admission number to confirm. */
/** With `open`/`onOpenChange` the dialog is opened from elsewhere (e.g. a menu) and no button is shown. */
export function RemoveLearner({ student, open: openProp, onOpenChange }: { student: Student; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (o: boolean) => { if (controlled) onOpenChange?.(o); else setOpenState(o); };
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const plan = useGetStudentRemoval(student.id, { query: { queryKey: getGetStudentRemovalQueryKey(student.id), enabled: open, staleTime: 0 } });
  const remove = useRemoveStudent();
  const d = plan.data;
  const keep = d?.mode === "anonymize";
  const matches = typed.trim().toUpperCase() === student.admissionNo.trim().toUpperCase();
  const close = () => { if (remove.isPending) return; setOpen(false); setTyped(""); setErr(null); };

  const gone = d ? [
    `Name, admission no. ${student.admissionNo}, date of birth, UPI, photo and class`,
    d.attendance && `${plural(d.attendance, "attendance record")}`,
    d.marks && `${plural(d.marks, "mark")}`,
    d.ratings && `${plural(d.ratings, "rating")}`,
    d.reportCards && `${plural(d.reportCards, "report card")}`,
    d.files && `${plural(d.files, "file")} (photo, report cards, exports)`,
    d.guardiansRemoved && `${plural(d.guardiansRemoved, "guardian")} linked only to this learner`,
    keep && "Payer names and phone numbers, receipts and statements",
    "Their name in messages and the audit log",
  ].filter(Boolean) as string[] : [];

  return (
    <>
      {!controlled && <Btn variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid="button-remove-student" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" /> Delete learner</Btn>}
      <FormDialog open={open} onOpenChange={(o) => { if (!o) close(); }} busy={remove.isPending} title={`Delete ${student.fullName}?`}
        description={keep ? "Everything about this learner is erased permanently. Their fee amounts stay, with no name or admission number attached, so the school's totals still add up. This cannot be undone." : "Everything about this learner is erased permanently. This cannot be undone."}>
        <div className="space-y-4 p-5">
          {plan.isLoading ? <SkeletonRows rows={3} cols={1} /> : plan.isError ? <FormError msg={errMsg(plan.error)} /> : d && <>
            <div>
              <p className="mb-1.5 text-sm font-medium">Will be erased</p>
              <ul className="space-y-1 text-sm text-muted-foreground" data-testid="removal-erased">{gone.map((g) => <li key={g} className="flex gap-2"><span className="text-destructive">✕</span>{g}</li>)}</ul>
            </div>
            {(keep || d.guardiansKept > 0) && <div>
              <p className="mb-1.5 text-sm font-medium">Will stay</p>
              <ul className="space-y-1 text-sm text-muted-foreground" data-testid="removal-kept">
                {keep && <li className="flex gap-2"><span>•</span>The amounts of {plural(d.financeRecords, "fee or payment record")}, under an anonymous “Deleted learner” entry, so totals and bank reconciliation still add up</li>}
                {d.guardiansKept > 0 && <li className="flex gap-2"><span>•</span>{plural(d.guardiansKept, "guardian")} shared with a sibling (only unlinked from this learner)</li>}
              </ul>
            </div>}
            <Field label={`Type ${student.admissionNo} to confirm`}><TextInput data-testid="input-confirm-admission" className="font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
          </>}
          <FormError msg={err} />
          <FormActions>
            <Btn variant="danger" data-testid="button-confirm-remove-student" disabled={!d || !matches || remove.isPending} onClick={() => {
              setErr(null);
              remove.mutate({ studentId: student.id, data: { confirmAdmissionNo: typed } }, {
                onSuccess: (r) => {
                  // Learner data shows up across the app; refresh everything rather than chase each list.
                  void qc.invalidateQueries();
                  toast({ title: `${r.name} deleted`, description: r.mode === "delete" ? "The learner and all their records are gone." : "All their details are gone. Fee amounts stay anonymously so totals still add up." });
                  navigate("/students");
                },
                onError: (x) => setErr(errMsg(x)),
              });
            }}>{remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Delete permanently</Btn>
            <Btn variant="ghost" onClick={close} disabled={remove.isPending}>Cancel</Btn>
          </FormActions>
        </div>
      </FormDialog>
    </>
  );
}
