import { resolveTxt } from "node:dns/promises";
import {
  InMemorySubscriptionStore,
  InMemoryUsageMeter,
  QuotaGuard,
  resolveEntitlements,
} from "@awe/billing";
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
  type LlmReasonerEvent,
  type Reasoner,
} from "@awe/reasoning";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { AdminAuditLog, registerAdmin } from "./admin";

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

/**
 * Build a reasoner for one scan, and a getter for the LLM cost it incurred.
 *
 * The cost is captured here (via the reasoner's event hook) so it can be metered
 * as real usage — the margin story only holds if spend is measured, not assumed.
 */
function reasonerForScan(): { reasoner: Reasoner; costCents: () => number } {
  if (!llmClient) return { reasoner: deterministicReasoner, costCents: () => 0 };
  let cents = 0;
  const reasoner = createLlmReasoner({
    client: llmClient,
    governor: new CostGovernor(config.LLM_BUDGET_CENTS),
    onEvent: (event: LlmReasonerEvent) => {
      cents += event.costCents ?? 0;
    },
  });
  return { reasoner, costCents: () => cents };
}

/**
 * Billing state. Org identity is a stand-in until real auth (Phase 3): the
 * `x-awe-org` header, defaulting to "default". Everything downstream is keyed by
 * org, so swapping in authenticated identity later touches only this function.
 */
const subscriptions = new InMemorySubscriptionStore();
const usageMeter = new InMemoryUsageMeter();
const quotaGuard = new QuotaGuard(subscriptions, usageMeter);
const auditLog = new AdminAuditLog();

function orgOf(req: FastifyRequest): string {
  const header = req.headers["x-awe-org"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || "default";
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

/** GET /billing/status — the org's plan, entitlements, and usage this period. */
app.get("/billing/status", async (req) => {
  const orgId = orgOf(req);
  const sub = await subscriptions.get(orgId);
  return {
    orgId,
    tier: sub.tier,
    suspended: sub.suspended,
    entitlements: resolveEntitlements(sub),
    usage: await usageMeter.current(orgId),
  };
});

/** 402 with the deny reason when a scan is not permitted. */
async function enforceQuota(
  req: FastifyRequest,
): Promise<
  | { ok: true; orgId: string; maxPagesPerScan: number | null }
  | { ok: false; body: ReturnType<typeof errorResponse> }
> {
  const orgId = orgOf(req);
  const decision = await quotaGuard.check(orgId);
  if (!decision.allowed) {
    return { ok: false, body: errorResponse(decision.reason, decision.message) };
  }
  return { ok: true, orgId, maxPagesPerScan: decision.maxPagesPerScan };
}

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

  const gate = await enforceQuota(req);
  if (!gate.ok) {
    reply.code(402);
    return gate.body;
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
  const scan = reasonerForScan();
  const result = await runScan(html, url, { reasoner: scan.reasoner });

  // Record usage only after the work succeeded — a failed scan is never billed.
  await usageMeter.record(gate.orgId, {
    scans: 1,
    pagesCrawled: 1,
    llmCostCents: scan.costCents(),
  });

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

  const gate = await enforceQuota(req);
  if (!gate.ok) {
    reply.code(402);
    return gate.body;
  }

  const { url, concurrency, minDelayMs } = parsed.data;
  // The plan's page cap is a ceiling on the requested budget — a Free-tier
  // caller cannot ask for a 500-page crawl.
  const maxPages =
    gate.maxPagesPerScan === null
      ? parsed.data.maxPages
      : Math.min(parsed.data.maxPages ?? gate.maxPagesPerScan, gate.maxPagesPerScan);
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

  const scan = reasonerForScan();
  const result = await runSiteScan(crawl.baseUrl, crawl.pages, {
    siteWide: crawl.siteWide,
    previous,
    reasoner: scan.reasoner,
  });

  await scanStore.saveScan({
    propertyId,
    surfaces: result.pages.map((page) => page.surface),
    issueCount: result.issueCount,
  });

  // Meter after success: one scan, one page-crawl per fetched page, LLM cost.
  await usageMeter.record(gate.orgId, {
    scans: 1,
    pagesCrawled: result.pages.length,
    llmCostCents: scan.costCents(),
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

// Cross-tenant admin API (fail-closed: only mounts when STAFF_TOKEN is set).
await registerAdmin(app, {
  subscriptions,
  usage: usageMeter,
  scanStore,
  audit: auditLog,
  staffToken: config.STAFF_TOKEN,
});

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((addr) => app.log.info(`AI Website Engineer API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
