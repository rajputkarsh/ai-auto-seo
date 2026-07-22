import { getConfig } from "@awe/config";
import { fetchCrawl } from "@awe/crawler";
import { runScan } from "@awe/pipeline";
import Fastify from "fastify";
import { z } from "zod";

const config = getConfig();
const app = Fastify({ logger: { level: config.LOG_LEVEL } });

const scanBody = z.object({
  url: z.string().url(),
  /** Rendered HTML. When omitted, the server fetches the URL itself. */
  html: z.string().min(1).optional(),
});

/** Structured error shape shared by every failure response. */
function errorResponse(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/**
 * Minimal in-process counters (Phase 1 §12). Resets on restart — persistent
 * metrics arrive with Phase 2's datastore.
 */
const metrics = {
  scans: 0,
  findings: 0,
  byIssueType: {} as Record<string, number>,
};

app.get("/healthz", async () => ({ ok: true }));

app.get("/metrics", async () => metrics);

/**
 * POST /scan { url, html? }
 * With `html`, runs the universal pipeline on already-rendered markup.
 * Without it, fetches the URL server-side first (SSR/static; the Playwright
 * renderer for client-rendered pages arrives with Phase 2's crawler pool).
 */
app.post("/scan", async (req, reply) => {
  const parsed = scanBody.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return errorResponse("invalid_request", "Request body failed validation.", parsed.error.issues);
  }

  const { url } = parsed.data;
  let html = parsed.data.html;

  if (!html) {
    try {
      html = (await fetchCrawl(url)).html;
    } catch (err) {
      req.log.warn({ err, url }, "upstream fetch failed");
      reply.code(502);
      return errorResponse("fetch_failed", `Could not fetch ${url}.`);
    }
  }

  const startedAt = Date.now();
  const result = await runScan(html, url);

  metrics.scans += 1;
  metrics.findings += result.items.length;
  for (const item of result.items) {
    const key = item.finding.issueType;
    metrics.byIssueType[key] = (metrics.byIssueType[key] ?? 0) + 1;
  }
  req.log.info(
    { url, findings: result.items.length, durationMs: Date.now() - startedAt },
    "scan complete",
  );

  return result;
});

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((addr) => app.log.info(`AI Website Engineer API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
