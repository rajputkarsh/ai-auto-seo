import { describe, expect, it } from "vitest";
import { type CrawlOptions, crawlSite, type PageFetcher } from "./crawl";
import { isAllowed, parseRobots } from "./robots";
import { isSitemapIndex, parseSitemapUrls } from "./sitemap";

const sitemap = (urls: string[]) =>
  `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

/** Fetcher over a fixed route table; records order and peak concurrency. */
function routeFetcher(routes: Record<string, string>) {
  const requested: string[] = [];
  let inFlight = 0;
  let peakConcurrency = 0;

  const fetcher: PageFetcher = async (url) => {
    requested.push(url);
    inFlight += 1;
    peakConcurrency = Math.max(peakConcurrency, inFlight);
    await Promise.resolve(); // yield so overlapping calls are observable
    inFlight -= 1;
    const text = routes[url];
    if (text === undefined) return { ok: false, status: 404, text: "" };
    return { ok: true, status: 200, text };
  };

  return {
    fetcher,
    requested,
    get peakConcurrency() {
      return peakConcurrency;
    },
  };
}

/**
 * Frozen clock + recording sleep.
 *
 * The clock deliberately does NOT advance: that isolates the throttle's slot
 * *reservation* logic from wall-clock simulation. With time frozen, callers
 * arriving together must each be told to wait one interval more than the last —
 * which is exactly the spacing guarantee, expressed deterministically.
 */
function frozenTimer() {
  const slept: number[] = [];
  const options = {
    now: () => 0,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  } satisfies Pick<CrawlOptions, "now" | "sleep">;
  return { ...options, slept };
}

describe("parseRobots / isAllowed", () => {
  it("allows everything when the wildcard group has no rules", () => {
    expect(isAllowed("/anything", parseRobots("User-agent: Bot\nDisallow: /"))).toBe(true);
  });

  it("treats an empty Disallow as allow-all rather than deny-all", () => {
    // `Disallow:` with no value must not become a pattern matching every path.
    expect(isAllowed("/page", parseRobots("User-agent: *\nDisallow:"))).toBe(true);
  });

  it("blocks a disallowed subtree but not its siblings", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /admin/");
    expect(isAllowed("/admin/users", rules)).toBe(false);
    expect(isAllowed("/about", rules)).toBe(true);
  });

  it("lets the longest matching rule win, with Allow breaking ties", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /files/\nAllow: /files/public/");
    expect(isAllowed("/files/secret.pdf", rules)).toBe(false);
    expect(isAllowed("/files/public/report.pdf", rules)).toBe(true);
  });

  it("supports wildcards and the $ end-anchor", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    expect(isAllowed("/docs/manual.pdf", rules)).toBe(false);
    expect(isAllowed("/docs/manual.pdf.html", rules)).toBe(true);
  });
});

describe("sitemap parsing", () => {
  it("extracts and decodes loc entries", () => {
    const urls = parseSitemapUrls(sitemap(["https://x.com/a?b=1&amp;c=2"]));
    expect(urls).toEqual(["https://x.com/a?b=1&c=2"]);
  });

  it("recognises a sitemap index", () => {
    expect(isSitemapIndex("<sitemapindex><sitemap><loc>x</loc></sitemap></sitemapindex>")).toBe(
      true,
    );
    expect(isSitemapIndex(sitemap([]))).toBe(false);
  });
});

describe("crawlSite — discovery", () => {
  it("crawls every URL in the sitemap", async () => {
    const { fetcher } = routeFetcher({
      "https://x.com/robots.txt": "User-agent: *\nDisallow:",
      "https://x.com/sitemap.xml": sitemap(["https://x.com/a", "https://x.com/b"]),
      "https://x.com/a": "<html><head><title>A</title></head><body></body></html>",
      "https://x.com/b": "<html><head><title>B</title></head><body></body></html>",
    });

    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });

    expect(result.pages.map((p) => p.url).sort()).toEqual(["https://x.com/a", "https://x.com/b"]);
    expect(result.siteWide).toEqual({
      robotsTxtPresent: true,
      robotsTxtBlocksAll: false,
      sitemapPresent: true,
      sitemapUrlCount: 2,
    });
  });

  it("follows the Sitemap declaration in robots.txt", async () => {
    const { fetcher } = routeFetcher({
      "https://x.com/robots.txt": "Sitemap: https://x.com/custom-sitemap.xml",
      "https://x.com/custom-sitemap.xml": sitemap(["https://x.com/only"]),
      "https://x.com/only": "<html></html>",
    });

    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });
    expect(result.pages.map((p) => p.url)).toEqual(["https://x.com/only"]);
  });

  it("expands a sitemap index one level", async () => {
    const { fetcher } = routeFetcher({
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml":
        "<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>",
      "https://x.com/s1.xml": sitemap(["https://x.com/deep"]),
      "https://x.com/deep": "<html></html>",
    });

    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });
    expect(result.pages.map((p) => p.url)).toEqual(["https://x.com/deep"]);
  });

  it("falls back to the base URL when there is no sitemap", async () => {
    const { fetcher } = routeFetcher({ "https://x.com/": "<html></html>" });
    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });

    expect(result.pages.map((p) => p.url)).toEqual(["https://x.com/"]);
    expect(result.siteWide.sitemapPresent).toBe(false);
  });
});

describe("crawlSite — politeness and limits", () => {
  it("skips URLs disallowed by robots.txt", async () => {
    const { fetcher, requested } = routeFetcher({
      "https://x.com/robots.txt": "User-agent: *\nDisallow: /admin/",
      "https://x.com/sitemap.xml": sitemap(["https://x.com/ok", "https://x.com/admin/secret"]),
      "https://x.com/ok": "<html></html>",
      "https://x.com/admin/secret": "<html></html>",
    });

    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });

    expect(result.pages.map((p) => p.url)).toEqual(["https://x.com/ok"]);
    expect(result.skipped).toContainEqual({ url: "https://x.com/admin/secret", reason: "robots" });
    expect(requested).not.toContain("https://x.com/admin/secret");
  });

  it("never exceeds the concurrency cap", async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://x.com/p${i}`);
    const routes: Record<string, string> = {
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml": sitemap(urls),
    };
    for (const u of urls) routes[u] = "<html></html>";
    const probe = routeFetcher(routes);

    await crawlSite("https://x.com/", { fetcher: probe.fetcher, concurrency: 3, minDelayMs: 0 });

    expect(probe.peakConcurrency).toBeLessThanOrEqual(3);
  });

  it("enforces a page budget and records what it dropped", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://x.com/p${i}`);
    const routes: Record<string, string> = {
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml": sitemap(urls),
    };
    for (const u of urls) routes[u] = "<html></html>";
    const { fetcher } = routeFetcher(routes);

    const result = await crawlSite("https://x.com/", { fetcher, maxPages: 4, minDelayMs: 0 });

    expect(result.pages).toHaveLength(4);
    expect(result.discovered).toBe(10);
    expect(result.skipped.filter((s) => s.reason === "budget")).toHaveLength(6);
  });

  it("spaces request starts by the configured delay even at high concurrency", async () => {
    const urls = ["https://x.com/a", "https://x.com/b", "https://x.com/c"];
    const routes: Record<string, string> = {
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml": sitemap(urls),
    };
    for (const u of urls) routes[u] = "<html></html>";
    const { fetcher } = routeFetcher(routes);
    const timer = frozenTimer();

    await crawlSite("https://x.com/", {
      fetcher,
      concurrency: 3, // all three workers contend for a slot at once
      minDelayMs: 100,
      now: timer.now,
      sleep: timer.sleep,
    });

    // First request goes immediately; each later one is pushed a further
    // interval out, so no two requests start within 100ms of each other.
    expect(timer.slept).toEqual([100, 200]);
  });

  it("does not throttle when the delay is disabled", async () => {
    const urls = ["https://x.com/a", "https://x.com/b"];
    const routes: Record<string, string> = {
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml": sitemap(urls),
    };
    for (const u of urls) routes[u] = "<html></html>";
    const { fetcher } = routeFetcher(routes);
    const timer = frozenTimer();

    await crawlSite("https://x.com/", {
      fetcher,
      minDelayMs: 0,
      now: timer.now,
      sleep: timer.sleep,
    });

    expect(timer.slept).toEqual([]);
  });

  it("skips off-origin URLs found in a sitemap", async () => {
    const { fetcher } = routeFetcher({
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml": sitemap(["https://x.com/ok", "https://evil.com/phish"]),
      "https://x.com/ok": "<html></html>",
    });

    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });
    expect(result.skipped).toContainEqual({ url: "https://evil.com/phish", reason: "off-origin" });
  });

  it("survives individual page failures without aborting the crawl", async () => {
    const { fetcher } = routeFetcher({
      "https://x.com/robots.txt": "",
      "https://x.com/sitemap.xml": sitemap(["https://x.com/good", "https://x.com/missing"]),
      "https://x.com/good": "<html></html>",
      // /missing is absent -> 404
    });

    const result = await crawlSite("https://x.com/", { fetcher, minDelayMs: 0 });

    expect(result.pages.map((p) => p.url)).toEqual(["https://x.com/good"]);
    expect(result.skipped).toContainEqual({
      url: "https://x.com/missing",
      reason: "fetch-failed",
    });
  });
});
