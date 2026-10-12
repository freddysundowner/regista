import pdfmake from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { Actor } from "./core";
import { schoolLogoBlock } from "./finance/documents";
import { kcbAccount, kcbProvider } from "./bank-accounts";

const INK = "#111111", MUTED = "#555555";
const WIDTH = 515; // A4 width less 40pt margins each side

/** A drawn tick box: the built-in PDF fonts have no ☐/☒ glyphs. */
function box(checked: boolean, label: string): Content {
  return { columns: [
    { width: 14, canvas: [
      { type: "rect", x: 0, y: 1, w: 9, h: 9, lineWidth: 0.8, lineColor: INK },
      ...(checked ? [{ type: "line" as const, x1: 1.8, y1: 5.8, x2: 3.9, y2: 8.2, lineWidth: 1.3, lineColor: INK }, { type: "line" as const, x1: 3.9, y1: 8.2, x2: 7.6, y2: 2.6, lineWidth: 1.3, lineColor: INK }] : []),
    ] },
    { width: "auto", text: label },
  ], columnGap: 3, margin: [0, 0, 0, 4] } as Content;
}

const BRAND = "#1d4b52";

/** 254715363474 / +254 715… / 0715363474 → "0715 363 474"; anything else is printed as entered. */
export function kenyanPhone(value?: string | null) {
  const digits = value?.replace(/[^\d]/g, "") ?? "";
  const local = /^254[17]\d{8}$/.test(digits) ? `0${digits.slice(3)}` : /^0[17]\d{8}$/.test(digits) ? digits : null;
  return local ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : value?.trim() || null;
}

/** The school's details as letterhead lines: address (with county unless it is already there), then phone and email. */
function schoolContacts(school: Actor["school"]) {
  const address = school.address?.trim(), county = school.county?.trim();
  const place = [address, county && !address?.toLowerCase().includes(county.toLowerCase()) ? `${county} County` : null].filter(Boolean).join(", ");
  const reach = [kenyanPhone(school.phone) && `Tel: ${kenyanPhone(school.phone)}`, school.email && `Email: ${school.email.trim()}`].filter(Boolean).join("     |     ");
  return { place, reach };
}

/**
 * A formal school letterhead: logo, name, motto and contacts centred over a double rule in the school's colour.
 * Works without a logo or motto; empty lines are left out.
 */
async function letterhead(school: Actor["school"]): Promise<Content[]> {
  const logo = await schoolLogoBlock(school);
  const motto = (((school.settings as any)?.feeStructureTemplates ?? [])[0]?.subtitle as string | undefined)?.trim();
  const { place, reach } = schoolContacts(school);
  return [
    ...(logo.length ? [{ ...logo[0], fit: [62, 62], alignment: "center", margin: [0, 0, 0, 5] }] : []),
    { text: school.name.toUpperCase(), fontSize: 18, bold: true, color: BRAND, alignment: "center", characterSpacing: 0.6 },
    ...(motto && !/_{3,}/.test(motto) ? [{ text: `“${motto}”`, italics: true, fontSize: 9.5, color: MUTED, alignment: "center", margin: [0, 2, 0, 0] }] : []),
    ...(place ? [{ text: place, fontSize: 9, alignment: "center", margin: [0, 5, 0, 0] }] : []),
    ...(reach ? [{ text: reach, fontSize: 9, alignment: "center", margin: [0, 2, 0, 0] }] : []),
    { canvas: [
      { type: "line", x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 2.2, lineColor: BRAND },
      { type: "line", x1: 0, y1: 3.5, x2: WIDTH, y2: 3.5, lineWidth: 0.6, lineColor: BRAND },
    ], margin: [0, 9, 0, 0] },
  ] as Content[];
}

/** A quiet footer repeating the school's details, as on printed letterheads. */
function letterFooter(school: Actor["school"]) {
  const { place, reach } = schoolContacts(school);
  const text = [school.name, place, reach.replace(/\s+\|\s+/g, "  ·  ")].filter(Boolean).join("  ·  ");
  return () => ({ stack: [
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 0.5, lineColor: BRAND }] },
    { text, fontSize: 7.5, color: MUTED, alignment: "center", margin: [0, 4, 0, 0] },
  ], margin: [40, 4, 40, 0] } as Content);
}

const LINE = "#b9c4c6";

/** A section title in the school colour with a thin rule under it; an optional hint in brackets, as in KCB's form. */
const section = (title: string, hint?: string): Content => ({ stack: [
  { text: [{ text: title, bold: true, color: BRAND }, ...(hint ? [{ text: `  (${hint})`, color: MUTED, fontSize: 8.5 }] : [])] },
  { canvas: [{ type: "line", x1: 0, y1: 2, x2: WIDTH, y2: 2, lineWidth: 0.5, lineColor: LINE }], margin: [0, 0, 0, 6] },
], margin: [0, 14, 0, 0] });

/** Tick boxes side by side. */
const row = (items: [boolean, string][]): Content => ({ columns: items.map(([c, l]) => ({ width: "auto", stack: [box(c, l)] })), columnGap: 26 } as Content);

/** Label / value pairs in two aligned columns; an empty value leaves a line to fill in by hand. */
const details = (items: [string, Content | string | null | undefined][]): Content => ({
  table: { widths: [130, "*"], body: items.map(([k, v]) => [
    { text: k, color: MUTED },
    typeof v === "string" || v == null ? { text: v?.trim() || "______________________________", bold: !!v?.trim() } : v,
  ]) },
  layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 },
} as Content);

/**
 * KCB's "Partner Request Letter for Buni API Integration" (v2026), filled in for one account on the school's
 * letterhead. It follows KCB's Word template line for line; only the blanks are filled and the boxes ticked.
 */
export async function kcbLetterPdf(actor: Actor, id: string) {
  const account = await kcbAccount(actor, id);
  const till = account.collectionType === "kcb_till" ? account.collectionNumber : null;
  const provider = kcbProvider();
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Nairobi" }).format(new Date()).replace(/\//g, "-");
  const content: Content[] = [
    ...await letterhead(actor.school),
    { columns: [
      { width: "*", stack: ["The Branch Manager,", "KCB Bank Kenya Limited,", account.branch ? `${account.branch} Branch.` : "______________________ Branch."], lineHeight: 1.25 },
      { width: "auto", text: `Date: ${date}`, alignment: "right" },
    ], margin: [0, 16, 0, 14] },
    { text: "Dear Sir/Madam,", margin: [0, 0, 0, 8] },
    { text: "RE: APPLICATION FOR KCB API SYSTEM INTEGRATION", bold: true, decoration: "underline", margin: [0, 0, 0, 8] },
    { text: "We hereby officially request access to the KCB APIs for account/till integration following successful testing.", alignment: "justify" },

    section("Request Type", "Tick where applicable"),
    row([[true, "New Setup"], [false, "Modify Setup"], [false, "Cancel/Deactivate"]]),

    section("Account Details"),
    details([
      ["Account Type", row([[!!till, "Till"], [true, "Account"]])],
      ["Account/Till Name", account.accountName],
      ["Account/Till Number", till ? `${account.accountNumber} (Account)   ·   ${till} (Till)` : account.accountNumber],
      ["Branch Name", account.branch],
      ["Currency", "KES"],
    ]),

    section("API Products", "Tick where applicable"),
    { columns: [
      { width: "*", stack: [box(true, "Instant Payment Notification (IPN)"), box(false, "MPESA Express API"), box(false, "Funds Transfer API")] },
      { width: "*", stack: [box(true, "Account Balance Query API"), box(true, "Account Statement API"), box(true, "Transaction Query API")] },
    ], columnGap: 16 },

    section("Authorized Service Provider"),
    { text: "For this integration, we authorize the following personnel/service provider(s) to engage with the bank to undertake the technical integrations and access live/production setup & credentials.", alignment: "justify", margin: [0, 0, 0, 6] },
    details([["Business Name", provider.businessName], ["Full Name", provider.contactName], ["Email", provider.email], ["Phone Number", provider.phone]]),

    { text: "Yours sincerely,", margin: [0, 16, 0, 2] },
    { text: "Authorized signatories' details to the bank account/Till as per account mandate.", fontSize: 8.5, color: MUTED, margin: [0, 0, 0, 12] },
    { columns: [
      { width: "*", stack: ["Full Names", "Designation", "Email & Mobile", "Signature"].map(label => ({
        columns: [{ width: 86, text: `${label}:`, color: MUTED }, { width: 230, canvas: [{ type: "line", x1: 0, y1: 11, x2: 230, y2: 11, lineWidth: 0.6, lineColor: INK }] }],
        margin: [0, 0, 0, 12],
      })) },
      { width: 130, stack: [
        { canvas: [{ type: "rect", x: 0, y: 0, w: 130, h: 86, r: 4, lineWidth: 0.7, lineColor: LINE, dash: { length: 3 } }] },
        { text: "Official school stamp", fontSize: 8, color: MUTED, alignment: "center", margin: [0, -48, 0, 0] },
      ] },
    ], columnGap: 20, unbreakable: true } as Content,
  ];
  const doc: TDocumentDefinitions = {
    pageSize: "A4", pageMargins: [40, 28, 40, 34], footer: letterFooter(actor.school), info: { title: `KCB API integration request - ${actor.school.name}` },
    defaultStyle: { font: "Helvetica", fontSize: 10, color: INK, lineHeight: 1.15 }, content,
  };
  return { bytes: await pdfmake.createPdf(doc).getBuffer(), filename: `KCB request letter - ${account.accountName}.pdf`.replace(/[\\/:*?"<>|]/g, "") };
}
