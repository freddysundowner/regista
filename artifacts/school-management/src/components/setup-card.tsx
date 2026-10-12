import { useQueryClient } from "@tanstack/react-query";
import { APP_INITIAL } from "@/lib/brand";
import { useUpdateOnboarding, getGetOnboardingQueryKey, getGetCurrentUserQueryKey, getGetSchoolQueryKey, useGetSchool, useLogout } from "@workspace/api-client-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { Btn } from "@/components/kit";
import { useOnboarding } from "@/components/guide";
import { FLOW, StepBody, type FlowStep } from "@/pages/school-setup";
import { usePerms } from "@/lib/session";
import { cn } from "@/lib/utils";
import { StepActionTarget } from "@/components/step-action";
import { hardReset } from "@/components/platform-kit";

/**
 * The next unfinished *required* setup step, in the order a school should do them; null when those are done.
 * Optional steps (M-Pesa and bank, WhatsApp, staff) aren't urgent, so they never take over Home: they are set up
 * from Settings and the Staff page when the school is ready.
 */
export function useNextSetupStep() {
  const p = usePerms();
  const guide = useOnboarding();
  const steps = guide.data?.steps ?? [];
  const state = (id: FlowStep) => steps.find((x) => x.id === id);
  // "Finish later" no longer exists, so an old dismissal is ignored: required steps stay until done or skipped.
  const next = p.manageSchool && guide.data ? FLOW.find((x) => !state(x.id)?.optional && !state(x.id)?.done && !state(x.id)?.skipped) ?? null : null;
  const doneCount = FLOW.filter((x) => state(x.id)?.done).length;
  return { next, doneCount, state, later: !!guide.data?.dismissed, loading: guide.enabled && !guide.data };
}

function useSetupToggle() {
  const qc = useQueryClient();
  const update = useUpdateOnboarding();
  return (data: { dismissed?: boolean; skip?: FlowStep }) => update.mutate({ data }, { onSuccess: (d) => qc.setQueryData(getGetOnboardingQueryKey(), d) });
}

/**
 * Top of "What needs you": the next setup step, open so it can be done right there.
 * "Do it later" folds it to a single row that stays first in the list until it's done.
 */
export function SetupItem() {
  const qc = useQueryClient();
  const toggle = useSetupToggle();
  const { next, doneCount, state, later } = useNextSetupStep();
  if (!next) return null;
  const index = FLOW.findIndex((x) => x.id === next.id);
  const required = FLOW.filter((x) => !state(x.id)?.optional);
  const optional = state(next.id)?.optional;
  const progress = <div className="flex gap-1" aria-hidden>{FLOW.map((x) => <span key={x.id} className={`h-1 flex-1 rounded-full ${state(x.id)?.done ? "bg-primary" : x.id === next.id ? "bg-primary/40" : "bg-muted"}`} />)}</div>;

  if (later) return (
    <button type="button" data-testid="setup-later-row" onClick={() => toggle({ dismissed: false })}
      className="group flex w-full items-center gap-4 bg-primary/[0.04] px-5 py-4 text-left transition hover:bg-primary/10">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium uppercase tracking-wide text-primary">Finish setup · {required.findIndex((x) => x.id === next.id) + 1} of {required.length}</span>
        <span className="block font-semibold">{QUESTION[next.id] ?? next.title}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Continue<ArrowRight className="h-3.5 w-3.5" /></span>
    </button>
  );

  // A finished step drops out by itself: refresh progress (and the school's name in the sidebar).
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetSchoolQueryKey() });
  };
  return (
    <div id="setup-card" className="bg-primary/[0.04]" data-testid="setup-card">
      <div className="px-5 pt-5">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <span className="font-medium uppercase tracking-wide text-primary">Set up your school · step {index + 1} of {FLOW.length}{optional ? " · optional" : ""}</span>
          <span className="text-muted-foreground">{doneCount} of {FLOW.length} done</span>
        </div>
        {progress}
        <h3 className="mt-4 text-xl font-semibold tracking-tight" data-testid="setup-step-title">{next.title}</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{next.why}</p>
      </div>
      <div className="px-5 py-5"><StepBody id={next.id} next={refresh} /></div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 px-5 py-3">
        {optional && <Btn variant="ghost" onClick={() => toggle({ skip: next.id })} data-testid="button-setup-skip">Skip this step</Btn>}
        <Btn variant="outline" onClick={() => toggle({ dismissed: true })} data-testid="button-setup-later">Do it later</Btn>
      </div>
    </div>
  );
}

/** The question each required step asks a new school. Short on purpose: the form below it says the rest. */
const QUESTION: Partial<Record<FlowStep, string>> = {
  profile: "What is the name of your school?",
  calendar: "Which term are you in now?",
  classes: "Which classes do you have?",
  learners: "Add your learners",
  fees: "What are your fees?",
  invoices: "Bill learners for this term",
};

/**
 * A new school's Home: nothing but the required setup, one question at a time, on a clean full-screen page (no
 * sidebar or banners). It ends by itself when the last required step is done; "Skip for now" opens the normal
 * Home with a "Finish setup" row to come back. Each step's main button is drawn in the footer, beside "Skip".
 *
 * On a phone it is laid out like an app screen: a slim bar with Back and the step count, the question and its
 * form in the scrolling middle, and Skip and the main button side by side at the bottom of the screen.
 */
export function Onboarding() {
  const qc = useQueryClient();
  const toggle = useSetupToggle();
  const { next, state } = useNextSetupStep();
  const school = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  const logout = useLogout({ mutation: { onSuccess: () => hardReset(qc) } });
  const required = FLOW.filter((x) => !state(x.id)?.optional);
  const [viewing, setViewing] = useState<FlowStep | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  if (!next) return null;
  const current = required.find((x) => x.id === viewing) ?? next;
  const index = required.findIndex((x) => x.id === current.id);
  const refresh = () => {
    setViewing(null);
    void qc.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetSchoolQueryKey() });
  };
  const revisiting = !!state(current.id)?.done && current.id !== next.id;
  const name = school.data?.name && school.data.name !== "New school" ? school.data.name : null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-background max-md:bottom-auto max-md:top-[var(--vvt,0px)] max-md:h-[var(--vvh,100dvh)] max-md:overscroll-contain" data-testid="onboarding" data-setup-flow>
      <header className="relative flex items-center gap-3 px-5 py-4 max-md:sticky max-md:top-0 max-md:z-10 max-md:h-14 max-md:shrink-0 max-md:bg-background max-md:px-3 max-md:py-0 sm:px-8">
        {index > 0 && <button type="button" onClick={() => setViewing(required[index - 1].id)} aria-label="Back" data-testid="button-setup-back-bar" className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:bg-muted md:hidden"><ArrowLeft className="h-5 w-5" /></button>}
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground max-md:ml-2", index > 0 && "max-md:hidden")}>{APP_INITIAL}</div>
        <span className="min-w-0 truncate font-display text-lg font-semibold tracking-tight max-md:hidden">{name ?? "Rejista"}</span>
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold md:hidden">Step {index + 1} of {required.length}</span>
        <button type="button" className="ml-auto shrink-0 whitespace-nowrap text-sm text-muted-foreground hover:text-foreground max-md:px-2 max-md:text-[13px]" disabled={logout.isPending} onClick={() => logout.mutate()} data-testid="button-logout">
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </header>

      <main className="flex w-full flex-1 flex-col px-5 pb-10 pt-6 max-md:pb-0 max-md:pt-0 sm:px-10 sm:pt-12 lg:px-16">
        <div className="mb-6 flex items-center gap-4 max-md:mb-3">
          <ol className="flex flex-1 gap-1.5" aria-label={`Setup step ${index + 1} of ${required.length}`}>
            {required.map((x, i) => {
              const reachable = !!state(x.id)?.done || !!state(x.id)?.skipped || x.id === next.id;
              return (
                <li key={x.id} className="flex-1">
                  {/* Tall tap target (phones force 44px buttons); the visible bar is the thin span inside. */}
                  <button type="button" disabled={!reachable} onClick={() => setViewing(x.id)} aria-label={x.label} title={x.label}
                    className={cn("group flex h-11 w-full items-center", reachable && "cursor-pointer")}>
                    <span className={cn("block h-1.5 w-full rounded-full transition", state(x.id)?.done ? "bg-primary" : i === index ? "bg-primary/50" : "bg-muted", reachable && "group-hover:opacity-80")} />
                  </button>
                </li>
              );
            })}
          </ol>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground max-md:hidden">{index + 1} / {required.length}</span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight max-md:text-2xl sm:text-4xl" data-testid="setup-step-title">{QUESTION[current.id] ?? current.title}</h1>
        <div className="mt-8 max-md:mt-6 max-md:pb-6">
          {revisiting && <p className="mb-4 flex items-center gap-2 text-sm text-primary"><Check className="h-4 w-4" />Done. Change it below, or continue.</p>}
          <StepActionTarget.Provider value={actionSlot}>
            <StepBody key={current.id} id={current.id} next={refresh} />
          </StepActionTarget.Provider>
        </div>

        {/* In a browser the visible area already stops above the browser's own bar, so the home-indicator gap is only added when installed as an app. */}
        <footer className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5 max-md:sticky max-md:bottom-0 max-md:-mx-5 max-md:mt-auto max-md:border-t-0 max-md:bg-background max-md:px-5 max-md:pb-1.5 max-md:pt-3 max-md:[@media(display-mode:standalone)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {index > 0 && <Btn variant="ghost" className="max-md:hidden" onClick={() => setViewing(required[index - 1].id)} data-testid="button-setup-back"><ArrowLeft className="h-4 w-4" />Back</Btn>}
          {/* Phone: one row, Skip as a quiet label on the left and the main button filling the rest. */}
          <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0 max-md:w-full max-md:flex-nowrap max-md:gap-2 max-md:[&_button]:h-12 max-md:[&_button]:flex-1 max-md:[&_button]:rounded-xl max-md:[&_button]:text-[15px]">
            {/* Skips only this step: the next one opens, and Home appears after the last. */}
            {!revisiting && <Btn variant="ghost" className="text-muted-foreground max-md:!flex-none max-md:!px-3 max-md:!text-sm" onClick={() => { setViewing(null); toggle({ skip: current.id }); }} data-testid="button-setup-skip">Skip<span className="max-md:hidden">&nbsp;this step</span></Btn>}
            {/* The step's own main button lands here; a step already done offers Continue instead. */}
            <span ref={setActionSlot} className={cn("contents", revisiting && "hidden")} />
            {revisiting && <Btn onClick={() => setViewing(null)} data-testid="button-setup-continue">Continue<ArrowRight className="h-4 w-4" /></Btn>}
          </div>
        </footer>
      </main>
    </div>
  );
}

/**
 * Shown once, right after the last setup step is finished or skipped: what is ready, what is left for later
 * (learners and billing come next, from Home), and one button into the app.
 */
export function SetupComplete({ onStart }: { onStart: () => void }) {
  const { state } = useNextSetupStep();
  const school = useGetSchool({ query: { queryKey: getGetSchoolQueryKey() } });
  const name = school.data?.name && school.data.name !== "New school" ? school.data.name : "Your school";
  const required = FLOW.filter((x) => !state(x.id)?.optional);
  const done = required.filter((x) => state(x.id)?.done);
  const later = [...required.filter((x) => !state(x.id)?.done), ...FLOW.filter((x) => ["learners", "invoices"].includes(x.id) && !state(x.id)?.done)];
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-background" data-testid="setup-complete">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-8">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">{APP_INITIAL}</div>
        <span className="font-display text-lg font-semibold tracking-tight">{name}</span>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 pb-16 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"><Check className="h-10 w-10" strokeWidth={3} /></span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">{name} is set up</h1>
        <p className="mt-2 text-muted-foreground">Everything below is saved. You can change any of it later in Settings.</p>
        {done.length > 0 && (
          <ul className="mt-8 w-full divide-y divide-border/60 rounded-2xl border border-border bg-card text-left" data-testid="setup-done-list">
            {done.map((x) => <li key={x.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={3} /><span className="font-medium">{x.label}</span></li>)}
          </ul>
        )}
        {later.length > 0 && (
          <div className="mt-4 w-full rounded-2xl bg-muted/50 px-5 py-4 text-left text-sm" data-testid="setup-later-list">
            <div className="font-medium">Next, from Home</div>
            <p className="mt-1 text-muted-foreground">{later.map((x) => x.label).join(", ")}. Each one waits in "What needs you" until it's done.</p>
          </div>
        )}
        <Btn className="mt-8 h-12 px-6 text-base" onClick={onStart} autoFocus data-testid="button-start-using">Start using Rejista<ArrowRight className="h-5 w-5" /></Btn>
      </main>
    </div>
  );
}

/**
 * Until the required setup is finished (or each step skipped), a new school's administrator sees only the setup,
 * on every page and after a refresh; "Finish later" is gone on purpose. When it ends, the success screen shows once.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const { next, loading } = useNextSetupStep();
  const [, navigate] = useLocation();
  const wasInSetup = useRef(false);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (next) wasInSetup.current = true;
    else if (wasInSetup.current && !loading) { wasInSetup.current = false; setFinished(true); }
  }, [next, loading]);
  // Hold the page blank while the guide loads, so a refresh never flashes the app before the setup.
  if (loading) return <div className="fixed inset-0 z-40 bg-background" aria-busy="true" />;
  if (next) return <Onboarding />;
  if (finished) return <SetupComplete onStart={() => { setFinished(false); navigate("/"); }} />;
  return <>{children}</>;
}
