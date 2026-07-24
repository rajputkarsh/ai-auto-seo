import type { QuotaGuard, UsageMeter } from "@awe/billing";
import { crawlSite, type SiteCrawlResult } from "@awe/crawler";
import type { ScanStore } from "@awe/persistence";
import { propertyIdFromUrl } from "@awe/persistence";
import { runSiteScan } from "@awe/pipeline";
import { deterministicReasoner, type Reasoner } from "@awe/reasoning";

export interface ScanJobData {
  url: string;
  orgId?: string;
  maxPages?: number;
}

export interface ScanJobResult {
  status: "completed" | "denied";
  reason?: string;
  propertyId: string;
  pages: number;
  issues: number;
  regressions: number;
}

/**
 * Injected collaborators so the job's orchestration is unit-testable end to end
 * without Redis, a network, or a database.
 */
export interface ScanJobDeps {
  scanStore: ScanStore;
  usage: UsageMeter;
  quota: QuotaGuard;
  reasoner?: Reasoner;
  crawl?: (url: string, opts: { maxPages?: number }) => Promise<SiteCrawlResult>;
}

/**
 * The unit of scheduled monitoring: crawl a property, scan it against its own
 * history, persist the new surfaces, and meter usage.
 *
 * It mirrors the HTTP `/site-scan` path deliberately — same quota gate, same
 * regression-against-history logic, same metering — so a scan means the same
 * thing whether a user triggered it or the scheduler did.
 */
export async function runScanJob(data: ScanJobData, deps: ScanJobDeps): Promise<ScanJobResult> {
  const orgId = data.orgId ?? "default";
  const propertyId = propertyIdFromUrl(data.url);
  const crawl = deps.crawl ?? ((url, opts) => crawlSite(url, opts));

  const decision = await deps.quota.check(orgId);
  if (!decision.allowed) {
    return {
      status: "denied",
      reason: decision.reason,
      propertyId,
      pages: 0,
      issues: 0,
      regressions: 0,
    };
  }

  const maxPages =
    decision.maxPagesPerScan === null
      ? data.maxPages
      : Math.min(data.maxPages ?? decision.maxPagesPerScan, decision.maxPagesPerScan);

  const crawled = await crawl(data.url, { maxPages });
  const previous = await deps.scanStore.latestSurfaces(propertyId);

  const result = await runSiteScan(crawled.baseUrl, crawled.pages, {
    siteWide: crawled.siteWide,
    previous,
    reasoner: deps.reasoner ?? deterministicReasoner,
  });

  await deps.scanStore.saveScan({
    propertyId,
    surfaces: result.pages.map((page) => page.surface),
    issueCount: result.issueCount,
  });
  await deps.usage.record(orgId, { scans: 1, pagesCrawled: result.pages.length });

  const regressions = result.pages.reduce(
    (total, page) => total + page.items.filter((item) => item.finding.isRegression).length,
    0,
  );

  return {
    status: "completed",
    propertyId,
    pages: result.pages.length,
    issues: result.issueCount,
    regressions,
  };
}
