import { getConfig } from "@awe/config";
import { runScan } from "@awe/pipeline";
import Fastify from "fastify";

const config = getConfig();
const app = Fastify({ logger: { level: config.LOG_LEVEL } });

app.get("/healthz", async () => ({ ok: true }));

/**
 * POST /scan { url: string, html: string }
 * Runs the universal pipeline on already-rendered HTML and returns findings,
 * instructions, and remediation artifacts. (Crawling to obtain `html` is the
 * worker's job; this endpoint keeps the API synchronous and cheap.)
 */
app.post("/scan", async (req, reply) => {
  const body = (req.body ?? {}) as { url?: string; html?: string };
  if (!body.url || !body.html) {
    reply.code(400);
    return { error: "provide { url, html }" };
  }
  return runScan(body.html, body.url);
});

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((addr) => app.log.info(`AI Website Engineer API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
