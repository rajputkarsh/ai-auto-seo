import type { Finding, IssueType, RemediationInstruction, SeoSurface } from "@awe/core";

/**
 * A Reasoner turns a raw Finding into an execution-agnostic RemediationInstruction.
 *
 * The default implementation is deterministic (derived from the rule + surface),
 * which keeps the common path free of LLM cost. An LLM-backed Reasoner can be
 * swapped in behind the same interface for ambiguous or generative cases without
 * changing any downstream code.
 */
/** Optional page context a reasoner may use. Ignored by the deterministic one. */
export interface ReasoningContext {
  /** Visible text of the page, truncated — lets a model write real copy. */
  pageText?: string;
}

export interface Reasoner {
  /**
   * May return synchronously (deterministic) or asynchronously (LLM-backed).
   * Callers must `await` the result; that single widening is all the seam
   * needed to accept a model-backed implementation.
   */
  reason(
    finding: Finding,
    surface: SeoSurface,
    context?: ReasoningContext,
  ): RemediationInstruction | Promise<RemediationInstruction>;
}

/**
 * A reasoner that is guaranteed to answer synchronously. Callers that depend on
 * an immediate result (and the deterministic reasoner's own tests) keep precise
 * typing, while still satisfying the async-tolerant `Reasoner` interface.
 */
export interface SyncReasoner extends Reasoner {
  reason(finding: Finding, surface: SeoSurface, context?: ReasoningContext): RemediationInstruction;
}

const WHY: Partial<Record<IssueType, string>> = {
  missing_title:
    "Titles are a primary ranking and click-through factor; a missing one suppresses both.",
  duplicate_title: "Duplicate titles dilute relevance signals and can split rankings across pages.",
  missing_meta_description:
    "Without a description, search engines auto-generate a lower-quality snippet, hurting CTR.",
  missing_canonical: "Without a canonical, duplicate URLs can be indexed, splitting link equity.",
  malformed_canonical:
    "A canonical that isn't a usable http(s) URL is ignored, causing duplicate indexing.",
  noindex_unexpected:
    "A noindex directive removes the page from search results entirely — if unintended, all of its traffic is lost.",
  invalid_structured_data:
    "Malformed JSON-LD is discarded, so the page silently loses any rich-result eligibility it was meant to have.",
  missing_h1: "Without an H1, search engines have no clear statement of the page's primary topic.",
  multiple_h1: "Several H1s dilute the signal of which heading states the page's primary topic.",
  sitemap_missing:
    "Without a sitemap, search engines must discover pages by crawling links alone, so new or deep pages are indexed slowly or missed.",
  robots_txt_blocks_crawling:
    "robots.txt disallows crawling of the whole site, so search engines cannot fetch any page — this removes the site from search entirely.",
  page_unavailable:
    "A page that previously resolved now returns an error, so it will be dropped from the index and any links pointing to it are wasted.",
  missing_structured_data:
    "Structured data that previously earned rich results has been removed, so those enhanced listings will disappear.",
};

const CONFIDENCE: Partial<Record<IssueType, number>> = {
  robots_txt_blocks_crawling: 0.99,
  page_unavailable: 0.99,
  missing_title: 0.99,
  missing_structured_data: 0.9,
  missing_canonical: 0.98,
  noindex_unexpected: 0.97,
  sitemap_missing: 0.9,
  missing_meta_description: 0.95,
  invalid_structured_data: 0.95,
  missing_h1: 0.93,
  malformed_canonical: 0.9,
  duplicate_title: 0.85,
  // Multiple H1s are legal under HTML5 sectioning — advisory, so a lower prior.
  multiple_h1: 0.6,
};

export const deterministicReasoner: SyncReasoner = {
  reason(finding, surface) {
    return {
      finding,
      whatIsWrong: finding.message,
      whyItMatters:
        WHY[finding.issueType] ?? "This affects how search engines understand the page.",
      expectedImpact: impactLabel(finding.severity),
      confidence: CONFIDENCE[finding.issueType] ?? 0.8,
      targetSurfaceChange: targetChange(finding.issueType, surface),
      canonicalFix: canonicalFix(finding.issueType, surface),
    };
  },
};

function impactLabel(severity: Finding["severity"]): string {
  return severity === "high" ? "High" : severity === "medium" ? "Medium" : "Low";
}

function targetChange(issue: IssueType, surface: SeoSurface): Partial<SeoSurface> {
  switch (issue) {
    case "missing_canonical":
    case "malformed_canonical":
      return { canonical: surface.url };
    case "missing_title":
      return { title: suggestTitle(surface) };
    case "missing_meta_description":
      return { description: "" };
    case "noindex_unexpected":
      return { robots: { index: true, follow: surface.robots?.follow ?? true } };
    case "missing_h1":
    case "multiple_h1":
      return { h1Count: 1 };
    default:
      return {};
  }
}

function canonicalFix(
  issue: IssueType,
  surface: SeoSurface,
): RemediationInstruction["canonicalFix"] {
  switch (issue) {
    case "missing_canonical":
      return {
        html: `<link rel="canonical" href="${surface.url}" />`,
        diffHint: "Add a canonical link in <head> pointing to the page's absolute URL.",
      };
    case "malformed_canonical":
      // A canonical tag already exists — replace it. Adding a second would
      // leave two conflicting canonicals, which engines may ignore entirely.
      return {
        html: `<link rel="canonical" href="${surface.url}" />`,
        replaceSelector: 'link[rel="canonical"]',
        diffHint: "Point the existing canonical at the page's absolute http(s) URL.",
      };
    case "missing_title":
      return {
        html: `<title>${suggestTitle(surface)}</title>`,
        diffHint: "Add a unique, descriptive <title> in <head>.",
      };
    case "missing_meta_description":
      return {
        html: `<meta name="description" content="..." />`,
        diffHint: "Add a 140–160 character meta description summarizing the page.",
      };

    // Replacements: adding a second tag would not fix these, so the existing
    // element is targeted by selector and swapped out in place.
    case "noindex_unexpected":
      // Engines honour the most restrictive directive, so a second robots meta
      // would leave the noindex in force — this must be a replacement.
      return {
        html: `<meta name="robots" content="index, ${surface.robots?.follow === false ? "nofollow" : "follow"}" />`,
        replaceSelector: 'meta[name="robots"]',
        diffHint:
          "Replace the existing robots meta so the page is indexable. Also check for an X-Robots-Tag response header, which overrides the meta tag.",
      };

    // Body-level and content fixes: the patch rail inserts into <head>, so these
    // ship as guidance only. An <h1> in <head> would be invalid, and valid
    // JSON-LD cannot be authored deterministically from the page alone.
    case "invalid_structured_data":
      return {
        diffHint:
          "Correct the malformed JSON-LD block so it parses and declares a valid @type, then re-validate with the Rich Results test.",
      };
    case "missing_h1":
      return {
        diffHint: "Add a single <h1> in the page body stating its primary topic.",
      };
    case "multiple_h1":
      return {
        diffHint:
          "Keep one <h1> as the primary heading and demote the others to <h2>/<h3> to reflect the page hierarchy.",
      };

    // Site-level fixes: these live in robots.txt / sitemap.xml, not page markup,
    // so no page patch can express them.
    case "sitemap_missing":
      return {
        diffHint:
          "Publish a sitemap.xml at the site root and reference it from robots.txt with a `Sitemap:` line.",
      };
    case "robots_txt_blocks_crawling":
      return {
        diffHint:
          "Remove the site-wide `Disallow: /` from robots.txt (or scope it to the paths that genuinely must stay private).",
      };
    case "page_unavailable":
      return {
        diffHint:
          "Restore the page, or if the removal was intentional, redirect (301) the old URL to its replacement so its links and ranking carry over.",
      };
    case "missing_structured_data":
      return {
        diffHint:
          "Restore the JSON-LD block that was removed, then confirm with the Rich Results test.",
      };
    default:
      return {};
  }
}

/** Best-effort human-friendly title from the URL slug, as a starting point. */
function suggestTitle(surface: SeoSurface): string {
  try {
    const u = new URL(surface.url);
    const slug = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    const words = slug.replace(/[-_]+/g, " ").trim();
    return words.replace(/\b\w/g, (c) => c.toUpperCase()) || "Page Title";
  } catch {
    return "Page Title";
  }
}
