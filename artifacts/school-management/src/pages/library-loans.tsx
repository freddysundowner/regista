import { useEffect, useState, type FormEvent } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLibraryLoans, getListLibraryLoansQueryKey, useIssueLibraryBook, useReturnLibraryBook, useSearchLibraryBorrowers, getSearchLibraryBorrowersQueryKey,
  getListLibraryBooksQueryKey, getGetLibrarySummaryQueryKey, type LibraryBorrower, type LibraryLoan, type ListLibraryLoansState,
} from "@workspace/api-client-react";
import { BookCheck, BookUp, Loader2, X } from "lucide-react";
import { PageHeader, Panel, SkeletonRows, ErrorState, Empty, Btn, Field, TextInput, FormError, FormActions, Pill, Fab } from "@/components/kit";
import { FormDialog } from "@/components/form-dialog";
import { ListSearch, matches } from "@/components/list-search";
import { Pager, usePaged } from "@/components/pager";
import { errMsg, fmtDate, localToday } from "@/lib/session";
import { exportCsv, exportXlsx } from "@/lib/sheets";
import { usePageTitle } from "@/lib/page-title";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const key of [getListLibraryLoansQueryKey(), getListLibraryBooksQueryKey(), getGetLibrarySummaryQueryKey()]) void qc.invalidateQueries({ queryKey: key }); };
}

function BorrowerPicker({ value, onChange }: { value: LibraryBorrower | null; onChange: (b: LibraryBorrower | null) => void }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const q = useSearchLibraryBorrowers({ q: term }, { query: { queryKey: getSearchLibraryBorrowersQueryKey({ q: term }), enabled: term.length >= 2 } });
  if (value) return (
    <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm">
      <span className="flex-1 truncate"><b>{value.name}</b> <span className="text-muted-foreground">{value.detail}</span></span>
      <button type="button" aria-label="Choose someone else" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
    </div>
  );
  return (
    <div className="space-y-1">
      <TextInput data-testid="input-borrower" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a learner's name or admission no., or a staff name" />
      {term.length >= 2 && (
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border bg-card text-sm">
          {q.isLoading ? <li className="px-3 py-2 text-muted-foreground">Searching</li> : !q.data?.length ? <li className="px-3 py-2 text-muted-foreground">Nobody matches</li> : q.data.map((b) => (
            <li key={`${b.kind}-${b.id}`}><button type="button" onClick={() => onChange(b)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" data-testid={`borrower-${b.id}`}>
              <span className="flex-1"><b>{b.name}</b> <span className="text-xs text-muted-foreground">{b.detail}</span></span>
              {b.kind === "staff" && <Pill tone="current">staff</Pill>}
              {!!b.booksOut && <span className="text-xs text-amber-700">{b.booksOut} out</span>}
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lend one copy, found by the accession number written in it. */
export function IssueForm({ accessionNo = "", onDone }: { accessionNo?: string; onDone: () => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const m = useIssueLibraryBook();
  const [acc, setAcc] = useState(accessionNo);
  const [who, setWho] = useState<LibraryBorrower | null>(null);
  const [due, setDue] = useState(addDays(localToday(), 14));
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!acc.trim()) return setErr("Enter the accession number written in the book.");
    if (!who) return setErr("Choose who is borrowing it.");
    if (due < localToday()) return setErr("The return date can't be in the past.");
    m.mutate({ data: { accessionNo: acc.trim(), dueDate: due, ...(who.kind === "learner" ? { studentId: who.id } : { userId: who.id }) } }, {
      onSuccess: (l) => { refresh(); toast({ title: `${l.title} lent to ${l.borrowerName}`, description: `Due back ${fmtDate(l.dueDate)}.` }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Accession number" required><TextInput data-testid="input-accession" autoFocus={!accessionNo} value={acc} onChange={(e) => setAcc(e.target.value)} maxLength={30} className="font-mono" placeholder="e.g. 0042" /></Field>
        <Field label="Due back" required><TextInput type="date" value={due} min={localToday()} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Borrower" required className="sm:col-span-2"><BorrowerPicker value={who} onChange={setWho} /></Field>
      </div>
      {!!who?.booksOut && <p className="text-xs text-amber-700">{who.name} already has {who.booksOut} book{who.booksOut === 1 ? "" : "s"} out.</p>}
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-loan" disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Lend book</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

function ReturnForm({ loan, onDone }: { loan: LibraryLoan; onDone: () => void }) {
  const refresh = useRefresh();
  const { toast } = useToast();
  const m = useReturnLibraryBook();
  const [state, setState] = useState<"ok" | "damaged" | "lost">("ok");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (state !== "ok" && note.trim().length < 3) return setErr(state === "lost" ? "Note what was agreed, e.g. Parent to replace the book." : "Note the damage.");
    m.mutate({ id: loan.id, data: { ...(state === "lost" ? { lost: true } : {}), ...(state === "damaged" ? { damaged: true } : {}), ...(note.trim() ? { note: note.trim() } : {}) } }, {
      onSuccess: () => { refresh(); toast({ title: state === "lost" ? "Recorded as lost" : "Book returned" }); onDone(); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  const opt = (id: typeof state, label: string) => <label className={cn("flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm", state === id ? "border-primary bg-primary/10 font-semibold" : "border-border")}><input type="radio" className="sr-only" checked={state === id} onChange={() => setState(id)} />{label}</label>;
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">Copy {loan.accessionNo}, lent {fmtDate(loan.issuedAt)}, due {fmtDate(loan.dueDate)}{loan.overdue ? ` (${loan.daysOverdue} day${loan.daysOverdue === 1 ? "" : "s"} late)` : ""}.</p>
      <div className="flex gap-2">{opt("ok", "Back in good order")}{opt("damaged", "Back damaged")}{opt("lost", "Lost")}</div>
      <Field label="Note" required={state !== "ok"}><TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={state === "lost" ? "e.g. Parent to replace the book" : state === "damaged" ? "e.g. Cover torn" : ""} /></Field>
      <FormError msg={err} />
      <FormActions><Btn type="submit" data-testid="button-save-return" variant={state === "lost" ? "danger" : "primary"} disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{state === "lost" ? "Record as lost" : "Receive book"}</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn></FormActions>
    </form>
  );
}

const TABS: { id: ListLibraryLoansState; label: string }[] = [{ id: "out", label: "Out now" }, { id: "overdue", label: "Overdue" }, { id: "returned", label: "Returned" }, { id: "lost", label: "Lost" }, { id: "all", label: "All" }];

export default function LibraryLoans() {
  usePageTitle("Borrowed books");
  const search = new URLSearchParams(useSearch());
  const [state, setState] = useState<ListLibraryLoansState>(() => (search.get("show") === "overdue" ? "overdue" : "out"));
  const q = useListLibraryLoans({ state }, { query: { queryKey: getListLibraryLoansQueryKey({ state }) } });
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState<LibraryLoan | null>(null);
  const [text, setText] = useState("");
  const rows = (q.data ?? []).filter((l) => matches(text, l.title, l.accessionNo, l.borrowerName, l.borrowerDetail));
  const { rows: pageRows, pager } = usePaged(rows, [state, text]);
  const cols = [{ key: "accessionNo", label: "Accession no." }, { key: "title", label: "Title" }, { key: "borrower", label: "Borrower" }, { key: "detail", label: "Class / role" }, { key: "issuedAt", label: "Lent" }, { key: "dueDate", label: "Due" }, { key: "returnedAt", label: "Returned" }, { key: "status", label: "Status" }];
  const exportRows = rows.map((l) => ({ accessionNo: l.accessionNo, title: l.title, borrower: l.borrowerName, detail: l.borrowerDetail ?? "", issuedAt: l.issuedAt, dueDate: l.dueDate, returnedAt: l.returnedAt ?? "", status: l.overdue ? `Overdue ${l.daysOverdue} days` : l.status }));
  return (
    <div className="space-y-5">
      <PageHeader title="Borrowed books" meta="Who has which book, and who is late bringing one back.">
        <Btn variant="outline" disabled={!rows.length} onClick={() => void exportXlsx("Borrowed books", cols, exportRows, `library-${state}`)}>Excel</Btn>
        <Btn variant="outline" disabled={!rows.length} onClick={() => exportCsv(cols, exportRows, `library-${state}`)}>CSV</Btn>
        <Btn className="max-md:hidden" data-testid="button-new-loan" onClick={() => setIssuing(true)}><BookUp className="h-4 w-4" />Lend a book</Btn>
      </PageHeader>
      <FormDialog open={issuing} onOpenChange={setIssuing} title="Lend a book">{issuing && <IssueForm onDone={() => setIssuing(false)} />}</FormDialog>
      <FormDialog open={!!returning} onOpenChange={(o) => { if (!o) setReturning(null); }} title={returning ? `${returning.title} from ${returning.borrowerName}` : ""}>{returning && <ReturnForm key={returning.id} loan={returning} onDone={() => setReturning(null)} />}</FormDialog>
      <Panel>
        <div className="space-y-3 border-b border-border/70 p-4">
          <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
            {TABS.map((t) => <button key={t.id} type="button" role="radio" aria-checked={state === t.id} onClick={() => setState(t.id)} data-testid={`tab-loans-${t.id}`} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", state === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40")}>{t.label}</button>)}
          </div>
          <ListSearch value={text} onChange={setText} placeholder="Search title, accession no. or borrower" />
        </div>
        {q.isLoading ? <SkeletonRows cols={5} /> : q.isError ? <ErrorState msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <Empty icon={<BookCheck className="h-5 w-5" />} title={state === "overdue" ? "Nothing overdue" : state === "out" ? "No books are out" : "Nothing here"} body="Lend a book by its accession number to a learner or member of staff. It shows here until it comes back.">
            <Btn onClick={() => setIssuing(true)}><BookUp className="h-4 w-4" />Lend a book</Btn>
          </Empty>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageRows.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm" data-testid={`row-loan-${l.id}`}>
                <span className="w-14 shrink-0 font-mono text-xs font-semibold">{l.accessionNo}</span>
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{l.title}</div>
                  <div className="text-xs text-muted-foreground">{l.borrowerName}{l.borrowerDetail ? ` · ${l.borrowerDetail}` : ""} · lent {fmtDate(l.issuedAt)}{l.returnedAt ? ` · back ${fmtDate(l.returnedAt)}` : ""}{l.returnNote ? ` · ${l.returnNote}` : ""}</div>
                </div>
                {l.status === "out" ? <span className={cn("text-xs", l.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>{l.overdue ? `${l.daysOverdue} day${l.daysOverdue === 1 ? "" : "s"} late` : `due ${fmtDate(l.dueDate)}`}</span>
                  : <Pill tone={l.status === "lost" ? "error" : "inactive"}>{l.status}</Pill>}
                {l.status === "out" && <Btn variant="outline" className="h-7 px-2 text-xs" data-testid={`button-return-${l.id}`} onClick={() => setReturning(l)}>Return</Btn>}
              </li>
            ))}
          </ul>
        )}
        <Pager {...pager} />
      </Panel>
      <Fab testid="fab-new-loan" label="Lend a book" icon={<BookUp className="h-4 w-4" />} onClick={() => setIssuing(true)} />
    </div>
  );
}
