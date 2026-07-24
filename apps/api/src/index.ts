import { resolveTxt } from "node:dns/promises";
import { getConfig } from "@awe/config";
import { crawlSite, fetchCrawl } from "@awe/crawler";
import {
  type VerificationDeps,
  type VerificationMethod,
  verificationInstructions,
  verificationToken,
  verifyOwnership,
} from "@awe/ownership";
import { createScanStore, propertyIdFromUrl } from "@awe/persistence";
import { runScan, runSiteScan } from "@awe/pipeline";
import {
  CostGovernor,
  createAnthropicClient,
  createLlmReasoner,
  deterministicReasoner,
  type Reasoner,
} from "@awe/reasoning";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";

const config = getConfig();
const app = Fastify({ logger: { level: config.LOG_LEVEL } });

await app.register(rateLimit, {
  max: config.RATE_LIMIT_MAX,
  timeWindow: "1 minute",
  // statusCode must be on the returned object, otherwise Fastify's error
  // handler treats this as an unhandled error and responds 500 instead of 429.
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: {
      code: "rate_limited",
      message: `Too many requests. Retry in ${context.after}.`,
    },
  }),
});

const scanBody = z.object({
  url: z.string().url(),
  /** Rendered HTML. When omitted, the server fetches the URL itself. */
  html: z.string().min(1).optional(),
});

const propertyBody = z.object({ url: z.string().url() });

const siteScanBody = z.object({
  url: z.string().url(),
  maxPages: z.coerce.number().int().positive().max(200).optional(),
  concurrency: z.coerce.number().int().positive().max(10).optional(),
  minDelayMs: z.coerce.number().int().nonnegative().max(10_000).optional(),
});

const verifyBody = z.object({
  url: z.string().url(),
  method: z.enum(["meta", "dns", "file"]).optional(),
});

/** Structured error shape shared by every failure response. */
function errorResponse(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/** Real I/O for ownership checks. */
const verificationDeps: VerificationDeps = {
  fetchText: async (url) => (await fetchCrawl(url)).html,
  resolveTxt: (host) => resolveTxt(host),
};

/**
 * Scan history — what turns one-off scans into monitoring. In-memory unless
 * DATABASE_URL is set; both stores satisfy the same contract, so this is a
 * configuration choice, not a code path.
 */
const scanStore = await createScanStore({ databaseUrl: config.DATABASE_URL });
app.log.info(`scan store: ${config.DATABASE_URL ? "postgres" : "in-memory"}`);

/**
 * Build the reasoner from config.
 *
 * With no API key the deterministic reasoner is used (zero cost, always
 * available). With a key, the LLM reasoner runs — but a FRESH cost governor is
 * created per scan, so LLM_BUDGET_CENTS is a per-scan ceiling, and it falls back
 * to the deterministic instruction on budget exhaustion or any API error.
 */
const llmClient = config.ANTHROPIC_API_KEY
  ? createAnthropicClient(config.ANTHROPIC_API_KEY)
  : undefined;
if (llmClient) app.log.info(`llm reasoner enabled (budget ${config.LLM_BUDGET_CENTS}¢/scan)`);

function reasonerForScan(): Reasoner {
  if (!llmClient) return deterministicReasoner;
  return createLlmReasoner({
    client: llmClient,
    governor: new CostGovernor(config.LLM_BUDGET_CENTS),
  });
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
  const result = await runScan(html, url, { reasoner: reasonerForScan() });

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

/**
 * POST /site-scan { url, maxPages?, concurrency?, minDelayMs? }
 *
 * Crawls a whole property and evaluates every page together, so cross-page
 * rules (duplicate titles) and property-level rules (robots.txt, sitemap) can
 * fire — none of which a single-page scan can detect.
 */
app.post("/site-scan", async (req, reply) => {
  const parsed = siteScanBody.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return errorResponse("invalid_request", "Request body failed validation.", parsed.error.issues);
  }

  const { url, maxPages, concurrency, minDelayMs } = parsed.data;
  const startedAt = Date.now();

  let crawl: Awaited<ReturnType<typeof crawlSite>>;
  try {
    crawl = await crawlSite(url, { maxPages, concurrency, minDelayMs });
  } catch (err) {
    req.log.warn({ err, url }, "site crawl failed");
    reply.code(502);
    return errorResponse("crawl_failed", `Could not crawl ${url}.`);
  }

  // Compare against the last time we saw each page, so a second scan reports
  // what BROKE rather than repeating the same standing issues.
  const propertyId = propertyIdFromUrl(url);
  const previous = await scanStore.latestSurfaces(propertyId);

  const result = await runSiteScan(crawl.baseUrl, crawl.pages, {
    siteWide: crawl.siteWide,
    previous,
    reasoner: reasonerForScan(),
  });

  await scanStore.saveScan({
    propertyId,
    surfaces: result.pages.map((page) => page.surface),
    issueCount: result.issueCount,
  });

  const regressionCount = result.pages.reduce(
    (total, page) => total + page.items.filter((item) => item.finding.isRegression).length,
    0,
  );

  metrics.scans += 1;
  metrics.findings += result.issueCount;
  for (const page of result.pages) {
    for (const item of page.items) {
      const key = item.finding.issueType;
      metrics.byIssueType[key] = (metrics.byIssueType[key] ?? 0) + 1;
    }
  }
  req.log.info(
    {
      url,
      pages: result.pages.length,
      discovered: crawl.discovered,
      skipped: crawl.skipped.length,
      findings: result.issueCount,
      regressions: regressionCount,
      durationMs: Date.now() - startedAt,
    },
    "site scan complete",
  );

  return {
    ...result,
    regressionCount,
    crawl: { discovered: crawl.discovered, skipped: crawl.skipped },
  };
});

/**
 * GET /properties/:host/scans — scan history for a property.
 * Shows that monitoring is accumulating state, and is the data behind
 * "what changed since last time".
 */
app.get<{ Params: { host: string } }>("/properties/:host/scans", async (req) => {
  const propertyId = propertyIdFromUrl(req.params.host);
  return { propertyId, scans: await scanStore.listScans(propertyId) };
});

/**
 * POST /properties/verification-token { url }
 * Returns the token for a property plus copy-paste instructions for each proof.
 */
app.post("/properties/verification-token", async (req, reply) => {
  const parsed = propertyBody.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return errorResponse("invalid_request", "Request body failed validation.", parsed.error.issues);
  }
  const token = verificationToken(parsed.data.url, config.VERIFICATION_SECRET);
  return {
    url: parsed.data.url,
    token,
    instructions: verificationInstructions(parsed.data.url, token),
  };
});

/**
 * POST /properties/verify { url, method? }
 * Confirms the caller controls the property. Required before scheduled crawling
 * (Phase 2); one-off scans of a single URL do not need it.
 */
app.post("/properties/verify", async (req, reply) => {
  const parsed = verifyBody.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return errorResponse("invalid_request", "Request body failed validation.", parsed.error.issues);
  }
  const { url, method } = parsed.data;
  const token = verificationToken(url, config.VERIFICATION_SECRET);
  const result = await verifyOwnership(url, token, verificationDeps, method as VerificationMethod);
  req.log.info({ url, verified: result.verified, method: result.method }, "ownership check");
  return result;
});

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((addr) => app.log.info(`AI Website Engineer API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
