import { extractSurface } from "@awe/extractor";
import { describe, expect, it } from "vitest";
import { runScan } from "./pipeline";

const HEALTHY = `<!doctype html><html><head>
  <title>Pricing | Example</title>
  <meta name="description" content="Simple per-seat pricing." />
  <link rel="canonical" href="https://ex.com/pricing" />
</head><body><h1>Pricing</h1></body></html>`;

const REGRESSED = `<!doctype html><html><head>
  <title>Pricing | Example</title>
  <meta name="description" content="Simple per-seat pricing." />
  <link rel="canonical" href="https://ex.com/pricing" />
  <meta name="robots" content="noindex" />
</head><body><h1>Pricing</h1></body></html>`;

const URL = "https://ex.com/pricing";

describe("regression detection end-to-end", () => {
  it("reports a newly introduced noindex as a regression with before/after", async () => {
    const previous = extractSurface(HEALTHY, URL);
    const res = await runScan(REGRESSED, URL, { previous });

    const item = res.items.find((i) => i.finding.issueType === "noindex_unexpected");
    expect(item?.finding.isRegression).toBe(true);
    expect(item?.finding.after).toEqual({ index: false, follow: true });
    // The user-facing card leads with the regression banner.
    expect(item?.recommendation).toContain("REGRESSION");
  });

  it("does not mark a long-standing issue as a regression", async () => {
    // noindex present in BOTH scans — broken, but not newly broken.
    const previous = extractSurface(REGRESSED, URL);
    const res = await runScan(REGRESSED, URL, { previous });

    const item = res.items.find((i) => i.finding.issueType === "noindex_unexpected");
    expect(item).toBeDefined();
    expect(item?.finding.isRegression).toBeFalsy();
    expect(item?.recommendation).not.toContain("REGRESSION");
  });

  it("finds nothing when a healthy page is unchanged", async () => {
    const previous = extractSurface(HEALTHY, URL);
    const res = await runScan(HEALTHY, URL, { previous });
    expect(res.items).toHaveLength(0);
  });

  it("behaves exactly as before when no previous surface is supplied", async () => {
    const withPrevious = await runScan(REGRESSED, URL, { previous: extractSurface(HEALTHY, URL) });
    const without = await runScan(REGRESSED, URL);
    expect(without.items.map((i) => i.finding.issueType)).toEqual(
      withPrevious.items.map((i) => i.finding.issueType),
    );
    expect(without.items.every((i) => !i.finding.isRegression)).toBe(true);
  });

  it("ranks a regression above a long-standing issue of the same severity", async () => {
    // Previously healthy; now the title is gone AND the canonical is missing.
    const previous = extractSurface(
      `<!doctype html><html><head><title>T</title></head><body><h1>x</h1></body></html>`,
      URL,
    );
    const now = `<!doctype html><html><head></head><body><h1>x</h1></body></html>`;
    const res = await runScan(now, URL, { previous });

    const high = res.items.filter((i) => i.finding.severity === "high");
    expect(high.length).toBeGreaterThan(1);
    // missing_title regressed; missing_canonical was already absent before.
    expect(high[0]?.finding.issueType).toBe("missing_title");
    expect(high[0]?.finding.isRegression).toBe(true);
  });

  it("still emits a verified patch for a regressed issue", async () => {
    const previous = extractSurface(HEALTHY, URL);
    const now = `<!doctype html><html><head>
  <title>Pricing | Example</title>
  <meta name="description" content="Simple per-seat pricing." />
</head><body><h1>Pricing</h1></body></html>`;
    const res = await runScan(now, URL, { previous });
    const item = res.items.find((i) => i.finding.issueType === "missing_canonical");
    expect(item?.finding.isRegression).toBe(true);
    expect(item?.patch).toContain('rel="canonical"');
  });
});

describe("site-wide facts via scan options", () => {
  it("applies property-level findings when siteWide is supplied", async () => {
    const res = await runScan(HEALTHY, URL, {
      siteWide: { robotsTxtPresent: true, robotsTxtBlocksAll: true, sitemapPresent: false },
    });
    const types = res.items.map((i) => i.finding.issueType);
    expect(types).toContain("robots_txt_blocks_crawling");
    expect(types).toContain("sitemap_missing");
  });

  it("stays silent about site-level facts it was not given", async () => {
    const res = await runScan(HEALTHY, URL);
    expect(res.items).toHaveLength(0);
  });
});
