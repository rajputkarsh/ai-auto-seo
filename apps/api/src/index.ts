import Fastify from "fastify";
import { runScan } from "@awe/pipeline";

const app = Fastify({ logger: true });

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
  const result = await runScan(body.html, body.url);
  return result;
});

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`AI Website Engineer API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
