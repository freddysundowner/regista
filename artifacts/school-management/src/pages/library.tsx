import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLibraryBooks, getListLibraryBooksQueryKey, useCreateLibraryBook, useUpdateLibraryBook, useAddLibraryCopies, useUpdateLibraryCopy, useDeleteLibraryBook, useDeleteLibraryCopy,
  useGetLibrarySummary, getGetLibrarySummaryQueryKey, type LibraryBook,
} from "@workspace/api-client-react";
import { BookPlus, BookOpen, BookUp, Layers, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, Filters, TextInput, NativeSelect, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { IssueForm } from "@/pages/library-loans";
import { usePerms, errMsg, fmtDate } from "@/lib/session";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const BOOK_CATEGORIES = ["Textbook", "Class reader", "Storybook", "Reference", "Revision", "Teacher's guide", "Religious", "Magazine", "Other"];
const COPY_STATUS: Record<string, { tone: string; label: string }> = {
  available: { tone: "active", label: "On shelf" }, on_loan: { tone: "current", label: "Out" }, damaged: { tone: "duplicate", label: "Damaged" }, lost: { tone: "error", label: "Lost" }, withdrawn: { tone: "inactive", label: "Withdrawn" },
};
const accessionList = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

function useRefresh() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: getListLibraryBooksQueryKey() }); void qc.invalidateQueries({ queryKey: getGetLibrarySummaryQueryKey() }); };
}

function BookForm({ book, onDone }: { book?: LibraryBook; onDone: () => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const create = useCreateLibraryBook();
  const update = useUpdateLibraryBook();
  const [f, setF] = useState({ title: book?.title ?? "", author: book?.author ?? "", isbn: book?.isbn ?? "", publisher: book?.publisher ?? "", category: book?.category ?? "", subject: book?.subject ?? "", level: book?.level ?? "", shelf: book?.shelf ?? "", copies: "1", numbers: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.title.trim()) return setErr("Enter the book's title.");
    if (!f.category) return setErr("Choose what kind of book it is.");
    const t = (v: string) => v.trim();
    if (book) return update.mutate({ id: book.id, data: { title: t(f.title), category: f.category, author: t(f.author) || null, isbn: t(f.isbn) || null, publisher: t(f.publisher) || null, subject: t(f.subject) || null, level: t(f.level) || null, shelf: t(f.shelf) || null } }, {
      onSuccess: () => { refresh(); toast({ title: "Book updated" }); onDone(); }, onError: (x) => setErr(errMsg(x)) });
    const copies = Number(f.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 500) return setErr("Enter how many copies, from 1 to 500.");
    const numbers = accessionList(f.numbers);
    if (numbers.length && numbers.length !== copies) return setErr(`You gave ${numbers.length} accession number${numbers.length === 1 ? "" : "s"} for ${copies} cop${copies === 1 ? "y" : "ies"}.`);
    const opt = Object.fromEntries(["author", "isbn", "publisher", "subject", "level", "shelf"].map((k) => [k, t(f[k as keyof typeof f])]).filter(([, v]) => v));
    create.mutate({ data: { title: t(f.title), category: f.category, copies, ...opt, ...(numbers.length ? { accessionNumbers: numbers } : {}) } }, {
      onSuccess: (b) => { refresh(); toast({ title: `${b.title} catalogued`, description: `Accession no. ${b.copies.map((c) => c.accessionNo).slice(0, 6).join(", ")}${b.copies.length > 6 ? "…" : ""}. Write these in the books.` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const busy = create.isPending || update.isPending;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" required className="sm:col-span-2"><TextInput data-testid="input-book-title" value={f.title} onChange={set("title")} maxLength={200} placeholder="e.g. Primary Mathematics Grade 5" /></Field>
        <Field label="Author"><TextInput value={f.author} onChange={set("author")} maxLength={160} /></Field>
        <Field label="Kind of book" required><NativeSelect data-testid="select-book-category" value={f.category} onChange={set("category")}><option value="">Choose</option>{[...new Set([...BOOK_CATEGORIES, ...(book ? [book.category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect></Field>
        <Field label="Subject"><TextInput value={f.subject} onChange={set("subject")} maxLength={60} placeholder="e.g. Mathematics" /></Field>
        <Field label="Grade or level"><TextInput value={f.level} onChange={set("level")} maxLength={40} placeholder="e.g. Grade 5" /></Field>
        <Field label="Publisher"><TextInput value={f.publisher} onChange={set("publisher")} maxLength={120} /></Field>
        <Field label="ISBN"><TextInput value={f.isbn} onChange={set("isbn")} maxLength={20} className="font-mono" /></Field>
        <Field label="Shelf"><TextInput value={f.shelf} onChange={set("shelf")} maxLength={30} placeholder="e.g. B3" /></Field>
        {!book && <>
          <Field label="Number of copies" required><TextInput data-testid="input-book-copies" inputMode="numeric" value={f.copies} onChange={(e) => setF({ ...f, copies: e.target.value.replace(/\D/g, "") })} className="font-mono" /></Field>
          <Field label="Accession numbers" hint="Only if already written in the books; else numbered for you" className="sm:col-span-2"><TextInput value={f.numbers} onChange={set("numbers")} placeholder="e.g. 0101, 0102, 0103" className="font-mono" /></Field>
        </>}
      </div>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-book" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{book ? "Save changes" : "Catalogue book"}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function Copies({ book, onIssue }: { book: LibraryBook; onIssue: (accessionNo: string) => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const add = useAddLibraryCopies();
  const upd = useUpdateLibraryCopy();
  const delCopy = useDeleteLibraryCopy();
  const [count, setCount] = useState("1");
  const [numbers, setNumbers] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const addCopies = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const n = Number(count), list = accessionList(numbers);
    if (!Number.isInteger(n) || n < 1 || n > 500) return setErr("Enter how many copies, from 1 to 500.");
    if (list.length && list.length !== n) return setErr(`Give ${n} accession number${n === 1 ? "" : "s"}, or leave them out.`);
    add.mutate({ id: book.id, data: { count: n, ...(list.length ? { accessionNumbers: list } : {}) } }, { onSuccess: () => { refresh(); setNumbers(""); setCount("1"); toast({ title: `${n} cop${n === 1 ? "y" : "ies"} added` }); }, onError: (x) => setErr(errMsg(x)) });
  };
  const removeCopy = (id: string, no: string) => delCopy.mutate({ id }, { onSuccess: () => { refresh(); toast({ title: `Copy ${no} deleted` }); }, onError: (x) => toast({ title: "Could not delete", description: errMsg(x), variant: "destructive" }) });
  const mark = (id: string, status: "available" | "damaged" | "lost" | "withdrawn") => upd.mutate({ id, data: { status } }, { onSuccess: refresh, onError: (x) => toast({ title: "Could not update", description: errMsg(x), variant: "destructive" }) });
  return (
    <div className="space-y-4 p-5 text-sm">
      <p className="text-muted-foreground">{[book.author, book.subject, book.level, book.shelf && `shelf ${book.shelf}`].filter(Boolean).join(" · ")}</p>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
        {book.copies.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2" data-testid={`copy-${c.accessionNo}`}>
            <span className="w-16 font-mono font-semibold">{c.accessionNo}</span>
            <Pill tone={COPY_STATUS[c.status]?.tone ?? "left"}>{COPY_STATUS[c.status]?.label ?? c.status}</Pill>
            <span className="flex-1 text-xs text-muted-foreground">{c.borrowerName ? `${c.borrowerName}, due ${fmtDate(c.dueDate!)}` : ""}</span>
            {c.status === "available" && <Btn className="h-7 px-2 text-xs" onClick={() => onIssue(c.accessionNo)}>Lend</Btn>}
            {c.status !== "on_loan" && (
              <NativeSelect aria-label={`Change copy ${c.accessionNo}`} value="" onChange={(e) => e.target.value && mark(c.id, e.target.value as "available")} className="h-7 w-36 text-xs">
                <option value="">Mark as…</option>
                {(["available", "damaged", "lost", "withdrawn"] as const).filter((s) => s !== c.status).map((s) => <option key={s} value={s}>{COPY_STATUS[s].label}</option>)}
              </NativeSelect>
            )}
            {c.status !== "on_loan" && <button type="button" aria-label={`Delete copy ${c.accessionNo}`} title="Delete this copy" disabled={delCopy.isPending} onClick={() => removeCopy(c.id, c.accessionNo)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" data-testid={`button-delete-copy-${c.accessionNo}`}><Trash2 className="h-3.5 w-3.5" /></button>}
          </li>
        ))}
      </ul>
      <form onSubmit={addCopies} className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
        <Field label="Add copies"><TextInput inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} className="w-20 font-mono" /></Field>
        <Field label="Accession numbers (optional)" className="min-w-[12rem] flex-1"><TextInput value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="Numbered for you if left blank" className="font-mono" /></Field>
        <Btn type="submit" variant="outline" disabled={add.isPending}><Plus className="h-4 w-4" />Add</Btn>
      </form>
      <FormError msg={err} />
    </div>
  );
}

export default function LibraryBooks() {
  usePageTitle("Library");
  const p = usePerms();
  const q = useListLibraryBooks({ query: { queryKey: getListLibraryBooksQueryKey() } });
  const s = useGetLibrarySummary({ query: { queryKey: getGetLibrarySummaryQueryKey() } });
  const [mode, setMode] = useState<"new" | LibraryBook | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LibraryBook | null>(null);
  const refresh = useRefresh();
  const { toast } = useToast();
  const delBook = useDeleteLibraryBook();
  const removeBook = (b: LibraryBook) => delBook.mutate({ id: b.id }, {
    onSuccess: () => { refresh(); toast({ title: `${b.title} deleted` }); setDeleting(null); },
    onError: (x) => { toast({ title: "Could not delete", description: errMsg(x), variant: "destructive" }); setDeleting(null); },
  });
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const all = q.data ?? [];
  const rows = all.filter((b) => (!category || b.category === category) && matches(text, b.title, b.author, b.isbn, b.subject, b.level, b.shelf, ...b.copies.map((c) => c.accessionNo)));
  const categories = useMemo(() => [...new Set(all.map((b) => b.category))].sort(), [all]);
  const { rows: pageRows, pager } = usePaged(rows, [text, category]);
  const open = all.find((b) => b.id === openId) ?? null;
  const cols = [{ key: "title", label: "Title" }, { key: "author", label: "Author" }, { key: "category", label: "Kind" }, { key: "subject", label: "Subject" }, { key: "level", label: "Level" }, { key: "isbn", label: "ISBN" }, { key: "shelf", label: "Shelf" }, { key: "copies", label: "Copies" }, { key: "available", label: "On shelf" }, { key: "accession", label: "Accession numbers" }];
  const exportRows = rows.map((b) => ({ title: b.title, author: b.author ?? "", category: b.category, subject: b.subject ?? "", level: b.level ?? "", isbn: b.isbn ?? "", shelf: b.shelf ?? "", copies: b.copies.filter((c) => c.status !== "withdrawn").length, available: b.available, accession: b.copies.map((c) => c.accessionNo).join(", ") }));
  const tiles = [
    { label: "Titles", v: s.data?.titles }, { label: "Copies", v: s.data?.copies }, { label: "On the shelf", v: s.data?.onShelf },
    { label: "Borrowed", v: s.data?.out, href: "/library/loans" }, { label: "Overdue", v: s.data?.overdue, href: "/library/loans?show=overdue", warn: !!s.data?.overdue },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Library" meta="Every book the school owns, each copy by its accession number, and who has it.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Library", cols, exportRows, "library-catalogue")}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, "library-catalogue")}>CSV</Btn>
        <Btn variant="outline" className="max-md:hidden" onClick={() => setIssuing("")} data-testid="button-lend">Lend a book</Btn>
        <Btn className="max-md:hidden" data-testid="button-new-book" onClick={() => setMode("new")}><BookPlus className="h-4 w-4" />Add book</Btn>
      </PageHeader>
      <FormDialog open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }} size="lg" title={mode === "new" ? "Catalogue a book" : mode ? `Edit ${mode.title}` : ""}>{mode && <BookForm key={mode === "new" ? "new" : mode.id} book={mode === "new" ? undefined : mode} onDone={() => setMode(null)} />}</FormDialog>
      <FormDialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }} size="lg" title={open ? open.title : ""}>{open && <Copies book={open} onIssue={(a) => { setOpenId(null); setIssuing(a); }} />}</FormDialog>
      <FormDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} title={deleting ? `Delete ${deleting.title}?` : ""}>
        {deleting && <div className="space-y-4 p-5">
          {deleting.onLoan > 0 ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">{deleting.onLoan === 1 ? "A copy is" : `${deleting.onLoan} copies are`} still borrowed: {deleting.copies.filter((c) => c.status === "on_loan").map((c) => `${c.accessionNo} with ${c.borrowerName}`).join(", ")}. Receive {deleting.onLoan === 1 ? "it" : "them"} back under Borrowed books, then delete.</p>
          ) : (
            <p className="text-sm text-muted-foreground">The book and its {deleting.copies.length} cop{deleting.copies.length === 1 ? "y" : "ies"}{deleting.copies.length ? ` (${deleting.copies.map((c) => c.accessionNo).join(", ")})` : ""} leave the catalogue. Past loans still show the title in Borrowed books, and the accession numbers aren't reused.</p>
          )}
          <FormActions><Btn variant="danger" data-testid="button-confirm-delete-book" disabled={delBook.isPending || deleting.onLoan > 0} onClick={() => removeBook(deleting)}>{delBook.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Delete book</Btn><Btn variant="ghost" onClick={() => setDeleting(null)}>Keep it</Btn></FormActions>
        </div>}
      </FormDialog>
      <FormDialog open={issuing !== null} onOpenChange={(o) => { if (!o) setIssuing(null); }} title="Lend a book">{issuing !== null && <IssueForm accessionNo={issuing} onDone={() => setIssuing(null)} />}</FormDialog>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => {
          const body = <><div className="text-xs text-muted-foreground">{t.label}</div><div className={cn("mt-1 text-2xl font-semibold tabular-nums", t.warn && "text-destructive")}>{t.v ?? "–"}</div></>;
          return t.href ? <Link key={t.label} href={t.href} className={cn("rounded-2xl border bg-card p-4 transition hover:border-primary/40", t.warn ? "border-destructive/40" : "border-border")}>{body}</Link> : <div key={t.label} className="rounded-2xl border border-border bg-card p-4">{body}</div>;
        })}
      </section>

      <Panel>
        <div className="border-b border-border/70 p-4">
          <Filters align="end" active={category ? 1 : 0} onClear={() => setCategory("")} lead={<ListSearch value={text} onChange={setText} placeholder="Search title, author, subject, ISBN or accession no." />}>
            <Field label="Kind"><NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect></Field>
          </Filters>
        </div>
        {q.isLoading ? <SkeletonRows cols={4} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<BookOpen className="h-5 w-5" />} title={all.length ? "No book matches" : "No books catalogued yet"} body="Add each title with how many copies the school has. Every copy gets an accession number to write inside it.">
            <Btn onClick={() => setMode("new")}><BookPlus className="h-4 w-4" />Add book</Btn>
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm" data-testid={`row-book-${b.id}`}>
                <button type="button" onClick={() => setOpenId(b.id)} className="min-w-[12rem] flex-1 text-left">
                  <div className="font-medium hover:underline">{b.title}</div>
                  <div className="text-xs text-muted-foreground">{[b.author, b.category, b.subject, b.level, b.shelf && `shelf ${b.shelf}`].filter(Boolean).join(" · ")}</div>
                </button>
                <span className="text-right text-xs"><b className={cn("text-base tabular-nums", b.available === 0 && "text-amber-700")}>{b.available}</b> <span className="text-muted-foreground">of {b.copies.filter((c) => c.status !== "withdrawn").length} on shelf</span></span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${b.title}`} data-testid={`button-actions-book-${b.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground max-md:border max-md:border-border max-md:p-2.5"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {b.available > 0 && <DropdownMenuItem onSelect={() => setIssuing(b.copies.find((c) => c.status === "available")?.accessionNo ?? "")}><BookUp className="h-4 w-4" />Lend a copy</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => setOpenId(b.id)}><Layers className="h-4 w-4" />Copies &amp; accession numbers</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setMode(b)} data-testid={`button-edit-book-${b.id}`}><Pencil className="h-4 w-4" />Edit details</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDeleting(b)} className="text-destructive focus:text-destructive" data-testid={`button-delete-book-${b.id}`}><Trash2 className="h-4 w-4" />Delete book</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      {p.library && <Fab testid="fab-new-book" label="Add book" icon={<Plus className="h-4 w-4" />} onClick={() => setMode("new")} />}
    </div>
  );
}
