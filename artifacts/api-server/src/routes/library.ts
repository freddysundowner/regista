import { Router } from "express";
import { db, Prisma } from "@workspace/db";
import * as z from "@workspace/api-zod";
import { ApiError, audit, body, lock, parse, send, type Tx } from "../lib/core";
import { need } from "../lib/access";
import { ROLE_NAMES } from "../lib/access";

/**
 * The library: a catalogue of titles, each physical copy known by its accession number,
 * and loans to learners or staff. Overdue is worked out from the due date, never stored.
 */
const router = Router();
const day = (d: Date) => d.toISOString().slice(0, 10);
const todayNairobi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi" }).format(new Date());
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const fullName = (s: { firstName: string; middleName: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");

const bookInclude = { copies: { where: { deletedAt: null }, orderBy: { accessionNo: "asc" }, include: { loans: { where: { status: "out" } } } } } satisfies Prisma.LibraryBookInclude;
function bookView(b: Prisma.LibraryBookGetPayload<{ include: typeof bookInclude }>) {
  const live = b.copies.filter(c => c.status !== "withdrawn");
  return {
    ...b, available: live.filter(c => c.status === "available").length, onLoan: live.filter(c => c.status === "on_loan").length,
    copies: b.copies.map(c => ({ id: c.id, accessionNo: c.accessionNo, status: c.status, borrowerName: c.loans[0]?.borrowerName ?? null, dueDate: c.loans[0] ? day(c.loans[0].dueDate) : null })),
  };
}
async function oneBook(schoolId: string, id: string) {
  const b = await db.libraryBook.findFirst({ where: { id, schoolId, deletedAt: null }, include: bookInclude });
  if (!b) throw new ApiError(404, "Book not found");
  return bookView(b);
}

/** Uses the numbers given (already stamped in the books), or carries on from the highest number used. */
async function addCopies(tx: Tx, schoolId: string, bookId: string, count: number, given?: string[]) {
  let numbers = (given ?? []).map(n => n.trim()).filter(Boolean);
  if (numbers.length && numbers.length !== count) throw new ApiError(400, `Give ${count} accession number${count === 1 ? "" : "s"}, one per copy, or leave them out to number the copies for you.`);
  if (new Set(numbers).size !== numbers.length) throw new ApiError(400, "Each accession number can be used once.");
  if (!numbers.length) {
    const used = await tx.libraryCopy.findMany({ where: { schoolId }, select: { accessionNo: true } });
    const top = used.reduce((m, c) => /^\d{1,9}$/.test(c.accessionNo) ? Math.max(m, Number(c.accessionNo)) : m, 0);
    numbers = Array.from({ length: count }, (_, i) => String(top + 1 + i).padStart(4, "0"));
  }
  const taken = await tx.libraryCopy.findMany({ where: { schoolId, accessionNo: { in: numbers } }, select: { accessionNo: true } });
  if (taken.length) throw new ApiError(409, `Accession number${taken.length === 1 ? "" : "s"} ${taken.map(t => t.accessionNo).join(", ")} ${taken.length === 1 ? "is" : "are"} already on another copy.`);
  await tx.libraryCopy.createMany({ data: numbers.map(accessionNo => ({ schoolId, bookId, accessionNo })) });
  return numbers;
}

router.get("/library/summary", async (req, res) => {
  need(req, "library");
  const schoolId = req.actor.school.id, today = D(todayNairobi());
  const [titles, copies, onShelf, out, overdue, lost] = await Promise.all([
    db.libraryBook.count({ where: { schoolId, deletedAt: null } }),
    db.libraryCopy.count({ where: { schoolId, deletedAt: null, status: { not: "withdrawn" } } }),
    db.libraryCopy.count({ where: { schoolId, deletedAt: null, status: "available" } }),
    db.libraryLoan.count({ where: { schoolId, status: "out" } }),
    db.libraryLoan.count({ where: { schoolId, status: "out", dueDate: { lt: today } } }),
    db.libraryCopy.count({ where: { schoolId, deletedAt: null, status: "lost" } }),
  ]);
  send(res, "GetLibrarySummary", { titles, copies, onShelf, out, overdue, lost });
});
router.get("/library/books", async (req, res) => {
  need(req, "library");
  const books = await db.libraryBook.findMany({ where: { schoolId: req.actor.school.id, deletedAt: null }, include: bookInclude, orderBy: { title: "asc" }, take: 5000 });
  send(res, "ListLibraryBooks", books.map(bookView));
});
router.post("/library/books", async (req, res) => {
  need(req, "library");
  const { copies, accessionNumbers, ...input } = body(z.CreateLibraryBookBody, req.body);
  const schoolId = req.actor.school.id;
  const id = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const book = await tx.libraryBook.create({ data: { schoolId, title: input.title, author: input.author || null, isbn: input.isbn || null, publisher: input.publisher || null, category: input.category, subject: input.subject || null, level: input.level || null, shelf: input.shelf || null } });
    const numbers = await addCopies(tx, schoolId, book.id, copies, accessionNumbers);
    await audit(tx, req.actor, "created", "library_book", book.id, undefined, { ...book, accessionNumbers: numbers });
    return book.id;
  });
  send(res, "CreateLibraryBook", await oneBook(schoolId, id));
});
router.patch("/library/books/:id", async (req, res) => {
  need(req, "library");
  const { id } = parse(z.UpdateLibraryBookParams, req.params);
  const input = body(z.UpdateLibraryBookBody, req.body);
  await db.$transaction(async tx => {
    const before = await tx.libraryBook.findFirst({ where: { id, schoolId: req.actor.school.id, deletedAt: null } });
    if (!before) throw new ApiError(404, "Book not found");
    const after = await tx.libraryBook.update({ where: { id }, data: input });
    await audit(tx, req.actor, "updated", "library_book", id, before, after);
  });
  send(res, "UpdateLibraryBook", await oneBook(req.actor.school.id, id));
});
router.post("/library/books/:id/copies", async (req, res) => {
  need(req, "library");
  const { id } = parse(z.AddLibraryCopiesParams, req.params);
  const input = body(z.AddLibraryCopiesBody, req.body);
  await db.$transaction(async tx => {
    await lock(tx, req.actor.school.id);
    if (!await tx.libraryBook.findFirst({ where: { id, schoolId: req.actor.school.id, deletedAt: null } })) throw new ApiError(404, "Book not found");
    const numbers = await addCopies(tx, req.actor.school.id, id, input.count, input.accessionNumbers);
    await audit(tx, req.actor, "copies_added", "library_book", id, undefined, { accessionNumbers: numbers });
  });
  send(res, "AddLibraryCopies", await oneBook(req.actor.school.id, id));
});
router.patch("/library/copies/:id", async (req, res) => {
  need(req, "library");
  const { id } = parse(z.UpdateLibraryCopyParams, req.params);
  const { status } = body(z.UpdateLibraryCopyBody, req.body);
  const bookId = await db.$transaction(async tx => {
    const copy = await tx.libraryCopy.findFirst({ where: { id, schoolId: req.actor.school.id, deletedAt: null } });
    if (!copy) throw new ApiError(404, "Copy not found");
    if (copy.status === "on_loan") throw new ApiError(409, `Copy ${copy.accessionNo} is out on loan. Return it first.`);
    await tx.libraryCopy.update({ where: { id }, data: { status } });
    await audit(tx, req.actor, "updated", "library_copy", id, { status: copy.status }, { status, accessionNo: copy.accessionNo });
    return copy.bookId;
  });
  send(res, "UpdateLibraryCopy", await oneBook(req.actor.school.id, bookId));
});

// A copy out on loan blocks deletion until it comes back. Never lent: removed for good.
// Lent before: hidden instead, so past loans still show the title and accession numbers aren't reused.
const outWith = (loans: { borrowerName: string; copy: { accessionNo: string } }[]) => loans.map(l => `${l.copy.accessionNo} is with ${l.borrowerName}`).join("; ");
router.delete("/library/books/:id", async (req, res) => {
  need(req, "library");
  const { id } = parse(z.DeleteLibraryBookParams, req.params);
  const schoolId = req.actor.school.id;
  await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const book = await tx.libraryBook.findFirst({ where: { id, schoolId, deletedAt: null }, include: { copies: { where: { deletedAt: null } } } });
    if (!book) throw new ApiError(404, "Book not found");
    const out = await tx.libraryLoan.findMany({ where: { status: "out", copy: { bookId: id } }, include: { copy: true } });
    if (out.length) throw new ApiError(409, `${book.title} can't be deleted while copies are borrowed: ${outWith(out)}. Return ${out.length === 1 ? "it" : "them"} first.`);
    const before = { ...book, copies: book.copies.map(c => c.accessionNo) };
    if (await tx.libraryLoan.count({ where: { copy: { bookId: id } } })) {
      const now = new Date();
      await tx.libraryCopy.updateMany({ where: { bookId: id, deletedAt: null }, data: { deletedAt: now } });
      await tx.libraryBook.update({ where: { id }, data: { deletedAt: now } });
    } else {
      await tx.libraryCopy.deleteMany({ where: { bookId: id } });
      await tx.libraryBook.delete({ where: { id } });
    }
    await audit(tx, req.actor, "deleted", "library_book", id, before, { deleted: true });
  });
  res.status(204).end();
});
router.delete("/library/copies/:id", async (req, res) => {
  need(req, "library");
  const { id } = parse(z.DeleteLibraryCopyParams, req.params);
  const schoolId = req.actor.school.id;
  const bookId = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const copy = await tx.libraryCopy.findFirst({ where: { id, schoolId, deletedAt: null } });
    if (!copy) throw new ApiError(404, "Copy not found");
    const out = await tx.libraryLoan.findMany({ where: { status: "out", copyId: id }, include: { copy: true } });
    if (out.length) throw new ApiError(409, `Copy ${outWith(out)}. Return it first.`);
    if (await tx.libraryLoan.count({ where: { copyId: id } })) await tx.libraryCopy.update({ where: { id }, data: { deletedAt: new Date() } });
    else await tx.libraryCopy.delete({ where: { id } });
    await audit(tx, req.actor, "deleted", "library_copy", id, copy, { deleted: true });
    return copy.bookId;
  });
  send(res, "DeleteLibraryCopy", await oneBook(schoolId, bookId));
});

// ---------- Loans ----------
const loanInclude = { copy: { include: { book: true } } } satisfies Prisma.LibraryLoanInclude;
async function loanViews(schoolId: string, loans: Prisma.LibraryLoanGetPayload<{ include: typeof loanInclude }>[]) {
  const [students, users] = await Promise.all([
    db.student.findMany({ where: { schoolId, id: { in: loans.map(l => l.studentId).filter((x): x is string => !!x) } }, include: { grade: true, stream: true } }),
    db.user.findMany({ where: { schoolId }, select: { id: true, name: true, role: true } }),
  ]);
  const people = new Map(users.map(u => [u.id, u]));
  const today = todayNairobi();
  return loans.map(l => {
    const s = l.studentId ? students.find(x => x.id === l.studentId) : null;
    const due = day(l.dueDate), overdue = l.status === "out" && due < today;
    return {
      id: l.id, copyId: l.copyId, accessionNo: l.copy.accessionNo, bookId: l.copy.bookId, title: l.copy.book.title,
      studentId: l.studentId, userId: l.userId, borrowerName: l.borrowerName, borrowerKind: l.studentId ? "learner" : "staff",
      borrowerDetail: s ? [s.admissionNo, [s.grade?.name, s.stream?.name].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : l.userId ? ROLE_NAMES[people.get(l.userId)?.role ?? ""] ?? null : null,
      issuedAt: day(l.issuedAt), dueDate: due, returnedAt: l.returnedAt ? day(l.returnedAt) : null, status: l.status,
      overdue, daysOverdue: overdue ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000) : 0,
      returnNote: l.returnNote, issuedByName: people.get(l.issuedBy)?.name ?? null, createdAt: l.createdAt,
    };
  });
}

router.get("/library/loans", async (req, res) => {
  need(req, "library");
  const q = parse(z.ListLibraryLoansQueryParams, req.query);
  const schoolId = req.actor.school.id, state = q.state ?? "out";
  const where: Prisma.LibraryLoanWhereInput = { schoolId, ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(state === "overdue" ? { status: "out", dueDate: { lt: D(todayNairobi()) } } : state === "all" ? {} : { status: state }) };
  const loans = await db.libraryLoan.findMany({ where, include: loanInclude, orderBy: state === "out" || state === "overdue" ? [{ dueDate: "asc" }] : [{ createdAt: "desc" }], take: 2000 });
  send(res, "ListLibraryLoans", await loanViews(schoolId, loans));
});
router.post("/library/loans", async (req, res) => {
  need(req, "library");
  const input = body(z.IssueLibraryBookBody, req.body);
  const schoolId = req.actor.school.id, today = todayNairobi();
  if (!!input.studentId === !!input.userId) throw new ApiError(400, "Choose one learner or one staff member to lend to.");
  if (input.dueDate < today) throw new ApiError(400, "The return date can't be in the past.");
  const id = await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const copy = await tx.libraryCopy.findFirst({ where: { schoolId, accessionNo: input.accessionNo }, include: { book: true } });
    if (!copy || copy.deletedAt || copy.book.deletedAt) throw new ApiError(404, copy ? `Copy ${input.accessionNo} was deleted from the library.` : `No copy has accession number ${input.accessionNo}.`);
    if (copy.status !== "available") throw new ApiError(409, copy.status === "on_loan" ? `Copy ${copy.accessionNo} of ${copy.book.title} is already out. Return it first.` : `Copy ${copy.accessionNo} is marked ${copy.status} and can't be lent.`);
    let borrowerName: string;
    if (input.studentId) {
      const s = await tx.student.findFirst({ where: { id: input.studentId, schoolId } });
      if (!s) throw new ApiError(404, "Learner not found");
      if (s.status !== "active") throw new ApiError(409, `${fullName(s)} is no longer an active learner.`);
      borrowerName = fullName(s);
    } else {
      const u = await tx.user.findFirst({ where: { id: input.userId, schoolId, isActive: true } });
      if (!u) throw new ApiError(404, "Staff member not found");
      borrowerName = u.name;
    }
    await tx.libraryCopy.update({ where: { id: copy.id }, data: { status: "on_loan" } });
    const loan = await tx.libraryLoan.create({ data: { schoolId, copyId: copy.id, studentId: input.studentId ?? null, userId: input.userId ?? null, borrowerName, issuedAt: D(today), dueDate: D(input.dueDate), issuedBy: req.actor.user.id } });
    await audit(tx, req.actor, "issued", "library_loan", loan.id, undefined, { ...loan, title: copy.book.title, accessionNo: copy.accessionNo });
    return loan.id;
  });
  send(res, "IssueLibraryBook", (await loanViews(schoolId, [await db.libraryLoan.findUniqueOrThrow({ where: { id }, include: loanInclude })]))[0]);
});
router.post("/library/loans/:id/return", async (req, res) => {
  need(req, "library");
  const { id } = parse(z.ReturnLibraryBookParams, req.params);
  const input = body(z.ReturnLibraryBookBody, req.body);
  const schoolId = req.actor.school.id;
  await db.$transaction(async tx => {
    await lock(tx, schoolId);
    const loan = await tx.libraryLoan.findFirst({ where: { id, schoolId } });
    if (!loan) throw new ApiError(404, "Loan not found");
    if (loan.status !== "out") throw new ApiError(409, "This book was already returned.");
    const after = await tx.libraryLoan.update({ where: { id }, data: { status: input.lost ? "lost" : "returned", returnedAt: D(todayNairobi()), returnedBy: req.actor.user.id, returnNote: input.note?.trim() || null } });
    await tx.libraryCopy.update({ where: { id: loan.copyId }, data: { status: input.lost ? "lost" : input.damaged ? "damaged" : "available" } });
    await audit(tx, req.actor, input.lost ? "lost" : "returned", "library_loan", id, loan, after);
  });
  send(res, "ReturnLibraryBook", (await loanViews(schoolId, [await db.libraryLoan.findUniqueOrThrow({ where: { id }, include: loanInclude })]))[0]);
});
router.get("/library/borrowers", async (req, res) => {
  need(req, "library");
  const { q } = parse(z.SearchLibraryBorrowersQueryParams, req.query);
  const schoolId = req.actor.school.id;
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const [students, users, out] = await Promise.all([
    db.student.findMany({ where: { schoolId, status: "active", AND: words.map(w => ({ OR: [{ firstName: { contains: w, mode: "insensitive" as const } }, { middleName: { contains: w, mode: "insensitive" as const } }, { lastName: { contains: w, mode: "insensitive" as const } }, { admissionNo: { contains: w, mode: "insensitive" as const } }] })) }, include: { grade: true, stream: true }, take: 15, orderBy: { firstName: "asc" } }),
    db.user.findMany({ where: { schoolId, isActive: true, AND: words.map(w => ({ name: { contains: w, mode: "insensitive" as const } })) }, take: 5, orderBy: { name: "asc" } }),
    db.libraryLoan.groupBy({ by: ["studentId", "userId"], where: { schoolId, status: "out" }, _count: true }),
  ]);
  const count = (key: "studentId" | "userId", id: string) => out.find(o => o[key] === id)?._count ?? 0;
  send(res, "SearchLibraryBorrowers", [
    ...students.map(s => ({ id: s.id, kind: "learner", name: fullName(s), detail: [s.admissionNo, [s.grade?.name, s.stream?.name].filter(Boolean).join(" ")].filter(Boolean).join(" · "), booksOut: count("studentId", s.id) })),
    ...users.map(u => ({ id: u.id, kind: "staff", name: u.name, detail: ROLE_NAMES[u.role] ?? null, booksOut: count("userId", u.id) })),
  ]);
});

export default router;
