import type { Finding } from "@awe/core";
import type { Rule } from "../rule";

/**
 * Property-level checks driven by robots.txt / sitemap.xml.
 *
 * Stays completely silent when `siteWide` is absent — a page-only scan must not
 * infer anything about site configuration it has not fetched.
 */
export const siteWideRule: Rule = {
  id: "sitewide",
  evaluate({ surface }) {
    const site = surface.siteWide;
    if (!site) return [];

    const findings: Finding[] = [];

    if (site.robotsTxtBlocksAll === true) {
      findings.push({
        issueType: "robots_txt_blocks_crawling",
        severity: "high",
        url: surface.url,
        route: surface.route,
        message: "robots.txt disallows all crawling for every user-agent (Disallow: /).",
        evidence: { robotsTxtBlocksAll: true },
      });
    }

    // A missing robots.txt is not itself an issue (crawling is allowed by
    // default), so only an absent sitemap is reported.
    if (!site.sitemapPresent) {
      findings.push({
        issueType: "sitemap_missing",
        severity: "medium",
        url: surface.url,
        route: surface.route,
        message: "No sitemap.xml was found at the site root or referenced from robots.txt.",
        evidence: { sitemapPresent: false, robotsTxtPresent: site.robotsTxtPresent },
      });
    }

    return findings;
  },
};
