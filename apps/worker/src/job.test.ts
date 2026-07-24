import { InMemorySubscriptionStore, InMemoryUsageMeter, QuotaGuard } from "@awe/billing";
import type { SiteCrawlResult } from "@awe/crawler";
import { InMemoryScanStore } from "@awe/persistence";
import { describe, expect, it } from "vitest";
import { runScanJob, type ScanJobDeps } from "./job";

const crawlOf = (pages: { url: string; html: string }[]): SiteCrawlResult => ({
  baseUrl: "https://ex.com",
  pages: pages.map((p) => ({ ...p, status: 200 })),
  skipped: [],
  siteWide: { robotsTxtPresent: true, sitemapPresent: true, sitemapUrlCount: pages.length },
  discovered: pages.length,
});

interface TestDeps extends ScanJobDeps {
  scanStore: InMemoryScanStore;
  usage: InMemoryUsageMeter;
  subscriptions: InMemorySubscriptionStore;
}

// Only crawl/reasoner are overridden in tests; stores stay concrete so the
// helper can expose their in-memory-only inspection methods.
function deps(over: Pick<Partial<ScanJobDeps>, "crawl" | "reasoner"> = {}): TestDeps {
  const scanStore = new InMemoryScanStore();
  const usage = new InMemoryUsageMeter();
  const subscriptions = new InMemorySubscriptionStore();
  return {
    scanStore,
    usage,
    subscriptions,
    quota: new QuotaGuard(subscriptions, usage),
    crawl:
      over.crawl ??
      (async () =>
        crawlOf([{ url: "https://ex.com/a", html: "<html><head></head><body></body></html>" }])),
    ...(over.reasoner ? { reasoner: over.reasoner } : {}),
  };
}

const healthy = "https://ex.com/a";
const HEALTHY_HTML = `<html><head><title>A | Ex</title><meta name="description" content="d"><link rel="canonical" href="${healthy}"></head><body><h1>A</h1></body></html>`;

describe("runScanJob", () => {
  it("crawls, scans, persists, and meters in one unit", async () => {
    const d = deps();
    const result = await runScanJob({ url: "https://ex.com", orgId: "acme" }, d);

    expect(result.status).toBe("completed");
    expect(result.pages).toBe(1);
    expect(result.issues).toBeGreaterThan(0); // the bare page has issues

    // Persisted: history now exists for the property.
    expect(Object.keys(await d.scanStore.latestSurfaces("ex.com"))).toContain("https://ex.com/a");
    // Metered: one scan, one page.
    expect((await d.usage.current("acme")).scans).toBe(1);
    expect((await d.usage.current("acme")).pagesCrawled).toBe(1);
  });

  it("refuses and does not meter when the org is over quota", async () => {
    const d = deps();
    await d.subscriptions.set({ orgId: "acme", tier: "free", suspended: true });

    const result = await runScanJob({ url: "https://ex.com", orgId: "acme" }, d);

    expect(result.status).toBe("denied");
    expect(result.reason).toBe("suspended");
    expect((await d.usage.current("acme")).scans).toBe(0);
  });

  it("detects a regression against prior history on a scheduled re-run", async () => {
    // First run sees a healthy page; second run sees it broken.
    let broken = false;
    const d = deps({
      crawl: async () =>
        crawlOf([
          { url: healthy, html: broken ? "<html><head></head><body></body></html>" : HEALTHY_HTML },
        ]),
    });

    await runScanJob({ url: "https://ex.com", orgId: "acme" }, d); // baseline
    broken = true;
    const result = await runScanJob({ url: "https://ex.com", orgId: "acme" }, d);

    expect(result.regressions).toBeGreaterThan(0);
    expect((await d.usage.current("acme")).scans).toBe(2);
  });

  it("clamps pages to the plan limit", async () => {
    const d = deps({
      crawl: async (_url, opts) => {
        // The free plan cap (25) must reach the crawler as maxPages.
        expect(opts.maxPages).toBe(25);
        return crawlOf([{ url: "https://ex.com/a", html: "<html></html>" }]);
      },
    });
    await runScanJob({ url: "https://ex.com", orgId: "acme", maxPages: 999 }, d);
  });
});
