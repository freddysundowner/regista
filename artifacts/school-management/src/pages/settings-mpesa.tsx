import { Link } from "wouter";
import { PageHeader } from "@/components/kit";
import Integrations from "@/pages/integrations";
import { SunpayCard } from "@/components/sunpay-card";

/**
 * The school's own Safaricom paybill or till (Daraja) comes first. SunPay is a second option for schools without a
 * Daraja account. Bank-owned paybills and tills, like NCBA's, live on the Bank tab.
 */
export default function MpesaSettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Settings" title="M-Pesa" meta="Your school's own Safaricom paybill or till, connected through Daraja." />
      <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
        Parents pay to your paybill and use the learner's <b>admission number</b> as the account number. If your paybill or till belongs to your bank (for example an NCBA Till), set it up on the <Link href="/settings/bank" className="font-semibold text-primary hover:underline">Bank</Link> tab instead.
      </p>
      <Integrations only={["daraja"]} />
      <SunpayCard />
    </div>
  );
}
