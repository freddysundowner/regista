import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEnterTenantAccess, useExitTenantAccess, type School } from "@workspace/api-client-react";
import { DoorOpen, Eye, Loader2, LogOut, PenLine, ShieldAlert, TimerOff } from "lucide-react";
import { Field, TextInput, NativeSelect, FormError, FormActions, Btn } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { useAuthSession, errMsg, fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * Crossing a tenant boundary: cancel in-flight requests, drop every cached
 * query, then load a fresh document so no mounted observer, draft or form
 * state from the previous workspace survives.
 */
export async function hardReset(qc: QueryClient) {
  await qc.cancelQueries();
  qc.clear();
  window.location.replace(import.meta.env.BASE_URL);
}

export type Confirm = { reason: string; confirm: string };
export const EMPTY_CONFIRM: Confirm = { reason: "", confirm: "" };

export function confirmError(c: Confirm) {
  const r = c.reason.trim();
  if (r.length < 3) return "Give a reason of at least 3 characters. It is recorded in the platform audit log.";
  if (r.length > 500) return "Keep the reason under 500 characters.";
  if (c.confirm !== "CONFIRM") return "Type CONFIRM in capitals to proceed.";
  return null;
}

export function confirmBody(c: Confirm) {
  return { reason: c.reason.trim(), confirmation: "CONFIRM" as const };
}

export function ConfirmFields({ value, onChange, prefix }: { value: Confirm; onChange: (c: Confirm) => void; prefix: string }) {
  return (
    <div className="space-y-3 rounded-md border border-amber-700/25 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800"><ShieldAlert className="h-3.5 w-3.5" />Audited platform action</div>
      <Field label="Reason" required hint="3 to 500 characters; stored with the audit entry">
        <textarea data-testid={`input-${prefix}-reason`} required minLength={3} maxLength={500} rows={2} value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })}
          className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-primary focus:bg-card focus:ring-2 focus:ring-ring/20" />
      </Field>
      <Field label='Type "CONFIRM"' required>
        <TextInput data-testid={`input-${prefix}-confirm`} autoComplete="off" className="font-mono tracking-widest" value={value.confirm} onChange={(e) => onChange({ ...value, confirm: e.target.value })} placeholder="CONFIRM" />
      </Field>
    </div>
  );
}

const DURATIONS = [15, 30, 60, 90, 120];

export function EnterSchoolDialog({ school, open, onOpenChange }: { school: School | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const session = useAuthSession();
  const m = useEnterTenantAccess();
  const [write, setWrite] = useState(false);
  const [mins, setMins] = useState(30);
  const [c, setC] = useState(EMPTY_CONFIRM);
  const [err, setErr] = useState<string | null>(null);
  const blockedByGrant = session.mode === "tenant";
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!school) return;
    const ce = confirmError(c); if (ce) return setErr(ce);
    m.mutate({ data: { schoolId: school.id, writeEnabled: write, durationMinutes: mins, ...confirmBody(c) } }, {
      onSuccess: () => { void hardReset(qc); },
      onError: (x) => setErr(errMsg(x, "Could not open the school workspace")),
    });
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} busy={m.isPending || m.isSuccess} title={`Enter ${school?.name ?? "school"}`} testid="dialog-enter-school"
      description="Opens a time-limited support session inside this school. Every action is attributed to you and the grant.">
      <form onSubmit={submit} className="space-y-5 p-5">
        {school?.status === "suspended" && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">This school is suspended. The server may refuse the grant; you can always exit back to the platform.</div>}
        <div role="radiogroup" aria-label="Access level" className="grid gap-2 sm:grid-cols-2">
          {[{ v: false, t: "Read-only", d: "View records. Saves, imports and document generation are blocked.", I: Eye }, { v: true, t: "Write access", d: "Make changes as this school. Use only when the school asked for it.", I: PenLine }].map((o) => (
            <button key={o.t} type="button" role="radio" aria-checked={write === o.v} data-testid={`radio-access-${o.v ? "write" : "readonly"}`} onClick={() => setWrite(o.v)}
              className={cn("rounded-md border p-3 text-left transition", write === o.v ? (o.v ? "border-amber-600 bg-amber-500/10" : "border-primary bg-primary/5") : "border-border hover:bg-muted/50")}>
              <div className="flex items-center gap-2 text-sm font-semibold"><o.I className="h-4 w-4" />{o.t}{!o.v && <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">Default</span>}</div>
              <p className="mt-1 text-xs text-muted-foreground">{o.d}</p>
            </button>
          ))}
        </div>
        <Field label="Expires after" hint="Between 5 and 120 minutes. Exit any time.">
          <NativeSelect data-testid="select-access-duration" value={mins} onChange={(e) => setMins(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}</NativeSelect>
        </Field>
        <ConfirmFields value={c} onChange={setC} prefix="access" />
        {blockedByGrant && <FormError msg="You are already inside a school workspace. Exit to the platform first." />}
        <FormError msg={err} />
        <FormActions>
          <Btn data-testid="button-enter-school" type="submit" disabled={m.isPending || m.isSuccess || blockedByGrant}>{m.isPending || m.isSuccess ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}Enter {write ? "with write access" : "read-only"}</Btn>
          <Btn type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Btn>
        </FormActions>
      </form>
    </FormDialog>
  );
}

export function useExitToPlatform() {
  const qc = useQueryClient();
  const m = useExitTenantAccess({ mutation: { onSuccess: () => { void hardReset(qc); } } });
  return m;
}

function useNow(ms = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Prominent workspace banner shown whenever a platform owner is inside a school. */
export function TenantAccessBanner() {
  const { tenantAccess, school, mode } = useAuthSession();
  const exit = useExitToPlatform();
  const now = useNow();
  if (mode !== "tenant" || !tenantAccess) return null;
  const left = Math.round((new Date(tenantAccess.expiresAt).getTime() - now) / 60000);
  const expired = left <= 0;
  const suspended = school?.status === "suspended";
  const ro = !tenantAccess.writeEnabled;
  return (
    <div role="status" data-testid="banner-tenant-access"
      className={cn("sticky top-0 z-[25] border-b px-4 py-2.5 text-sm md:top-0",
        expired || suspended ? "border-destructive/40 bg-destructive text-destructive-foreground" : ro ? "border-sidebar-border bg-sidebar text-sidebar-accent-foreground" : "border-amber-800/40 bg-amber-600 text-amber-50")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2 font-semibold">
          {expired ? <TimerOff className="h-4 w-4" /> : ro ? <Eye className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
          <span data-testid="text-access-mode">{expired ? "Support grant expired" : suspended ? "School suspended" : ro ? "Read-only support access" : "Write support access"}</span>
        </span>
        <span className="min-w-0 truncate opacity-90"><span className="font-semibold">{school?.name ?? "School"}</span> · {expired ? "Exit to start a new grant." : `ends ${fmtDateTime(tenantAccess.expiresAt)} (${left} min)`}</span>
        <span className="hidden min-w-0 max-w-sm truncate text-xs opacity-75 lg:inline" title={tenantAccess.reason}>Reason: {tenantAccess.reason}</span>
        {ro && !expired && <span className="text-xs opacity-80">Changes are disabled in this session.</span>}
        <button type="button" data-testid="button-exit-tenant" onClick={() => exit.mutate()} disabled={exit.isPending || exit.isSuccess}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-background/95 px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-background disabled:opacity-60">
          {exit.isPending || exit.isSuccess ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}Exit to platform
        </button>
      </div>
      {exit.isError && <div role="alert" className="pt-1 text-xs">{errMsg(exit.error, "Exit failed.")} Retry, or sign out from the account menu.</div>}
    </div>
  );
}

/** Recovery link for error screens when a grant expired or a school is suspended. */
export function PlatformRecovery() {
  const exit = useExitToPlatform();
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <Btn data-testid="button-recover-platform" variant="outline" onClick={() => exit.mutate()} disabled={exit.isPending || exit.isSuccess}>
        {exit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}Return to platform console
      </Btn>
      {exit.isError && <p className="text-xs text-muted-foreground">{errMsg(exit.error, "Could not exit.")}</p>}
    </div>
  );
}
