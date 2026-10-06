import { changeRows, displayValue } from "@/lib/audit-format";

export function AuditChanges({ before, after }: { before?: unknown; after?: unknown }) {
  const rows = changeRows(before, after);
  if (!rows.length) return <p className="text-sm text-muted-foreground">{before == null && after == null ? "This event was recorded without field-level details." : "No descriptive field changes were recorded. Technical details are available below."}</p>;
  const updating = before != null && after != null;
  return <section className="space-y-2">
    <h3 className="text-sm font-semibold">{updating ? "What changed" : after != null ? "Recorded details" : "Removed details"}</h3>
    <dl className="divide-y divide-border rounded-md border border-border">
      {rows.map(row => <div key={row.key} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(8rem,1fr)_2fr] sm:gap-4">
        <dt className="font-medium">{row.label}</dt>
        <dd className="min-w-0 whitespace-pre-wrap break-words">
          {updating ? <><div className="text-muted-foreground"><span className="font-medium">Before: </span>{displayValue(row.before, row.key)}</div><div><span className="font-medium">After: </span>{displayValue(row.after, row.key)}</div></> : displayValue(after != null ? row.after : row.before, row.key)}
        </dd>
      </div>)}
    </dl>
  </section>;
}

export function AuditTechnical({ entry }: { entry: unknown }) {
  return <details className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
    <summary className="cursor-pointer font-medium">Technical details (IDs and raw record)</summary>
    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(entry, null, 2)}</pre>
  </details>;
}
