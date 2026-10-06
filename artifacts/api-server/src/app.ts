import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ApiError, csrf } from "./lib/core";
import { Prisma } from "@workspace/db";

const app: Express = express();
// Replit's edge proxy is the only trusted hop; req.secure honors forwarded HTTPS.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(/(\/whatsapp\/inbound\/|\/email\/unsubscribe\/|\/payments\/(?:validation|confirmation|prompt)\/|\/integrations\/leadsintel\/events\/|\/integrations\/(?:message-delivery|messaging-delivery)\/events\/|\/integrations\/kcb\/(?:account|till)-notification\/)[^/]+/, "$1[REDACTED]"),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cookieParser());
app.use(csrf);
app.use(express.json({ limit: "2mb", verify: (req, _res, bytes) => { (req as Request).rawBody = Buffer.from(bytes); } }));

app.use("/api", router);
app.use((_req, res) => { res.status(404).json({ error: "Route not found" }); });
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: "A record with this unique identifier already exists" }); return;
  }
  if ((err as { type?: string })?.type === "entity.too.large") { res.status(413).json({ error: "Request body exceeds the 2 MB limit" }); return; }
  if ((err as { type?: string })?.type === "entity.parse.failed") { res.status(400).json({ error: "Invalid JSON body" }); return; }
  req.log.error({ errorType: err instanceof Error ? err.name : "UnknownError" }, "API request failed");
  res.status(500).json({ error: "Unable to complete request" });
});

export default app;
