import { useEffect, useRef } from "react";

/**
 * Notices when someone using the app looks stuck, so the helper can speak first instead of waiting to be asked.
 * Everything here happens in the browser from what the person does on screen; nothing is recorded or sent anywhere.
 *
 * The signs it watches for:
 *  - errors:  the same page showing two or more error messages within a minute;
 *  - hunting: flicking through many pages in a short time, or bouncing back and forth between the same two;
 *  - tapping: several quick taps on the same spot, as if something is not responding;
 *  - idle:    sitting on a page (other than Home) for a while without touching anything.
 *
 * It is deliberately shy: one offer at a time, a long gap between offers, a few a day at most, and it stops for the
 * day once the person has said "no thanks" twice.
 *
 * It also stops for good once the person clearly knows their way around: after a number of things saved successfully
 * (learners admitted, payments recorded, settings changed...), or after turning offers down several times over.
 * The helper's button is still there; it just no longer opens by itself.
 */
export type NudgeReason = "errors" | "hunting" | "tapping" | "idle";
/** `ask` is the question sent for the person when they say yes; without one, yes just leaves the chat open for them to type. */
export type Nudge = { reason: NudgeReason; text: string; ask?: string };

const KEY = "rejista.help.nudges";
const GAP_MS = 10 * 60_000;      // at least this long between two offers
const DAILY_LIMIT = 3;           // offers per day
const DECLINE_LIMIT = 2;         // "no thanks" this many times ends it for the day
const SETTLE_MS = 20_000;        // nothing in the first moments after the app opens
const IDLE_MS = 75_000;
const CHECK_MS = 5_000;

const CONFIDENT_AFTER_SAVES = 8; // this many successful saves and the person is left alone
const CONFIDENT_AFTER_DECLINES = 4; // or this many "no thanks" in total

const SKILL_KEY = "rejista.help.skill";
type Skill = { saves: number; declines: number };
function skill(userId: string): Skill {
  try { const k = (JSON.parse(localStorage.getItem(SKILL_KEY) ?? "{}") as Record<string, Skill>)[userId]; if (k) return k; } catch { /* storage unavailable or unreadable */ }
  return { saves: 0, declines: 0 };
}
function learn(userId: string, change: Partial<Skill>) {
  try {
    const all = JSON.parse(localStorage.getItem(SKILL_KEY) ?? "{}") as Record<string, Skill>, was = all[userId] ?? { saves: 0, declines: 0 };
    all[userId] = { saves: was.saves + (change.saves ?? 0), declines: was.declines + (change.declines ?? 0) };
    localStorage.setItem(SKILL_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}
/** Something the person did was saved successfully. Enough of these and the offers stop. */
export const nudgeSawSave = (userId: string) => learn(userId, { saves: 1 });
/** True once this person has shown they know their way around. */
export const nudgeConfident = (userId: string) => { const k = skill(userId); return k.saves >= CONFIDENT_AFTER_SAVES || k.declines >= CONFIDENT_AFTER_DECLINES; };

type Tally = { day: string; shown: number; declined: number; last: number };
const today = () => new Date().toDateString();
function tally(): Tally {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? "null") as Tally | null;
    if (t && t.day === today()) return t;
  } catch { /* storage unavailable or unreadable */ }
  return { day: today(), shown: 0, declined: 0, last: 0 };
}
const save = (t: Tally) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* storage unavailable */ } };
/** The person turned an offer down. */
export function nudgeDeclined(userId: string) { const t = tally(); save({ ...t, declined: t.declined + 1 }); learn(userId, { declines: 1 }); }

/** The words for an offer. `page` is the page's own name ("Fees", "Learners"); it is missing on pages without one. */
export function nudgeFor(reason: NudgeReason, firstName: string, page?: string): Nudge {
  const hi = `Hi ${firstName},`, here = page && page !== "Home" ? `the ${page} page` : "this page";
  const ask = page && page !== "Home" ? `I'm on the ${page} page and I'm not sure what to do. What can I do here, step by step?` : "I'm not sure what to do next. What should I set up or do first?";
  switch (reason) {
    case "errors": return { reason, ask: `I keep getting an error on ${here}. What am I doing wrong?`, text: `${hi} it looks like something keeps going wrong on ${here}. Can I help you get it through?` };
    case "hunting": return { reason, text: `${hi} you seem to be looking for something. Tell me what you want to do and I'll point you to it.` };
    case "tapping": return { reason, ask, text: `${hi} that doesn't seem to be doing what you expect. Can I help?` };
    default: return { reason, ask, text: `${hi} still there? If you're not sure what to do next on ${here}, I can walk you through it.` };
  }
}

/**
 * Watches while `enabled`, and calls `onNudge` with the reason when the person looks stuck. `path` is the current
 * page address; `busy` is true while the helper is already open (no offer is made then).
 */
export function useHelpNudge({ enabled, userId, path, busy, onNudge }: { enabled: boolean; userId: string; path: string; busy: boolean; onNudge: (reason: NudgeReason) => void }) {
  const state = useRef({ started: Date.now(), touched: Date.now(), everTouched: false, visits: [] as { path: string; at: number }[], errors: [] as number[], taps: [] as { x: number; y: number; at: number }[], rage: 0, idleOfferedFor: "" });
  const live = useRef({ path, busy, onNudge });
  live.current = { path, busy, onNudge };

  // Each page change is a visit; a new page also clears that page's error count.
  useEffect(() => {
    const s = state.current, now = Date.now();
    s.visits = [...s.visits.filter((v) => now - v.at < 60_000), { path, at: now }];
    s.errors = [];
  }, [path]);

  useEffect(() => {
    if (!enabled) return;
    const s = state.current;
    const touch = () => { s.touched = Date.now(); s.everTouched = true; };
    const tap = (e: PointerEvent) => {
      touch();
      const now = Date.now();
      s.taps = [...s.taps.filter((t) => now - t.at < 2_000), { x: e.clientX, y: e.clientY, at: now }];
      const near = s.taps.filter((t) => Math.abs(t.x - e.clientX) < 30 && Math.abs(t.y - e.clientY) < 30);
      // Quick repeated taps on a control that is meant to be pressed again and again (a stepper, a tab) do not count.
      const target = e.target as HTMLElement | null;
      if (near.length >= 4 && !target?.closest("input, textarea, select, [role=tab], [role=radio], [data-chat-fab], [data-testid=chat-window]")) { s.rage = now; s.taps = []; }
    };
    // An error message appearing on the page: forms here show them in an element marked as an alert.
    const seen = new MutationObserver((changes) => {
      for (const c of changes) for (const n of c.addedNodes) {
        if (n instanceof HTMLElement && (n.matches("[role=alert]") || n.querySelector("[role=alert]")) && !n.closest("[data-testid=chat-window]")) s.errors.push(Date.now());
      }
    });
    seen.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pointerdown", tap, { passive: true });
    window.addEventListener("keydown", touch, { passive: true });
    window.addEventListener("scroll", touch, { passive: true, capture: true });

    const timer = window.setInterval(() => {
      const now = Date.now(), { path: here, busy: open, onNudge: offer } = live.current;
      if (open || document.hidden || now - s.started < SETTLE_MS) return;
      // The first-time setup has the whole screen and its own guidance.
      if (document.querySelector("[data-setup-flow]")) return;
      // Never on top of a form or sheet the person has open: they are in the middle of something.
      if (document.querySelector('[role="dialog"]:not([data-testid="chat-window"])')) return;
      if (nudgeConfident(userId)) return;
      const t = tally();
      if (t.shown >= DAILY_LIMIT || t.declined >= DECLINE_LIMIT || now - t.last < GAP_MS) return;

      s.errors = s.errors.filter((at) => now - at < 60_000);
      const recent = s.visits.filter((v) => now - v.at < 45_000);
      const last4 = s.visits.slice(-4).map((v) => v.path);
      const bouncing = last4.length === 4 && last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1] && now - s.visits[s.visits.length - 4].at < 30_000;
      const reason: NudgeReason | null =
        s.errors.length >= 2 ? "errors"
        : recent.length >= 6 || bouncing ? "hunting"
        : now - s.rage < 6_000 ? "tapping"
        : s.everTouched && here !== "/" && s.idleOfferedFor !== here && now - s.touched > IDLE_MS ? "idle"
        : null;
      if (!reason) return;
      if (reason === "idle") s.idleOfferedFor = here;
      s.errors = []; s.visits = s.visits.slice(-1); s.rage = 0;
      save({ ...t, shown: t.shown + 1, last: now });
      offer(reason);
    }, CHECK_MS);

    return () => {
      seen.disconnect(); window.clearInterval(timer);
      window.removeEventListener("pointerdown", tap); window.removeEventListener("keydown", touch); window.removeEventListener("scroll", touch, { capture: true });
    };
  }, [enabled, userId]);
}
