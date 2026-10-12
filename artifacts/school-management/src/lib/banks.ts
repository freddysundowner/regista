/** Banks with a live connection; keep in step with BANKS in the API's lib/bank-accounts.ts. */
export const BANKS: Record<string, string> = { ncba: "NCBA", kcb: "KCB" };

export const NCBA_TILL_PAYBILL = "880100";
export const COLLECTION_LABEL: Record<string, string> = { ncba_till: "NCBA Till (via 880100)", paybill: "Own paybill" };

/** What parents type in M-Pesa for this account. */
export function howParentsPay(type: string | null, number: string | null) {
  if (!type || !number) return null;
  if (type === "kcb_till") return `KCB till ${number} (Vooma, or paybill 522533), with the admission number as reference`;
  if (type === "ncba_till") return `Paybill ${NCBA_TILL_PAYBILL}, account ${number}#admission number`;
  return `Paybill ${number}, account = admission number`;
}
