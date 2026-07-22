import type { Finding, IssueType, RemediationInstruction, SeoSurface } from "@awe/core";

/**
 * A Reasoner turns a raw Finding into an execution-agnostic RemediationInstruction.
 *
 * The default implementation is deterministic (derived from the rule + surface),
 * which keeps the common path free of LLM cost. An LLM-backed Reasoner can be
 * swapped in behind the same interface for ambiguous or generative cases without
 * changing any downstream code.
 */
export interface Reasoner {
  reason(finding: Finding, surface: SeoSurface): RemediationInstruction;
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
};

const CONFIDENCE: Partial<Record<IssueType, number>> = {
  missing_title: 0.99,
  missing_canonical: 0.98,
  noindex_unexpected: 0.97,
  missing_meta_description: 0.95,
  invalid_structured_data: 0.95,
  missing_h1: 0.93,
  malformed_canonical: 0.9,
  duplicate_title: 0.85,
  // Multiple H1s are legal under HTML5 sectioning — advisory, so a lower prior.
  multiple_h1: 0.6,
};

export const deterministicReasoner: Reasoner = {
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
    case "malformed_canonical":
      return {
        html: `<link rel="canonical" href="${surface.url}" />`,
        diffHint: "Add a canonical link in <head> pointing to the page's absolute URL.",
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

    // The cases below intentionally supply NO `html`. The patch rail inserts
    // `html` before </head>, which is only correct for a missing head tag. These
    // fixes are either replacements of an existing tag or live in the body, so
    // inserting would produce a wrong (or invalid) document. They ship as
    // guidance until the replace-in-place patch lands.
    case "noindex_unexpected":
      // Inserting a second robots meta would not help: engines honour the most
      // restrictive directive, so the existing noindex must be replaced.
      return {
        diffHint:
          'Replace the existing robots meta (or X-Robots-Tag header) with <meta name="robots" content="index, follow" />. Adding a second tag will not work — the noindex still applies.',
      };
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
