import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { db, type SupportMessage, type SupportVisitor } from "@workspace/db";
import * as schemas from "@workspace/api-zod";
import { ApiError, authenticateIdentity, body, parse, send } from "../lib/core";
import { digest } from "../lib/integrations/security";
import { ROLE_NAMES } from "../lib/access";
import { platformAudit } from "../lib/platform";
import { logger } from "../lib/logger";
import { STARTER_ARTICLES, THREAD_REPLY_CAP, aiConfigured, answerFromKnowledge, brandValues, fill, published, supportModel, type Audience } from "../lib/support-ai";

// A conversation belongs to one staff member ("staff-<userId>") or one website visitor ("visitor-<visitorId>");
// the platform's support desk answers in it. Messages are never edited or deleted.
const view = (m: SupportMessage, name: string) => ({ id: m.id, body: m.body, fromSupport: m.fromSupport, byAi: m.byAi, senderName: m.fromSupport ? "Rejista Support" : name, createdAt: m.createdAt, readAt: m.readAt });
async function thread(threadId: string, name: string, readerIsSupport: boolean) {
  // Opening the conversation is what marks the other side's messages as read.
  await db.supportMessage.updateMany({ where: { threadId, fromSupport: !readerIsSupport, readAt: null }, data: { readAt: new Date() } });
  const messages = await db.supportMessage.findMany({ where: { threadId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500 });
  return messages.reverse().map(m => view(m, name));
}
const tooFast = { error: "You're sending messages too quickly. Wait a moment and try again." };

/**
 * Website visitors, before they have an account. There is no sign-in: the browser keeps a random token and
 * sends it in a header, so a visitor only ever reaches their own conversation. Limits keep it from being flooded.
 */
export const publicSupport = Router();
// A chat starts with the visitor's first message, and a whole school office can share one connection.
const startLimit = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many chats started from this connection. Try again later." } });
const visitorSendLimit = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false, message: tooFast });
const VISITOR_MESSAGE_CAP = 200;
async function visitor(req: Request): Promise<SupportVisitor> {
  const token = req.get("X-Support-Token") ?? "";
  const found = /^[A-Za-z0-9_-]{43}$/.test(token) ? await db.supportVisitor.findUnique({ where: { tokenHash: digest(token) } }) : null;
  if (!found) throw new ApiError(401, "This chat has expired. Start a new one.");
  return found;
}
/**
 * Answers from the knowledge base. Runs after the person's message is saved, so the chat never waits on it.
 * Once someone from the team has replied recently, the assistant stays out of the conversation.
 */
async function autoReply(threadId: string, audience: Audience, link: { visitorId: string } | { userId: string; schoolId: string }) {
  const recent = await db.supportMessage.findMany({ where: { threadId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12 });
  const history = recent.reverse();
  if (!history.length || history[history.length - 1].fromSupport) return;
  // A tapped question still gets its article; the assistant doesn't otherwise talk over a person who is answering.
  const personActive = history.some(m => m.fromSupport && !m.byAi && m.createdAt.getTime() > Date.now() - 30 * 60_000);
  if (await db.supportMessage.count({ where: { threadId, byAi: true } }) >= THREAD_REPLY_CAP) return;
  const reply = await answerFromKnowledge(history.map(m => ({ fromSupport: m.fromSupport, body: m.body })), audience, { articlesOnly: personActive });
  if (!reply) return;
  // The "someone will reply" line is said once, not after every message the team hasn't got to yet.
  if (reply.source === "unavailable" && history.some(m => m.byAi && m.body === reply.answer)) return;
  await db.$transaction(async tx => {
    await tx.supportMessage.create({ data: { threadId, ...link, fromSupport: true, byAi: true, body: reply.answer } });
    // Answered questions need nobody; the rest stay unread so they show up for the team.
    if (reply.answered) await tx.supportMessage.updateMany({ where: { threadId, fromSupport: false, readAt: null }, data: { readAt: new Date() } });
  });
}
const replyLater = (work: Promise<void>) => { work.catch(err => logger.warn({ err: err instanceof Error ? err.message : err }, "Support auto-reply failed")); };
const starters = async (audience: Audience) => {
  const values = await brandValues();
  return (await published(audience)).filter(a => a.isStarter).slice(0, 8).map(a => ({ id: a.id, question: fill(a.question, values) }));
};
publicSupport.get("/public/support/starters", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  send(res, "ListSupportStarters", await starters("visitors"));
});
publicSupport.post("/public/support/chat", startLimit, async (req, res) => {
  const input = body(schemas.StartVisitorChatBody.strict(), req.body);
  const token = randomBytes(32).toString("base64url");
  const created = await db.supportVisitor.create({ data: { tokenHash: digest(token), name: input.name || `Visitor ${randomInt(1000, 10000)}`, contact: input.contact || null } });
  send(res, "StartVisitorChat", { token, name: created.name }, 201);
});
publicSupport.get("/public/support/messages", async (req, res) => {
  const v = await visitor(req);
  send(res, "ListVisitorMessages", await thread(`visitor-${v.id}`, v.name, false));
});
publicSupport.post("/public/support/messages", visitorSendLimit, async (req, res) => {
  const v = await visitor(req);
  const input = body(schemas.SendVisitorMessageBody.strict(), req.body);
  if (await db.supportMessage.count({ where: { visitorId: v.id, fromSupport: false } }) >= VISITOR_MESSAGE_CAP) throw new ApiError(429, "This chat is full. Create an account or contact Rejista directly to continue.");
  const message = await db.supportMessage.create({ data: { threadId: `visitor-${v.id}`, visitorId: v.id, body: input.body } });
  send(res, "SendVisitorMessage", view(message, v.name), 201);
  replyLater(autoReply(`visitor-${v.id}`, "visitors", { visitorId: v.id }));
});

/**
 * Staff side. Mounted before the tenant guards on purpose: someone whose trial has ended, or whose school
 * is still waiting for approval, can still ask for help.
 */
export const schoolSupport = Router();
const sendLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: req => req.identity.user.id, message: tooFast });
schoolSupport.use("/support", authenticateIdentity, (req, _res, next) => {
  if (req.identity.user.role === "super_admin" || !req.identity.user.schoolId) { next(new ApiError(403, "Support chat is for school staff. Open Support in the platform console to reply.")); return; }
  next();
});
const me = (req: Request) => req.identity.user;
schoolSupport.get("/support/messages", async (req, res) => { send(res, "ListSupportMessages", await thread(`staff-${me(req).id}`, me(req).name, false)); });
schoolSupport.get("/support/starters", async (_req, res) => { send(res, "ListStaffSupportStarters", await starters("staff")); });
schoolSupport.get("/support/unread", async (req, res) => {
  send(res, "GetSupportUnread", { count: await db.supportMessage.count({ where: { threadId: `staff-${me(req).id}`, fromSupport: true, readAt: null } }) });
});
schoolSupport.post("/support/messages", sendLimit, async (req, res) => {
  const input = body(schemas.SendSupportMessageBody.strict(), req.body);
  const message = await db.supportMessage.create({ data: { threadId: `staff-${me(req).id}`, schoolId: me(req).schoolId!, userId: me(req).id, senderId: me(req).id, body: input.body } });
  send(res, "SendSupportMessage", view(message, me(req).name), 201);
  replyLater(autoReply(`staff-${me(req).id}`, "staff", { userId: me(req).id, schoolId: me(req).schoolId! }));
});

/** Support desk side. Mounted inside the platform router's owner guards. */
export const platformSupport = Router();
const ids = z.object({ threadId: z.string().regex(/^(staff|visitor)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) });
/** Who the conversation is with, and the fields a new reply in it needs. */
async function party(threadId: string) {
  const id = threadId.slice(threadId.indexOf("-") + 1);
  if (threadId.startsWith("visitor-")) {
    const v = await db.supportVisitor.findUnique({ where: { id } });
    if (!v) throw new ApiError(404, "Conversation not found");
    return { name: v.name, link: { visitorId: v.id } };
  }
  const user = await db.user.findUnique({ where: { id }, select: { id: true, name: true, schoolId: true, role: true } });
  if (!user?.schoolId || user.role === "super_admin") throw new ApiError(404, "Conversation not found");
  return { name: user.name, link: { userId: user.id, schoolId: user.schoolId } };
}
platformSupport.get("/platform/support/threads", async (_req, res) => {
  const [latest, unread] = await Promise.all([
    db.supportMessage.findMany({ distinct: ["threadId"], orderBy: [{ threadId: "asc" }, { createdAt: "desc" }], include: { user: { select: { name: true, role: true } }, school: { select: { name: true } }, visitor: { select: { name: true, contact: true } } } }),
    db.supportMessage.groupBy({ by: ["threadId"], where: { fromSupport: false, readAt: null }, _count: { _all: true } }),
  ]);
  const waiting = new Map(unread.map(u => [u.threadId, u._count._all]));
  send(res, "ListSupportThreads", latest.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(m => ({
    threadId: m.threadId, kind: m.visitor ? "visitor" : "staff",
    name: m.visitor?.name ?? m.user?.name ?? "Former staff member",
    detail: m.visitor ? m.visitor.contact ?? "Website visitor" : [ROLE_NAMES[m.user?.role ?? ""], m.school?.name].filter(Boolean).join(" · "),
    lastBody: m.body.slice(0, 160), lastAt: m.createdAt, lastFromSupport: m.fromSupport, unread: waiting.get(m.threadId) ?? 0,
  })));
});
platformSupport.get("/platform/support/unread", async (_req, res) => {
  send(res, "GetPlatformSupportUnread", { count: await db.supportMessage.count({ where: { fromSupport: false, readAt: null } }) });
});
platformSupport.get("/platform/support/threads/:threadId/messages", async (req, res) => {
  const { threadId } = parse(ids, req.params);
  send(res, "ListSupportThreadMessages", await thread(threadId, (await party(threadId)).name, true));
});
platformSupport.post("/platform/support/threads/:threadId/messages", sendLimit, async (req, res) => {
  const { threadId } = parse(ids, req.params);
  const who = await party(threadId);
  const input = body(schemas.ReplySupportThreadBody.strict(), req.body);
  const message = await db.supportMessage.create({ data: { threadId, ...who.link, senderId: req.identity.user.id, fromSupport: true, body: input.body } });
  send(res, "ReplySupportThread", view(message, who.name), 201);
});

// ---------- Knowledge base: what the assistant answers from ----------
const articleId = z.object({ articleId: z.string().uuid() });
const articles = () => db.knowledgeArticle.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
const knowledgeBase = async () => {
  const all = await articles(), have = new Set(all.map(a => a.question));
  return { aiConfigured: aiConfigured(), model: supportModel(), articles: all, missingStarters: STARTER_ARTICLES.filter(a => !have.has(a.question)).length };
};
const summary = (a: { question: string; isPublished: boolean; isStarter: boolean; audience: string }) => ({ question: a.question, isPublished: a.isPublished, isStarter: a.isStarter, audience: a.audience });
platformSupport.get("/platform/knowledge", async (_req, res) => { send(res, "GetKnowledgeBase", await knowledgeBase()); });
platformSupport.post("/platform/knowledge", async (req, res) => {
  const input = body(schemas.CreateKnowledgeArticleBody.strict(), req.body);
  const created = await db.$transaction(async tx => {
    const last = await tx.knowledgeArticle.aggregate({ _max: { position: true } });
    const article = await tx.knowledgeArticle.create({ data: { ...input, position: input.position ?? (last._max.position ?? 0) + 1 } });
    await platformAudit(tx, req.identity, "knowledge.article_created", "Knowledge base article added", null, article.id, undefined, summary(article));
    return article;
  });
  send(res, "CreateKnowledgeArticle", created, 201);
});
platformSupport.post("/platform/knowledge/seed", async (req, res) => {
  await db.$transaction(async tx => {
    // Only what isn't there yet, so articles the owner has edited are never overwritten.
    const have = new Set((await tx.knowledgeArticle.findMany({ select: { question: true } })).map(a => a.question));
    const missing = STARTER_ARTICLES.filter(a => !have.has(a.question));
    if (!missing.length) throw new ApiError(409, "Every ready-made article is already in the knowledge base.");
    const last = (await tx.knowledgeArticle.aggregate({ _max: { position: true } }))._max.position ?? 0;
    await tx.knowledgeArticle.createMany({ data: missing.map((a, i) => ({ question: a.question, answer: a.answer, isStarter: !!a.isStarter, audience: a.audience ?? "all", position: last + i + 1 })) });
    await platformAudit(tx, req.identity, "knowledge.seeded", `${missing.length} ready-made knowledge base articles added`);
  });
  send(res, "SeedKnowledgeBase", await knowledgeBase());
});
const askLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: req => req.identity.user.id, message: tooFast });
platformSupport.post("/platform/knowledge/ask", askLimit, async (req, res) => {
  const input = body(schemas.AskKnowledgeBaseBody.strict(), req.body);
  const audience = req.query.audience === "staff" ? "staff" : "visitors";
  send(res, "AskKnowledgeBase", (await answerFromKnowledge([{ fromSupport: false, body: input.body }], audience))!);
});
platformSupport.patch("/platform/knowledge/:articleId", async (req, res) => {
  const { articleId: id } = parse(articleId, req.params);
  const input = body(schemas.UpdateKnowledgeArticleBody.strict(), req.body);
  const updated = await db.$transaction(async tx => {
    const before = await tx.knowledgeArticle.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "Article not found");
    const article = await tx.knowledgeArticle.update({ where: { id }, data: input });
    await platformAudit(tx, req.identity, "knowledge.article_updated", "Knowledge base article edited", null, id, summary(before), summary(article));
    return article;
  });
  send(res, "UpdateKnowledgeArticle", updated);
});
platformSupport.delete("/platform/knowledge/:articleId", async (req, res) => {
  const { articleId: id } = parse(articleId, req.params);
  await db.$transaction(async tx => {
    const before = await tx.knowledgeArticle.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "Article not found");
    await tx.knowledgeArticle.delete({ where: { id } });
    await platformAudit(tx, req.identity, "knowledge.article_deleted", "Knowledge base article removed", null, id, summary(before));
  });
  send(res, "DeleteKnowledgeArticle", { message: "Article removed" });
});
