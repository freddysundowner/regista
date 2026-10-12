import app from "./app";
import { logger } from "./lib/logger";
import { startFinanceWorker } from "./jobs/finance";
import { startEmailWorker } from "./lib/email";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, process.env.HOST || "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startEmailWorker();
  startFinanceWorker().catch(err => logger.error({ err }, "Finance jobs unavailable; run explicit job schema installation"));
});
