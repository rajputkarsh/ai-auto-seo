import { describe, expect, it } from "vitest";
import {
  blocksAllCrawling,
  countSitemapUrls,
  fetchSiteWide,
  sitemapUrlFromRobots,
  type TextFetcher,
} from "./sitewide";

describe("blocksAllCrawling", () => {
  it("detects a wildcard site-wide disallow", () => {
    expect(blocksAllCrawling("User-agent: *\nDisallow: /")).toBe(true);
  });

  it("ignores a disallow aimed at a single named bot", () => {
    // Blocking one crawler is a deliberate choice, not a site-wide outage.
    expect(blocksAllCrawling("User-agent: BadBot\nDisallow: /")).toBe(false);
  });

  it("is not fooled by a scoped disallow", () => {
    expect(blocksAllCrawling("User-agent: *\nDisallow: /admin/")).toBe(false);
  });

  it("respects an explicit allow of the root", () => {
    expect(blocksAllCrawling("User-agent: *\nDisallow: /\nAllow: /")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    expect(blocksAllCrawling("# comment\n\nUser-agent: *\nDisallow: / # block all")).toBe(true);
  });
});

describe("sitemapUrlFromRobots", () => {
  it("extracts a sitemap declaration", () => {
    expect(sitemapUrlFromRobots("User-agent: *\nSitemap: https://x.com/sitemap_index.xml")).toBe(
      "https://x.com/sitemap_index.xml",
    );
  });

  it("returns undefined when absent", () => {
    expect(sitemapUrlFromRobots("User-agent: *\nDisallow:")).toBeUndefined();
  });
});

describe("countSitemapUrls", () => {
  it("counts loc entries", () => {
    expect(
      countSitemapUrls("<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>"),
    ).toBe(2);
  });
});

describe("fetchSiteWide", () => {
  const fetcherFor = (routes: Record<string, string>): TextFetcher => {
    return async (url) => {
      const text = routes[url];
      if (text === undefined) return { ok: false, status: 404, text: "" };
      return { ok: true, status: 200, text };
    };
  };

  it("reports a healthy site", async () => {
    const site = await fetchSiteWide(
      "https://x.com/page",
      fetcherFor({
        "https://x.com/robots.txt": "User-agent: *\nDisallow:",
        "https://x.com/sitemap.xml": "<urlset><url><loc>https://x.com/</loc></url></urlset>",
      }),
    );
    expect(site).toEqual({
      robotsTxtPresent: true,
      robotsTxtBlocksAll: false,
      sitemapPresent: true,
      sitemapUrlCount: 1,
    });
  });

  it("follows the Sitemap declaration in robots.txt", async () => {
    const site = await fetchSiteWide(
      "https://x.com/",
      fetcherFor({
        "https://x.com/robots.txt": "Sitemap: https://cdn.x.com/sm.xml",
        "https://cdn.x.com/sm.xml": "<urlset><url><loc>a</loc></url></urlset>",
        // No /sitemap.xml at the root — only the declared URL works.
      }),
    );
    expect(site.sitemapPresent).toBe(true);
  });

  it("reports a blocked site with no sitemap", async () => {
    const site = await fetchSiteWide(
      "https://x.com/",
      fetcherFor({ "https://x.com/robots.txt": "User-agent: *\nDisallow: /" }),
    );
    expect(site.robotsTxtBlocksAll).toBe(true);
    expect(site.sitemapPresent).toBe(false);
  });

  it("survives a missing robots.txt and network errors", async () => {
    const exploding: TextFetcher = async () => {
      throw new Error("network down");
    };
    const site = await fetchSiteWide("https://x.com/", exploding);
    expect(site).toEqual({ robotsTxtPresent: false, sitemapPresent: false });
  });
});
