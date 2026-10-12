import { db } from "@workspace/db";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { ApiError, type Actor } from "./core";
import { renderPdf } from "./finance/documents";
import { saveDocument } from "./academics/documents";
import { storedObject } from "./school-files";

/**
 * A learner's identity card as a print-ready PDF: two pages, front and back, each the size of a bank card
 * (85.6 x 54 mm), so a card printer or a print shop can use it as it is.
 *
 * Front: the school's logo and name, the learner's photo, name, admission number, class and the year.
 * Back:  a QR code of the admission number (for a gate or library scanner), who to return the card to, and a
 *        line for the head teacher's signature.
 * Nothing about fees, family or date of birth is printed: a card gets lost.
 */
const W = 242.65, H = 153.07; // 85.6 mm x 54 mm in points
const BRAND = "#1d4b52", ACCENT = "#e9a93b", INK = "#1f2a2e", MUTED = "#6b7478", TINT = "#eef3f3", LINE = "#d9dfe0";

/** A stored image (logo or photo) as a data URL pdfmake can draw. PNG and JPEG only; anything else is left out. */
async function storedImage(schoolId: string, ref: string | null | undefined, entityType: string) {
  const id = ref?.match(/^\/api\/storage\/files\/([a-f0-9-]+)$/i)?.[1];
  if (!id) return null;
  const file = await db.storedFile.findFirst({ where: { id, schoolId, entityType, status: "ready" } });
  if (!file || !["image/png", "image/jpeg"].includes(file.contentType)) return null;
  const [bytes] = await storedObject(file.objectKey).download().catch(() => [null] as [null]);
  return bytes ? `data:${file.contentType};base64,${bytes.toString("base64")}` : null;
}
const at = (x: number, y: number) => ({ absolutePosition: { x, y } });
/** Text held to a width (so it wraps or centres inside it) at a fixed spot on the card. */
const box = (x: number, y: number, width: number, text: Record<string, unknown>): Content => ({ columns: [{ width, ...text } as Content], ...at(x, y) }) as Content;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export async function learnerIdCard(actor: Actor, studentId: string) {
  const school = await db.school.findUniqueOrThrow({ where: { id: actor.school.id } });
  const student = await db.student.findFirst({ where: { id: studentId, schoolId: school.id }, include: { grade: true, stream: true } });
  if (!student) throw new ApiError(404, "Student not found");
  const year = await db.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } });
  const [logo, photo] = await Promise.all([storedImage(school.id, school.logoUrl, "school_logo"), storedImage(school.id, student.photoUrl, "student_photo")]);

  const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const klass = student.grade ? `${student.grade.name}${student.stream ? ` ${student.stream.name}` : ""}` : "Not placed";
  const yearName = year?.name ?? String(new Date().getFullYear());
  const contact = [school.phone, school.email].filter(Boolean).join("  ·  ");
  const fact = (label: string, value: string, y: number): Content[] => [
    { text: label.toUpperCase(), fontSize: 5, color: MUTED, characterSpacing: 0.6, ...at(92, y) },
    { text: value, fontSize: 8.5, bold: true, color: INK, ...at(92, y + 6.5) },
  ];

  const front: Content[] = [
    // Header band, with a thin accent line under it.
    { canvas: [{ type: "rect", x: 0, y: 0, w: W, h: 40, color: BRAND }, { type: "rect", x: 0, y: 40, w: W, h: 2.5, color: ACCENT }], ...at(0, 0) },
    ...(logo ? [{ canvas: [{ type: "rect", x: 0, y: 0, w: 28, h: 28, r: 5, color: "#ffffff" }], ...at(10, 6) } as Content, { image: logo, fit: [22, 22] as [number, number], ...at(13, 9) } as Content] : []),
    box(logo ? 46 : 12, 9, W - (logo ? 58 : 24), { text: school.name, fontSize: school.name.length > 30 ? 8.5 : 10.5, bold: true, color: "#ffffff" }),
    { text: "LEARNER IDENTITY CARD", fontSize: 5.5, color: "#cfe0e2", characterSpacing: 1.2, ...at(logo ? 46 : 12, 26) },
    // Photo, or the learner's initials on a tinted panel when there is none.
    { canvas: [{ type: "rect", x: 0, y: 0, w: 68, h: 84, r: 4, color: TINT, lineColor: LINE, lineWidth: 0.6 }], ...at(12, 54) },
    photo ? { image: photo, cover: { width: 64, height: 80, valign: "center", align: "center" }, ...at(14, 56) } as Content
      : box(12, 84, 68, { text: initials(name), fontSize: 24, bold: true, color: BRAND, alignment: "center" }),
    box(92, 54, W - 104, { text: name, fontSize: name.length > 24 ? 10 : 12, bold: true, color: INK, lineHeight: 1.05 }),
    ...fact("Admission no.", student.admissionNo, 82),
    ...fact("Class", klass, 104),
    ...fact("Year", yearName, 126),
    { canvas: [{ type: "rect", x: 0, y: 0, w: W, h: 5, color: BRAND }], ...at(0, H - 5) },
  ];
  const back: Content[] = [
    { canvas: [{ type: "rect", x: 0, y: 0, w: W, h: 5, color: BRAND }, { type: "rect", x: 0, y: 5, w: W, h: 1.5, color: ACCENT }], ...at(0, 0) },
    // The admission number, so a scanner at the gate or in the library can read it.
    { qr: student.admissionNo, fit: 64, eccLevel: "M", foreground: INK, ...at(14, 22) },
    box(14, 90, 64, { text: student.admissionNo, fontSize: 6.5, color: MUTED, alignment: "center" }),
    box(94, 22, W - 108, { text: `This card belongs to ${school.name}.`, fontSize: 7.5, bold: true, color: INK }),
    box(94, 44, W - 108, { text: "If found, please return it to the school.", fontSize: 7, color: MUTED }),
    ...(school.address ? [box(94, 62, W - 108, { text: school.address, fontSize: 6.5, color: MUTED })] : []),
    ...(contact ? [box(94, 76, W - 108, { text: contact, fontSize: 6.5, color: INK })] : []),
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 96, y2: 0, lineWidth: 0.6, lineColor: MUTED }], ...at(132, 124) },
    box(132, 127, 96, { text: "Head teacher", fontSize: 5.5, color: MUTED, alignment: "center" }),
    { text: `Valid for ${yearName}`, fontSize: 5.5, color: MUTED, ...at(14, 127) },
    { canvas: [{ type: "rect", x: 0, y: 0, w: W, h: 5, color: BRAND }], ...at(0, H - 5) },
  ];
  const definition: TDocumentDefinitions = {
    pageSize: { width: W, height: H }, pageMargins: [0, 0, 0, 0],
    info: { title: `Identity card: ${name}` },
    content: [...front, { text: "", pageBreak: "after" }, ...back],
  };
  return saveDocument(actor, "learner_id_card", student.id, await renderPdf(definition), "pdf", "application/pdf");
}
