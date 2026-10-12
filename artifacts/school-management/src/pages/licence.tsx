import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInstallLicence, getGetInstallationQueryKey } from "@workspace/api-client-react";
import { BadgeCheck, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader, Panel, Btn, FormError, Pill } from "@/components/kit";
import { useInstallation } from "@/lib/installation";
import { errMsg, fmtDateTime } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";

const STATUS_TEXT: Record<string, string> = {
  active: "Licensed", expired: "Expired", missing: "No licence installed", invalid: "Licence not valid", unconfigured: "Server not set up for licences",
};

export default function LicencePage() {
  usePageTitle("Licence");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { licence, licensed } = useInstallation();
  const install = useInstallLicence();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!licensed) return <Panel><p className="px-5 py-6 text-sm text-muted-foreground">This installation does not use a licence.</p></Panel>;
  const ok = licence?.status === "active";
  const submit = () => {
    setErr(null);
    install.mutate({ data: { licence: text.trim() } }, {
      onSuccess: (d) => { qc.setQueryData(getGetInstallationQueryKey(), d); setText(""); toast({ title: "Licence installed", description: d.licence?.expiresAt ? `Valid until ${fmtDateTime(d.licence.expiresAt)}.` : "No expiry." }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Installation" title="Licence" meta={<Pill tone={ok ? "active" : "error"}>{STATUS_TEXT[licence?.status ?? "missing"]}</Pill>} />
      <div className={`flex items-start gap-4 rounded-xl border p-5 ${ok ? "border-primary/25 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`} data-testid="licence-status">
        {ok ? <BadgeCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" /> : <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />}
        <div className="min-w-0 text-sm">
          {licence?.schoolName && <div className="text-lg font-semibold">{licence.schoolName}</div>}
          <p className="mt-1 text-muted-foreground">
            {ok ? <>{licence!.expiresAt ? `Valid until ${fmtDateTime(licence!.expiresAt)}` : "No expiry"} · {licence!.maxLearners ? `up to ${licence!.maxLearners.toLocaleString()} active learners` : "unlimited learners"}.</>
              : licence?.status === "expired" ? `This licence expired ${fmtDateTime(licence.expiresAt!)}. Staff can't use the system until a renewed licence is installed.`
              : licence?.status === "unconfigured" ? "This server is missing its LICENCE_PUBLIC_KEY setting. Ask whoever installed Rejista to add it."
              : "Paste the licence from your Rejista provider below to activate this installation."}
          </p>
        </div>
      </div>
      <Panel title={ok ? "Replace licence" : "Install licence"} note="Paste the full licence text, starting with RJL1. It's checked on this server; no internet connection is needed.">
        <div className="space-y-3 p-5">
          <textarea data-testid="input-install-licence" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="RJL1.…" spellCheck={false}
            className="w-full break-all rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
          <FormError msg={err} />
          <Btn data-testid="button-install-licence" disabled={text.trim().length < 20 || install.isPending} onClick={submit}>{install.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Install licence</Btn>
        </div>
      </Panel>
    </div>
  );
}
