import { useState, type FormEvent } from "react";
import { useListGrades, useListStreams, getListGradesQueryKey, getListStreamsQueryKey, StudentStatus, BoardingStatus, type Student, type StudentInputGender } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Field, TextInput, NativeSelect, FormError, Btn, FormActions } from "@/components/kit";
import { blank, nairobiToday } from "@/lib/session";

export type StudentFormValues = {
  admissionNo: string; firstName: string; middleName: string; lastName: string; gender: string; dateOfBirth: string;
  gradeId: string; streamId: string; status: StudentStatus; boardingStatus: BoardingStatus; admissionDate: string; upi: string;
  pathway: string; transportRouteId: string; gName: string; gPhone: string; gRelationship: string;
};

export function toPayload(v: StudentFormValues) {
  return {
    admissionNo: v.admissionNo.trim(), firstName: v.firstName.trim(), middleName: blank(v.middleName), lastName: v.lastName.trim(),
    gender: (v.gender || null) as StudentInputGender, dateOfBirth: blank(v.dateOfBirth), gradeId: blank(v.gradeId), streamId: blank(v.streamId),
    status: v.status, boardingStatus: v.boardingStatus, admissionDate: blank(v.admissionDate), upi: blank(v.upi),
    pathway: blank(v.pathway), transportRouteId: blank(v.transportRouteId),
  };
}

export function fromStudent(s?: Student): StudentFormValues {
  return {
    admissionNo: s?.admissionNo ?? "", firstName: s?.firstName ?? "", middleName: s?.middleName ?? "", lastName: s?.lastName ?? "",
    gender: s?.gender ?? "", dateOfBirth: s?.dateOfBirth?.slice(0, 10) ?? "", gradeId: s?.gradeId ?? "", streamId: s?.streamId ?? "",
    status: s?.status ?? "active", boardingStatus: s?.boardingStatus ?? "day", admissionDate: s?.admissionDate?.slice(0, 10) ?? nairobiToday(),
    upi: s?.upi ?? "", pathway: s?.pathway ?? "", transportRouteId: s?.transportRouteId ?? "", gName: "", gPhone: "", gRelationship: "Mother",
  };
}

export function StudentForm({ initial, withGuardian, submitLabel, pending, error, onSubmit, onCancel }: {
  initial: StudentFormValues; withGuardian?: boolean; submitLabel: string; pending: boolean; error?: string | null;
  onSubmit: (v: StudentFormValues) => void; onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  const streams = useListStreams(v.gradeId ? { gradeId: v.gradeId } : undefined, { query: { queryKey: getListStreamsQueryKey(v.gradeId ? { gradeId: v.gradeId } : undefined), enabled: !!v.gradeId } });
  const set = (k: keyof StudentFormValues) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value, ...(k === "gradeId" ? { streamId: "" } : {}) }));
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(v); };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Admission no." required><TextInput data-testid="input-admission-no" required className="font-mono" value={v.admissionNo} onChange={set("admissionNo")} placeholder="ADM/2025/014" /></Field>
        <Field label="First name" required><TextInput data-testid="input-first-name" required value={v.firstName} onChange={set("firstName")} /></Field>
        <Field label="Middle name"><TextInput data-testid="input-middle-name" value={v.middleName} onChange={set("middleName")} /></Field>
        <Field label="Last name" required><TextInput data-testid="input-last-name" required value={v.lastName} onChange={set("lastName")} /></Field>
        <Field label="Gender"><NativeSelect data-testid="select-gender" value={v.gender} onChange={set("gender")}><option value="">Not set</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></NativeSelect></Field>
        <Field label="Date of birth"><TextInput data-testid="input-dob" type="date" value={v.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        <Field label="Grade"><NativeSelect data-testid="select-grade" value={v.gradeId} onChange={set("gradeId")}><option value="">Unassigned</option>{grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect></Field>
        <Field label="Stream"><NativeSelect data-testid="select-stream" disabled={!v.gradeId} value={v.streamId} onChange={set("streamId")}><option value="">{v.gradeId ? "No stream" : "Pick grade first"}</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
        <Field label="Boarding"><NativeSelect data-testid="select-boarding" value={v.boardingStatus} onChange={set("boardingStatus")}>{Object.values(BoardingStatus).map((b) => <option key={b} value={b}>{b === "day" ? "Day scholar" : "Boarder"}</option>)}</NativeSelect></Field>
        <Field label="Status"><NativeSelect data-testid="select-status" value={v.status} onChange={set("status")}>{Object.values(StudentStatus).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</NativeSelect></Field>
        <Field label="Admission date"><TextInput data-testid="input-admission-date" type="date" value={v.admissionDate} onChange={set("admissionDate")} /></Field>
        <Field label="UPI" hint="NEMIS unique personal identifier"><TextInput data-testid="input-upi" className="font-mono" value={v.upi} onChange={set("upi")} /></Field>
        <Field label="Pathway" hint="Senior school CBC pathway, if any"><TextInput data-testid="input-pathway" maxLength={100} value={v.pathway} onChange={set("pathway")} placeholder="STEM" /></Field>
        <Field label="Transport route ref." hint="Optional route code"><TextInput data-testid="input-transport-route" maxLength={100} className="font-mono" value={v.transportRouteId} onChange={set("transportRouteId")} /></Field>
      </div>
      {withGuardian && (
        <>
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>Primary guardian</span><span className="h-px flex-1 bg-border" /><span className="normal-case tracking-normal font-normal">Optional · matching phone numbers link siblings</span></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Guardian name"><TextInput data-testid="input-guardian-name" value={v.gName} onChange={set("gName")} /></Field>
            <Field label="Phone"><TextInput data-testid="input-guardian-phone" type="tel" value={v.gPhone} onChange={set("gPhone")} placeholder="0712 345 678" /></Field>
            <Field label="Relationship"><NativeSelect data-testid="select-guardian-rel" value={v.gRelationship} onChange={set("gRelationship")}>{["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Other"].map((r) => <option key={r}>{r}</option>)}</NativeSelect></Field>
          </div>
        </>
      )}
      <FormError msg={error} />
      <FormActions>
        <Btn data-testid="button-save-student" type="submit" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}</Btn>
        {onCancel && <Btn data-testid="button-cancel" type="button" variant="ghost" onClick={onCancel}>Cancel</Btn>}
      </FormActions>
    </form>
  );
}
