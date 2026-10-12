import { useState } from "react";
import { PageHeader, Panel } from "@/components/kit";
import { FeesStep } from "@/pages/term-setup";
import { OptionalCharges } from "@/pages/fees";
import { usePerms } from "@/lib/session";

/** Fee setup on one page: what each grade pays per term, then the extras only some learners pay. */
export default function FeeStructure() {
  const p = usePerms();
  const [termId, setTermId] = useState("");
  return (
    <div className="space-y-6">
      <PageHeader title="Fee setup" meta="What each grade pays per term, and the extras some learners pay." />
      <Panel title="Fees per grade"><div className="p-5"><FeesStep embedded termId={termId} onTermId={setTermId} onNext={() => undefined} /></div></Panel>
      <OptionalCharges canEdit={p.financeConfigure} />
    </div>
  );
}
