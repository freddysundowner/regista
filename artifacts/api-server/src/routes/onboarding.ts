import { Router } from "express";
import { db } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { ApiError, body, send } from "../lib/core";

const router = Router();
/** Name given to a school created at sign-up until its admin names it on the dashboard. */
export const UNNAMED_SCHOOL = "New school";
const STEPS = ["profile", "calendar", "classes", "learners", "fees", "invoices", "collections", "parents", "staff", "curriculum"] as const;
type Step = (typeof STEPS)[number];
// Learners and billing wait until the school has its register ready; Home asks for them once classes and fees exist.
const OPTIONAL = new Set<Step>(["learners", "invoices", "staff", "collections", "curriculum", "parents"]);
type State = { dismissed?: boolean; skipped?: Step[] };
const stateOf = (value: unknown): State => (value && typeof value === "object" && !Array.isArray(value) ? value as State : {});

/** Each step is done when the school's own data shows it, so the guide never needs ticking by hand. */
async function progress(schoolId: string) {
  const [school, years, terms, grades, streams, students, staff, fees, invoices, collections, bankAccounts, areas, ownMessaging, whatsapp, platformMessaging] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, onboarding: true } }),
    db.academicYear.count({ where: { schoolId } }),
    db.term.count({ where: { schoolId } }),
    db.grade.count({ where: { schoolId } }),
    db.stream.count({ where: { schoolId } }),
    db.student.count({ where: { schoolId } }),
    db.user.count({ where: { schoolId, isActive: true } }),
    db.financeRecord.count({ where: { schoolId, kind: "fee_structure" } }),
    db.financeRecord.count({ where: { schoolId, kind: "invoice" } }),
    db.integrationConfig.count({ where: { schoolId, provider: { in: ["daraja", "bank"] } } }),
    db.bankAccount.count({ where: { schoolId } }),
    db.learningArea.count({ where: { schoolId } }),
    db.messagingAccount.count({ where: { scope: schoolId, enabled: true } }),
    db.whatsappSetup.count({ where: { scope: schoolId, status: { in: ["active", "connected"] } } }),
    db.messagingAccount.count({ where: { scope: "platform", enabled: true } }),
  ]);
  const done: Record<Step, boolean> = {
    profile: school.name.trim() !== UNNAMED_SCHOOL,
    calendar: years > 0 && terms > 0,
    classes: grades > 0 && streams > 0,
    learners: students > 0,
    staff: staff > 1,
    fees: fees > 0,
    invoices: invoices > 0,
    // M-Pesa (Daraja), or a bank account added on the Bank tab (or saved the older way).
    collections: collections + bankAccounts > 0,
    curriculum: areas > 0,
    parents: ownMessaging + whatsapp + platformMessaging > 0,
  };
  const state = stateOf(school.onboarding);
  const skipped = new Set(state.skipped ?? []);
  return { dismissed: !!state.dismissed, steps: STEPS.map(id => ({ id, done: done[id], skipped: skipped.has(id), optional: OPTIONAL.has(id) })) };
}

router.get("/onboarding", async (req, res) => {
  if (!["school_admin", "principal"].includes(req.actor.user.role)) throw new ApiError(403, "The setup guide is for school administrators.");
  send(res, "GetOnboarding", await progress(req.actor.school.id));
});
router.patch("/onboarding", async (req, res) => {
  if (req.actor.user.role !== "school_admin") throw new ApiError(403, "Only school administrators can change the setup guide.");
  const input = body(schemas.UpdateOnboardingBody.strict(), req.body);
  // Any step can be skipped: the setup moves on to the next one, and Home keeps reminding about real gaps.
  const schoolId = req.actor.school.id;
  const current = stateOf((await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { onboarding: true } })).onboarding);
  const skipped = new Set(current.skipped ?? []);
  if (input.skip) skipped.add(input.skip);
  if (input.unskip) skipped.delete(input.unskip);
  await db.school.update({ where: { id: schoolId }, data: { onboarding: { dismissed: input.dismissed ?? !!current.dismissed, skipped: [...skipped] } } });
  send(res, "UpdateOnboarding", await progress(schoolId));
});

export default router;
