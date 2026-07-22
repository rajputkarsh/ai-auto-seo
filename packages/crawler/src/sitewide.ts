import type { SiteWideSurface } from "@awe/core";
import type { PageFetcher } from "./crawl";
import { isAllowed, parseRobots, sitemapUrlFromRobots } from "./robots";
import { countSitemapUrls } from "./sitemap";

/** Injectable fetcher so the logic is testable without network access. */
export type TextFetcher = PageFetcher;

const defaultFetcher: TextFetcher = async (url) => {
  const res = await fetch(url, { redirect: "follow" });
  return { ok: res.ok, status: res.status, text: await res.text() };
};

/**
 * Fetch the property-level facts that live outside any single page: robots.txt
 * and sitemap.xml. Used for single-page scans; `crawlSite` derives the same
 * facts as a by-product of the crawl it already performs.
 */
export async function fetchSiteWide(
  baseUrl: string,
  fetcher: TextFetcher = defaultFetcher,
): Promise<SiteWideSurface> {
  const origin = new URL(baseUrl).origin;

  const robots = await safeFetch(fetcher, `${origin}/robots.txt`);
  const sitemapFromRobots = robots === null ? undefined : sitemapUrlFromRobots(robots);
  const sitemapUrl = sitemapFromRobots ?? `${origin}/sitemap.xml`;
  const sitemap = await safeFetch(fetcher, sitemapUrl);

  const surface: SiteWideSurface = {
    robotsTxtPresent: robots !== null,
    sitemapPresent: sitemap !== null,
  };
  if (robots !== null) surface.robotsTxtBlocksAll = !isAllowed("/", parseRobots(robots));
  if (sitemap !== null) surface.sitemapUrlCount = countSitemapUrls(sitemap);
  return surface;
}

async function safeFetch(fetcher: TextFetcher, url: string): Promise<string | null> {
  try {
    const res = await fetcher(url);
    return res.ok ? res.text : null;
  } catch {
    return null;
  }
}
