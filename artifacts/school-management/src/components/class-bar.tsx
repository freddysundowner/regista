import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useListGrades, useListStreams, useListTerms, getListGradesQueryKey, getListStreamsQueryKey, getListTermsQueryKey, type Stream, type Term } from "@workspace/api-client-react";
import { Users } from "lucide-react";
import { NativeSelect } from "@/components/kit";
import { useSession } from "@/lib/session";

const KEY = "classwork:last";
const remembered = (): { c?: string; t?: string } => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };

export type ClassContext = { stream?: Stream; term?: Term; streams: Stream[]; terms: Term[]; loading: boolean; set: (p: { classId?: string; termId?: string }) => void };

/**
 * The class and term every Classwork page works on. Lives in the address (?class=…&term=…) so tabs and
 * links keep it, and is remembered per browser. A class teacher starts on their own class; the term
 * defaults to the current one.
 */
export function useClassContext(): ClassContext {
  const { user } = useSession();
  const [loc, navigate] = useLocation();
  const search = useSearch();
  const streams = useListStreams(undefined, { query: { queryKey: getListStreamsQueryKey() } });
  const terms = useListTerms(undefined, { query: { queryKey: getListTermsQueryKey() } });
  const grades = useListGrades({ query: { queryKey: getListGradesQueryKey() } });
  // Teaching order (PP1, PP2, Grade 1 …), then stream name.
  const sorted = useMemo(() => {
    const rank = new Map((grades.data ?? []).map((g) => [g.id, g.order]));
    return [...(streams.data ?? [])].sort((a, b) => (rank.get(a.gradeId) ?? 99) - (rank.get(b.gradeId) ?? 99) || a.name.localeCompare(b.name));
  }, [streams.data, grades.data]);
  const q = new URLSearchParams(search), last = remembered();
  const pick = <T extends { id: string }>(list: T[], ...ids: (string | null | undefined)[]) => ids.map((id) => list.find((x) => x.id === id)).find(Boolean);
  const stream = pick(sorted, q.get("class"), last.c) ?? sorted.find((s) => s.classTeacherUserId === user.id) ?? sorted[0];
  const termList = terms.data ?? [];
  const term = pick(termList, q.get("term"), last.t) ?? termList.find((t) => t.isCurrent) ?? termList[0];
  const set = (p: { classId?: string; termId?: string }) => {
    const next = new URLSearchParams(search);
    if (p.classId) next.set("class", p.classId);
    if (p.termId) next.set("term", p.termId);
    navigate(`${loc}?${next}`, { replace: true });
  };
  useEffect(() => { if (stream || term) { try { localStorage.setItem(KEY, JSON.stringify({ c: stream?.id, t: term?.id })); } catch { /* private mode */ } } }, [stream?.id, term?.id]);
  return { stream, term, streams: sorted, terms: termList, loading: streams.isLoading || terms.isLoading, set };
}

/** Class and term chooser shown at the top of every Classwork page. */
export function ClassBar({ ctx, children }: { ctx: ClassContext; children?: React.ReactNode }) {
  const { stream, term, streams, terms } = ctx;
  // Phone: the two pickers share one row without their labels (each still says what it is), with the class's details in small print under them.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:border-0 max-md:bg-transparent max-md:p-0" data-testid="class-bar">
      <label className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-muted-foreground max-md:sr-only">Class</span>
        <NativeSelect data-testid="select-class" aria-label="Class" className="h-9 w-44 font-medium max-md:w-full" value={stream?.id ?? ""} onChange={(e) => ctx.set({ classId: e.target.value })}>
          {!streams.length && <option value="">{ctx.loading ? "Loading…" : "No classes"}</option>}
          {streams.map((s) => <option key={s.id} value={s.id}>{s.gradeName} {s.name}</option>)}
        </NativeSelect>
      </label>
      <label className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-muted-foreground max-md:sr-only">Term</span>
        <NativeSelect data-testid="select-term" aria-label="Term" className="h-9 w-48 max-md:w-full" value={term?.id ?? ""} onChange={(e) => ctx.set({ termId: e.target.value })}>
          {!terms.length && <option value="">{ctx.loading ? "Loading…" : "No terms"}</option>}
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.academicYearName}{t.isCurrent ? " (current)" : ""}</option>)}
        </NativeSelect>
      </label>
      {stream && <span className="flex items-center gap-1.5 text-xs text-muted-foreground max-md:col-span-2 max-md:px-1 max-md:text-[11px]"><Users className="h-3.5 w-3.5" />{stream.studentCount} {stream.studentCount === 1 ? "learner" : "learners"} · {stream.classTeacherName ? `Class teacher ${stream.classTeacherName}` : "No class teacher"}</span>}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2 max-md:col-span-2 max-md:ml-0">{children}</div>}
    </div>
  );
}

/** Shared CBC level colours: best level green, down to red, by the scale's own order. */
const TONES = ["bg-emerald-600 text-white", "bg-emerald-500 text-white", "bg-sky-500 text-white", "bg-sky-400 text-white", "bg-amber-400 text-amber-950", "bg-amber-500 text-white", "bg-orange-500 text-white", "bg-rose-500 text-white"];
export function levelTone(index: number, count: number) {
  return TONES[Math.round((index * (TONES.length - 1)) / Math.max(1, count - 1))];
}
