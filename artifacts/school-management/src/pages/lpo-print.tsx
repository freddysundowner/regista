import { Link, useParams } from "wouter";
import { useGetPurchaseOrder, getGetPurchaseOrderQueryKey, useGetSchool, getGetSchoolQueryKey, useListSuppliers, getListSuppliersQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Printer } from "lucide-react";
import { Btn, ErrorState, SkeletonRows } from "@/components/kit";
import { StoredImage } from "@/components/stored-image";
import { lpoStatusLabel, qtyText } from "@/components/procurement-kit";
import { errMsg, fmtDate } from "@/lib/session";
import { usePageTitle } from "@/lib/page-title";

const money = (v: string) => Number(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The LPO as the supplier receives it: one A4 page with the school's letterhead and signature lines. */
export default function LpoPrint() {
  const { id } = useParams<{ id: string }>();
  const q = useGetPurchaseOrder(id, { query: { queryKey: getGetPurchaseOrderQueryKey(id) } });
  const school = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  const suppliers = useListSuppliers({ query: { queryKey: getListSuppliersQueryKey() } });
  const o = q.data, s = school.data;
  usePageTitle(o ? o.reference : "LPO");
  if (q.isLoading || school.isLoading) return <SkeletonRows rows={8} cols={4} />;
  if (q.isError || !o || !s) return <ErrorState msg={errMsg(q.error, "Could not load this LPO.")} onRetry={() => q.refetch()} />;
  const sup = suppliers.data?.find((x) => x.id === o.supplierId);
  const unapproved = !["approved", "partly_received", "received"].includes(o.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/purchases" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted"><ArrowLeft className="h-4 w-4" />LPOs</Link>
        <Btn onClick={() => window.print()} data-testid="button-print-lpo"><Printer className="h-4 w-4" />Print</Btn>
        {unapproved && <span className="text-sm text-amber-700">This LPO is {lpoStatusLabel(o.status).toLowerCase()}; the printout is marked NOT APPROVED.</span>}
      </div>
      <div className="print-area overflow-x-auto">
        <article className="print-page relative mx-auto flex min-h-[290mm] w-full max-w-[210mm] flex-col bg-white p-[14mm] text-[10pt] text-black shadow-md ring-1 ring-black/5" data-testid="lpo-sheet">
          {unapproved && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="-rotate-[30deg] text-[48pt] font-bold uppercase text-black/10">Not approved</span></div>}
          <header className="flex items-center gap-4 border-b-2 border-black pb-3">
            {s.logoUrl && <StoredImage refPath={s.logoUrl} alt="" className="h-20 w-20 object-contain" fallback={null} />}
            <div className={`min-w-0 flex-1 ${s.logoUrl ? "" : "text-center"}`}>
              <div className="text-2xl font-bold uppercase tracking-wide">{s.name}</div>
              <div className="mt-0.5 text-[9pt]">{[s.address, s.phone, s.email].filter(Boolean).join(" · ")}</div>
            </div>
          </header>
          <div className="mt-4 flex items-start justify-between gap-6">
            <div>
              <div className="whitespace-nowrap text-lg font-bold uppercase tracking-wider">Local Purchase Order</div>
              <div className="mt-2 text-[9pt] uppercase text-black/60">To</div>
              <div className="font-semibold">{o.supplierName}</div>
              {sup && <div className="text-[9pt]">{[sup.address, sup.phone, sup.email].filter(Boolean).join(" · ")}{sup.kraPin ? <div>KRA PIN: {sup.kraPin}</div> : null}</div>}
            </div>
            <table className="shrink-0 text-[9.5pt]"><tbody>
              <tr><td className="pr-3 text-black/60">LPO No.</td><td className="font-mono font-bold">{o.reference}</td></tr>
              <tr><td className="pr-3 text-black/60">Date</td><td>{fmtDate(o.date)}</td></tr>
              {o.neededBy && <tr><td className="pr-3 text-black/60">Deliver by</td><td>{fmtDate(o.neededBy)}</td></tr>}
            </tbody></table>
          </div>
          <p className="mt-4 text-[9.5pt]">Please supply the following and send your invoice quoting the LPO number above.</p>
          <table className="mt-3 w-full border-collapse text-[9.5pt]">
            <thead><tr className="border-y border-black text-left"><th className="py-1.5 pr-2">#</th><th className="py-1.5 pr-2">Description</th><th className="py-1.5 pr-2 text-right">Qty</th><th className="py-1.5 pr-2">Unit</th><th className="py-1.5 pr-2 text-right">Unit price</th><th className="py-1.5 text-right">Amount (KES)</th></tr></thead>
            <tbody>{o.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-black/20"><td className="py-1.5 pr-2">{i + 1}</td><td className="py-1.5 pr-2">{l.description}</td><td className="py-1.5 pr-2 text-right tabular-nums">{qtyText(l.quantity)}</td><td className="py-1.5 pr-2">{l.unit ?? ""}</td><td className="py-1.5 pr-2 text-right tabular-nums">{money(l.unitPrice)}</td><td className="py-1.5 text-right tabular-nums">{money(l.amount)}</td></tr>
            ))}</tbody>
            <tfoot><tr className="border-t-2 border-black font-bold"><td colSpan={5} className="py-2 text-right pr-2">TOTAL</td><td className="py-2 text-right tabular-nums">{money(o.total)}</td></tr></tfoot>
          </table>
          {o.notes && <p className="mt-3 text-[9.5pt]"><b>Notes:</b> {o.notes}</p>}
          <div className="mt-auto grid grid-cols-2 gap-10 pt-16 text-[9.5pt]">
            <div><div className="border-t border-black pt-1">Prepared by: {o.createdByName ?? ""}</div><div className="mt-6 border-t border-black pt-1">Signature &amp; date</div></div>
            <div><div className="border-t border-black pt-1">Approved by: {o.decidedByName && !unapproved ? o.decidedByName : ""}</div><div className="mt-6 border-t border-black pt-1">Signature, date &amp; school stamp</div></div>
          </div>
          <p className="mt-6 text-center text-[8pt] text-black/60">This order is valid only when signed and stamped. Goods are received against the delivery note; payment follows the supplier's invoice.</p>
        </article>
      </div>
    </div>
  );
}
