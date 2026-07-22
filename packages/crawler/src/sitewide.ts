import type { SiteWideSurface } from "@awe/core";

/** Injectable fetcher so the logic is testable without network access. */
export type TextFetcher = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

const defaultFetcher: TextFetcher = async (url) => {
  const res = await fetch(url, { redirect: "follow" });
  return { ok: res.ok, status: res.status, text: await res.text() };
};

/**
 * Fetch the property-level facts that live outside any single page:
 * robots.txt and sitemap.xml. These feed the site-wide rules.
 */
export async function fetchSiteWide(
  baseUrl: string,
  fetcher: TextFetcher = defaultFetcher,
): Promise<SiteWideSurface> {
  const origin = new URL(baseUrl).origin;

  const robots = await safeFetch(fetcher, `${origin}/robots.txt`);
  const robotsTxtPresent = robots !== null;
  const robotsTxtBlocksAll = robots === null ? undefined : blocksAllCrawling(robots);
  const sitemapFromRobots = robots === null ? undefined : sitemapUrlFromRobots(robots);

  const sitemapUrl = sitemapFromRobots ?? `${origin}/sitemap.xml`;
  const sitemap = await safeFetch(fetcher, sitemapUrl);

  const surface: SiteWideSurface = {
    robotsTxtPresent,
    sitemapPresent: sitemap !== null,
  };
  if (robotsTxtBlocksAll !== undefined) surface.robotsTxtBlocksAll = robotsTxtBlocksAll;
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

/**
 * True when the wildcard user-agent group disallows the entire site.
 *
 * Only the `*` group is considered: a `Disallow: /` aimed at one named bot is a
 * deliberate choice, not a site-wide outage, and flagging it would be noise.
 */
export function blocksAllCrawling(robotsTxt: string): boolean {
  let inWildcardGroup = false;
  let blocked = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [rawField, ...rest] = line.split(":");
    const field = rawField?.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (field === "user-agent") {
      inWildcardGroup = value === "*";
      continue;
    }
    if (!inWildcardGroup) continue;
    if (field === "disallow" && value === "/") blocked = true;
    // An explicit Allow of the root re-opens the site.
    if (field === "allow" && value === "/") blocked = false;
  }
  return blocked;
}

/** First `Sitemap:` declaration in robots.txt, if any. */
export function sitemapUrlFromRobots(robotsTxt: string): string | undefined {
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    const match = line.match(/^sitemap:\s*(\S+)/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Count <loc> entries; works for both urlset and sitemapindex documents. */
export function countSitemapUrls(sitemapXml: string): number {
  return (sitemapXml.match(/<loc>/gi) ?? []).length;
}
