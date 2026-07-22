import type { SiteWideSurface } from "@awe/core";
import { isAllowed, parseRobots, type RobotsRules, sitemapUrlFromRobots } from "./robots";
import { countSitemapUrls, isSitemapIndex, parseSitemapUrls } from "./sitemap";

export interface FetchedResource {
  ok: boolean;
  status: number;
  text: string;
}

/** Injected so the whole crawl is testable without network access. */
export type PageFetcher = (url: string) => Promise<FetchedResource>;

export interface CrawlOptions {
  /** Hard cap on pages fetched. Protects both us and the target site. */
  maxPages?: number;
  /** Simultaneous in-flight requests. */
  concurrency?: number;
  /** Minimum gap between the START of any two requests, across all workers. */
  minDelayMs?: number;
  /** Skip URLs disallowed by robots.txt. Disable only for a site you own. */
  respectRobots?: boolean;
  fetcher?: PageFetcher;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CrawledPage {
  url: string;
  html: string;
  status: number;
}

export interface SkippedUrl {
  url: string;
  reason: "robots" | "budget" | "off-origin" | "fetch-failed";
}

export interface SiteCrawlResult {
  baseUrl: string;
  pages: CrawledPage[];
  skipped: SkippedUrl[];
  /** Property-level facts, so site-wide rules can run on this scan. */
  siteWide: SiteWideSurface;
  /** How many URLs discovery found before budget/robots filtering. */
  discovered: number;
}

const DEFAULTS = {
  maxPages: 50,
  concurrency: 4,
  minDelayMs: 200,
  respectRobots: true,
};

/**
 * Crawl a property: discover URLs, filter them, and fetch politely.
 *
 * Politeness is not optional decoration — an impolite crawler gets blocked, and
 * a blocked crawler detects nothing. Three limits apply together: a hard page
 * budget, a concurrency cap, and a global minimum gap between request starts.
 */
export async function crawlSite(
  baseUrl: string,
  options: CrawlOptions = {},
): Promise<SiteCrawlResult> {
  const {
    maxPages = DEFAULTS.maxPages,
    concurrency = DEFAULTS.concurrency,
    minDelayMs = DEFAULTS.minDelayMs,
    respectRobots = DEFAULTS.respectRobots,
    fetcher = defaultFetcher,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const origin = new URL(baseUrl).origin;
  const skipped: SkippedUrl[] = [];

  // 1. robots.txt — both a politeness contract and a source of sitemap hints.
  const robotsTxt = await safeText(fetcher, `${origin}/robots.txt`);
  const rules: RobotsRules = robotsTxt ? parseRobots(robotsTxt) : { allow: [], disallow: [] };

  // 2. Discover candidate URLs.
  const sitemapUrl = (robotsTxt && sitemapUrlFromRobots(robotsTxt)) || `${origin}/sitemap.xml`;
  const sitemapXml = await safeText(fetcher, sitemapUrl);
  const discovered = await discoverUrls(baseUrl, sitemapXml, fetcher);

  // 3. Filter: same origin, robots-allowed, then budget.
  const candidates: string[] = [];
  for (const url of discovered) {
    if (!sameOrigin(url, origin)) {
      skipped.push({ url, reason: "off-origin" });
      continue;
    }
    if (respectRobots && !isAllowed(new URL(url).pathname, rules)) {
      skipped.push({ url, reason: "robots" });
      continue;
    }
    if (candidates.length >= maxPages) {
      skipped.push({ url, reason: "budget" });
      continue;
    }
    candidates.push(url);
  }

  // 4. Fetch, rate-limited and concurrency-capped.
  const throttle = createThrottle(minDelayMs, now, sleep);
  const results = await pooled(candidates, concurrency, async (url) => {
    await throttle();
    try {
      const response = await fetcher(url);
      if (!response.ok) {
        skipped.push({ url, reason: "fetch-failed" });
        return undefined;
      }
      return { url, html: response.text, status: response.status };
    } catch {
      skipped.push({ url, reason: "fetch-failed" });
      return undefined;
    }
  });

  const siteWide: SiteWideSurface = {
    robotsTxtPresent: robotsTxt !== null,
    sitemapPresent: sitemapXml !== null,
  };
  if (robotsTxt !== null) siteWide.robotsTxtBlocksAll = !isAllowed("/", rules);
  if (sitemapXml !== null) siteWide.sitemapUrlCount = countSitemapUrls(sitemapXml);

  return {
    baseUrl,
    pages: results.filter((page): page is CrawledPage => page !== undefined),
    skipped,
    siteWide,
    discovered: discovered.length,
  };
}

/**
 * Build the candidate list from the sitemap, following one level of sitemap
 * index. Falls back to the base URL alone when there is no usable sitemap, so a
 * site without one is still scannable.
 */
async function discoverUrls(
  baseUrl: string,
  sitemapXml: string | null,
  fetcher: PageFetcher,
): Promise<string[]> {
  if (!sitemapXml) return [baseUrl];

  if (isSitemapIndex(sitemapXml)) {
    const children = parseSitemapUrls(sitemapXml).slice(0, 10);
    const nested: string[] = [];
    for (const child of children) {
      const xml = await safeText(fetcher, child);
      if (xml) nested.push(...parseSitemapUrls(xml));
    }
    return dedupe(nested.length > 0 ? nested : [baseUrl]);
  }

  const urls = parseSitemapUrls(sitemapXml);
  return dedupe(urls.length > 0 ? urls : [baseUrl]);
}

/**
 * Space request starts by at least `minDelayMs` globally.
 *
 * The slot is reserved *before* awaiting, so concurrent workers queue behind
 * each other rather than all reading the same "next free" time and firing
 * together — which would defeat the limit precisely when concurrency is high.
 */
function createThrottle(
  minDelayMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    if (minDelayMs <= 0) return;
    const current = now();
    const slot = Math.max(current, nextSlot);
    nextSlot = slot + minDelayMs;
    const wait = slot - current;
    if (wait > 0) await sleep(wait);
  };
}

/** Run `worker` over items with at most `concurrency` in flight. */
async function pooled<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    (async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await worker(item);
      }
    })(),
  );

  await Promise.all(runners);
  return results;
}

async function safeText(fetcher: PageFetcher, url: string): Promise<string | null> {
  try {
    const response = await fetcher(url);
    return response.ok ? response.text : null;
  } catch {
    return null;
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

const defaultFetcher: PageFetcher = async (url) => {
  const response = await fetch(url, { redirect: "follow" });
  return { ok: response.ok, status: response.status, text: await response.text() };
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
