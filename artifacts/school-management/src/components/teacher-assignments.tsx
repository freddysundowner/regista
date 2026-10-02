import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListTeacherAssignments, useCreateTeacherAssignment, useDeleteTeacherAssignment, useListUsers, useListStreams, getListTeacherAssignmentsQueryKey, getListUsersQueryKey, getListStreamsQueryKey, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { Panel, SkeletonRows, ErrorState, Empty, Btn, Field, NativeSelect, FormError, FormActions } from "@/components/kit";
import { ROLE_LABEL, errMsg } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

/** Admin-only: grants teachers read access to a stream. Independent of the class teacher field. */
export function TeacherAssignmentsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListTeacherAssignments({ query: { queryKey: getListTeacherAssignmentsQueryKey() } });
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const create = useCreateTeacherAssignment();
  const del = useDeleteTeacherAssignment();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ userId: "", streamId: "" });
  const [err, setErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const teachers = (users.data ?? []).filter((u) => u.isActive && (u.role === "teacher" || u.role === "class_teacher"));
  const inv = () => { qc.invalidateQueries({ queryKey: getListTeacherAssignmentsQueryKey() }); qc.invalidateQueries({ queryKey: getListAuditLogsQueryKey() }); };
  const dup = !!q.data?.some((a) => a.userId === f.userId && a.streamId === f.streamId);

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.userId || !f.streamId) return setErr("Choose a teacher and a stream.");
    if (dup) return setErr("That teacher is already assigned to this stream.");
    create.mutate({ data: f }, {
      onSuccess: (a) => { inv(); toast({ title: "Assignment added", description: `${a.userName} · ${a.gradeName} ${a.streamName}` }); setF({ userId: "", streamId: "" }); setAdding(false); },
      onError: (x) => setErr(errMsg(x)),
    });
  };

  return (
    <Panel title="Teacher stream assignments" note="Gives a teacher read access to a stream's learners. Separate from the class teacher; subjects come later."
      action={!adding ? <Btn variant="outline" className="h-8" data-testid="button-new-assignment" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Assign</Btn> : undefined}>
      {adding && (
        <form onSubmit={submit} className="space-y-4 border-b border-border/70 bg-accent/20 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teacher" required><NativeSelect data-testid="select-assignment-teacher" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">{users.isLoading ? "Loading staff" : teachers.length ? "Select teacher" : "No active teachers"}</option>{teachers.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]})</option>)}</NativeSelect></Field>
            <Field label="Stream" required><NativeSelect data-testid="select-assignment-stream" value={f.streamId} onChange={(e) => setF({ ...f, streamId: e.target.value })}><option value="">{streams.isLoading ? "Loading streams" : "Select stream"}</option>{streams.data?.map((s) => <option key={s.id} value={s.id}>{s.gradeName} · {s.name}</option>)}</NativeSelect></Field>
          </div>
          <FormError msg={err || (users.isError ? errMsg(users.error) : streams.isError ? errMsg(streams.error) : null)} />
          <FormActions>
            <Btn type="submit" data-testid="button-save-assignment" disabled={create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save assignment</Btn>
            <Btn type="button" variant="ghost" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Btn>
          </FormActions>
        </form>
      )}
      {q.isLoading ? <SkeletonRows rows={3} cols={3} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Layers className="h-5 w-5" />} title="No assignments yet" body="Teachers without assignments only see streams where they are class teacher." /> : (
        <ul className="divide-y divide-border/60">{q.data.map((a) => (
          <li key={a.id} data-testid={`row-assignment-${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-[8rem] flex-1 font-semibold">{a.userName}</span>
            <span className="text-foreground/80">{a.gradeName} · {a.streamName}</span>
            {confirmId === a.id ? (
              <span className="flex items-center gap-1">
                <Btn variant="danger" className="h-7 px-2 text-xs" data-testid={`button-confirm-remove-assignment-${a.id}`} disabled={del.isPending}
                  onClick={() => del.mutate({ assignmentId: a.id }, { onSuccess: () => { inv(); setConfirmId(null); toast({ title: "Assignment removed" }); }, onError: (x) => toast({ title: "Could not remove", description: errMsg(x), variant: "destructive" }) })}>Confirm remove</Btn>
                <Btn variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmId(null)}>Keep</Btn>
              </span>
            ) : <button data-testid={`button-remove-assignment-${a.id}`} aria-label={`Remove ${a.userName} from ${a.gradeName} ${a.streamName}`} onClick={() => setConfirmId(a.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
          </li>
        ))}</ul>
      )}
    </Panel>
  );
}
