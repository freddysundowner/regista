import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useListStockMovements, getListStockMovementsQueryKey, useListStoreItems, getListStoreItemsQueryKey, StockMovementType } from "@workspace/api-client-react";
import { ArrowLeftRight } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, Filters, TextInput, NativeSelect } from "@/components/kit";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { qtyText } from "@/components/procurement-kit";
import { errMsg, fmtDate, localToday } from "@/lib/session";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { receive: "Received", issue: "Issued", return: "Returned", adjust: "Counted" };
const monthStart = () => `${localToday().slice(0, 8)}01`;

/** Every stock movement; filtered to one item it is that item's stock card. */
export default function StoreMovements() {
  usePageTitle("Stock in & out");
  const search = new URLSearchParams(useSearch());
  const [itemId, setItemId] = useState(search.get("item") ?? "");
  const [from, setFrom] = useState(itemId ? "" : monthStart());
  const [to, setTo] = useState(localToday());
  const [type, setType] = useState("");
  const [text, setText] = useState("");
  const items = useListStoreItems({ query: { queryKey: getListStoreItemsQueryKey() } });
  const params = { ...(itemId ? { itemId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(type ? { type: type as StockMovementType } : {}) };
  const q = useListStockMovements(params, { query: { queryKey: getListStockMovementsQueryKey(params) } });
  const rows = (q.data ?? []).filter((m) => matches(text, m.itemName, m.issuedTo, m.reference, m.note, m.createdByName));
  const { rows: pageRows, pager } = usePaged(rows, [params, text]);
  const item = items.data?.find((i) => i.id === itemId);
  const issuedTotal = rows.filter((m) => m.type === "issue").reduce((t, m) => t - Number(m.quantity), 0);
  const cols = [{ key: "date", label: "Date" }, { key: "item", label: "Item" }, { key: "type", label: "Movement" }, { key: "quantity", label: "Quantity" }, { key: "balance", label: "Balance after" }, { key: "issuedTo", label: "To / from" }, { key: "reference", label: "Reference" }, { key: "note", label: "Note" }, { key: "by", label: "By" }];
  const exportRows = rows.map((m) => ({ date: m.date, item: m.itemName, type: TYPE_LABEL[m.type], quantity: m.quantity, balance: m.balanceAfter, issuedTo: m.issuedTo ?? "", reference: m.reference ?? "", note: m.note ?? "", by: m.createdByName ?? "" }));
  return (
    <div className="space-y-5">
      <PageHeader title={item ? `Stock card: ${item.name}` : "Stock in & out"} meta={item ? `${qtyText(item.quantity)} ${item.unit} in the store now.` : "Everything received, issued, returned and counted."}>
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Stock movements", cols, exportRows, item ? `stock-card-${item.name}` : "stock-movements")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, item ? `stock-card-${item.name}` : "stock-movements")}>CSV</Btn>
      </PageHeader>
      <Panel>
        <div className="border-b border-border/70 p-4">
          <Filters align="end" active={(itemId ? 1 : 0) + (type ? 1 : 0)} onClear={() => { setItemId(""); setType(""); }} lead={<ListSearch value={text} onChange={setText} placeholder="Search item, issued to, reference" />}>
          <Field label="Item"><NativeSelect value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">All items</option>{(items.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
          <Field label="From"><TextInput type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Movement"><NativeSelect value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{Object.values(StockMovementType).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</NativeSelect></Field>
          </Filters>
        </div>
        {item && issuedTotal > 0 && <p className="border-b border-border/60 px-5 py-2 text-sm text-muted-foreground">Issued in these dates: <b className="text-foreground">{qtyText(String(issuedTotal))} {item.unit}</b></p>}
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<ArrowLeftRight className="h-5 w-5" />} title="No stock moved in these dates" body="Receipts, issues, returns and stock counts appear here as they are recorded.">
            <Link href="/store" className="text-sm font-medium text-primary hover:underline">Go to the store</Link>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-5 py-2.5 font-medium">Date</th>{!item && <th className="px-3 py-2.5 font-medium">Item</th>}<th className="px-3 py-2.5 font-medium">Movement</th><th className="px-3 py-2.5 text-right font-medium">In / out</th><th className="px-3 py-2.5 text-right font-medium">Balance</th><th className="px-3 py-2.5 font-medium">Details</th></tr></thead>
              <tbody className="divide-y divide-border/60">{pageRows.map((m) => (
                <tr key={m.id} data-testid={`row-move-${m.id}`}>
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">{fmtDate(m.date)}</td>
                  {!item && <td className="px-3 py-2.5"><Link href={`/store/movements?item=${m.itemId}`} onClick={() => setItemId(m.itemId)} className="font-medium hover:underline">{m.itemName}</Link></td>}
                  <td className="px-3 py-2.5">{TYPE_LABEL[m.type]}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", Number(m.quantity) < 0 ? "text-destructive" : "text-primary")}>{Number(m.quantity) > 0 ? "+" : ""}{qtyText(m.quantity)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{qtyText(m.balanceAfter)} <span className="text-xs text-muted-foreground">{m.unit}</span></td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{[m.issuedTo && (m.type === "issue" ? `to ${m.issuedTo}` : `from ${m.issuedTo}`), m.reference, m.note, m.createdByName && `by ${m.createdByName}`].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pager {...pager} />
      </Panel>
    </div>
  );
}
