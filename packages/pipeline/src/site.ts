import type { Finding, SeoSurface, SiteWideSurface } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { diffSurfaces, mergeFindings } from "@awe/graph";
import { deterministicReasoner, type Reasoner } from "@awe/reasoning";
import { evaluate } from "@awe/rules";
import { prioritize, remediate, type ScanResultItem } from "./pipeline";

/** One crawled page, as produced by `@awe/crawler.crawlSite`. */
export interface SitePage {
  url: string;
  html: string;
  status?: number;
}

export interface SiteScanOptions {
  reasoner?: Reasoner;
  /** Property-level facts from the crawl, so site-wide rules can run. */
  siteWide?: SiteWideSurface;
  /** Prior surfaces keyed by URL, enabling regression detection per page. */
  previous?: Record<string, SeoSurface>;
}

export interface PageScanResult {
  url: string;
  surface: SeoSurface;
  items: ScanResultItem[];
}

export interface SiteScanResult {
  baseUrl: string;
  pages: PageScanResult[];
  /** Total findings across the property. */
  issueCount: number;
  /** Findings that only exist because several pages were seen together. */
  siteWideIssueCount: number;
}

/**
 * Scan a whole property.
 *
 * The reason this exists — and why it is not just `runScan` in a loop — is that
 * the rule engine is evaluated **once over every surface**. Site-wide rules such
 * as `duplicate_title` compare pages against their siblings; run page-by-page
 * they can never fire, because each page is its own only sibling.
 */
export async function runSiteScan(
  baseUrl: string,
  pages: SitePage[],
  options: SiteScanOptions = {},
): Promise<SiteScanResult> {
  const reasoner = options.reasoner ?? deterministicReasoner;

  const surfaces = pages.map((page) => {
    const surface = extractSurface(page.html, page.url, page.status ?? 200);
    if (options.siteWide) surface.siteWide = options.siteWide;
    return surface;
  });

  // ONE evaluation over every surface — this is what lets cross-page rules fire.
  const ruleFindings = evaluate(surfaces);

  const regressions = surfaces.flatMap((surface) => {
    const previous = options.previous?.[surface.url];
    return previous ? diffSurfaces(previous, surface) : [];
  });

  const findingsByUrl = groupByUrl(mergeFindings(ruleFindings, regressions));

  const scanned = await Promise.all(
    pages.map(async (page, index): Promise<PageScanResult> => {
      const surface = surfaces[index];
      if (!surface) return { url: page.url, surface: { url: page.url }, items: [] };

      const findings = prioritize(findingsByUrl.get(page.url) ?? []);
      return {
        url: page.url,
        surface,
        items: await remediate(findings, surface, page.html, page.url, reasoner),
      };
    }),
  );

  const issueCount = scanned.reduce((total, page) => total + page.items.length, 0);
  const siteWideIssueCount = scanned.reduce(
    (total, page) => total + page.items.filter((item) => isCrossPage(item.finding)).length,
    0,
  );

  return { baseUrl, pages: scanned, issueCount, siteWideIssueCount };
}

/** Issues that can only be detected by comparing pages to each other. */
function isCrossPage(finding: Finding): boolean {
  return finding.issueType === "duplicate_title";
}

function groupByUrl(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = grouped.get(finding.url);
    if (list) list.push(finding);
    else grouped.set(finding.url, [finding]);
  }
  return grouped;
}
