import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChangeOwnPassword, useListTeacherAssignments, getListTeacherAssignmentsQueryKey, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { KeyRound, Layers, Loader2 } from "lucide-react";
import { PageHeader, Panel, Field, TextInput, FormError, FormActions, Btn, SkeletonRows, ErrorState, Empty } from "@/components/kit";
import { useSession, usePerms, ROLE_LABEL, errMsg, fmtDateTime } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

function PasswordForm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useChangeOwnPassword();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.next.length < 10) return setErr("New password must be at least 10 characters.");
    if (f.next !== f.confirm) return setErr("New passwords do not match.");
    if (f.next === f.current) return setErr("Choose a password different from the current one.");
    m.mutate({ data: { currentPassword: f.current, newPassword: f.next } }, {
      onSuccess: (r) => {
        setF({ current: "", next: "", confirm: "" });
        qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        toast({ title: "Password changed", description: r.message || "Other devices have been signed out." });
      },
      onError: (x) => setErr(errMsg(x, "Could not change password")),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password" required><TextInput data-testid="input-current-password" type="password" autoComplete="current-password" required maxLength={128} value={f.current} onChange={set("current")} /></Field>
        <Field label="New password" required hint="At least 10 characters"><TextInput data-testid="input-new-password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={f.next} onChange={set("next")} /></Field>
        <Field label="Confirm new password" required><TextInput data-testid="input-confirm-password" type="password" autoComplete="new-password" required value={f.confirm} onChange={set("confirm")} /></Field>
      </div>
      <FormError msg={err} />
      <FormActions>
        <Btn data-testid="button-change-password" type="submit" disabled={m.isPending}>{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Change password</Btn>
        <span className="text-xs text-muted-foreground">You stay signed in here; every other device is signed out.</span>
      </FormActions>
    </form>
  );
}

function MyStreams() {
  const q = useListTeacherAssignments({ query: { queryKey: getListTeacherAssignmentsQueryKey() } });
  if (q.isLoading) return <SkeletonRows rows={2} cols={2} />;
  if (q.isError) return <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <Empty icon={<Layers className="h-5 w-5" />} title="No streams assigned" body="Ask your school administrator to assign you to the streams you teach." />;
  return (
    <ul className="divide-y divide-border/60">{q.data.map((a) => (
      <li key={a.id} data-testid={`row-my-assignment-${a.id}`} className="flex items-center justify-between px-5 py-3 text-sm"><span className="font-semibold">{a.gradeName} · {a.streamName}</span><span className="text-xs text-muted-foreground">Read access to learners</span></li>
    ))}</ul>
  );
}

export default function Account() {
  const { user, school } = useSession();
  const p = usePerms();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Your account" title={user.name} meta={<span data-testid="text-account-meta">{ROLE_LABEL[user.role]} at {school.name} · Last sign-in {fmtDateTime(user.lastLoginAt)} (Nairobi)</span>} />
      <Panel className="max-w-3xl" title="Change password"><PasswordForm /></Panel>
      {p.limitedToAssigned && <Panel className="max-w-3xl" title="My streams" note="Streams you can view as a teacher."><MyStreams /></Panel>}
    </div>
  );
}
