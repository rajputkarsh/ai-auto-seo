import { extractSurface } from "@awe/extractor";
import { describe, expect, it } from "vitest";
import { runScan } from "./pipeline";
import { runSiteScan, type SitePage } from "./site";

const page = (url: string, title: string, extraHead = ""): SitePage => ({
  url,
  html: `<!doctype html><html><head>
    <title>${title}</title>
    <meta name="description" content="Description for ${title}." />
    <link rel="canonical" href="${url}" />
    ${extraHead}
  </head><body><h1>${title}</h1></body></html>`,
});

describe("runSiteScan — cross-page detection", () => {
  it("flags duplicate titles that a per-page scan structurally cannot see", async () => {
    const pages = [
      page("https://shop.example.com/shirts", "Shop | Example"),
      page("https://shop.example.com/pants", "Shop | Example"),
    ];

    // Scanned individually, each page is its own only sibling — nothing to compare.
    for (const p of pages) {
      const single = await runScan(p.html, p.url);
      expect(single.items.map((i) => i.finding.issueType)).not.toContain("duplicate_title");
    }

    // Scanned together, the rule can finally fire — on BOTH pages.
    const site = await runSiteScan("https://shop.example.com", pages);
    const flagged = site.pages.filter((p) =>
      p.items.some((i) => i.finding.issueType === "duplicate_title"),
    );
    expect(flagged).toHaveLength(2);
    expect(site.siteWideIssueCount).toBe(2);
  });

  it("stays silent when every title is unique", async () => {
    const site = await runSiteScan("https://shop.example.com", [
      page("https://shop.example.com/shirts", "Shirts | Example"),
      page("https://shop.example.com/pants", "Pants | Example"),
    ]);
    expect(site.issueCount).toBe(0);
  });
});

describe("runSiteScan — per-page results", () => {
  it("attributes each finding to the page it came from", async () => {
    const site = await runSiteScan("https://x.com", [
      page("https://x.com/good", "Good Page | X"),
      { url: "https://x.com/bare", html: "<html><head></head><body></body></html>" },
    ]);

    const good = site.pages.find((p) => p.url === "https://x.com/good");
    const bare = site.pages.find((p) => p.url === "https://x.com/bare");

    expect(good?.items).toHaveLength(0);
    expect(bare?.items.map((i) => i.finding.issueType)).toEqual(
      expect.arrayContaining(["missing_title", "missing_canonical", "missing_h1"]),
    );
    expect(site.issueCount).toBe(bare?.items.length);
  });

  it("still produces verified patches per page", async () => {
    const site = await runSiteScan("https://x.com", [
      { url: "https://x.com/bare", html: "<html><head></head><body><h1>x</h1></body></html>" },
    ]);
    const canonical = site.pages[0]?.items.find((i) => i.finding.issueType === "missing_canonical");
    expect(canonical?.patch).toContain('rel="canonical"');
  });
});

describe("runSiteScan — site-wide facts and regressions", () => {
  it("applies property-level findings to every page", async () => {
    const site = await runSiteScan(
      "https://x.com",
      [page("https://x.com/a", "A | X"), page("https://x.com/b", "B | X")],
      { siteWide: { robotsTxtPresent: true, robotsTxtBlocksAll: true, sitemapPresent: false } },
    );

    for (const scanned of site.pages) {
      const types = scanned.items.map((i) => i.finding.issueType);
      expect(types).toContain("robots_txt_blocks_crawling");
      expect(types).toContain("sitemap_missing");
    }
  });

  it("detects a per-page regression against prior surfaces", async () => {
    const healthy = page("https://x.com/a", "A | X");
    const regressed: SitePage = {
      url: "https://x.com/a",
      html: healthy.html.replace('<link rel="canonical" href="https://x.com/a" />', ""),
    };

    const site = await runSiteScan("https://x.com", [regressed], {
      previous: { "https://x.com/a": extractSurface(healthy.html, healthy.url) },
    });

    const item = site.pages[0]?.items.find((i) => i.finding.issueType === "missing_canonical");
    expect(item?.finding.isRegression).toBe(true);
    expect(item?.recommendation).toContain("REGRESSION");
  });

  it("handles an empty crawl without throwing", async () => {
    const site = await runSiteScan("https://x.com", []);
    expect(site.pages).toHaveLength(0);
    expect(site.issueCount).toBe(0);
  });
});
