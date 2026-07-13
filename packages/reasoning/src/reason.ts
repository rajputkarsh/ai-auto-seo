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
  missing_title: "Titles are a primary ranking and click-through factor; a missing one suppresses both.",
  duplicate_title: "Duplicate titles dilute relevance signals and can split rankings across pages.",
  missing_meta_description: "Without a description, search engines auto-generate a lower-quality snippet, hurting CTR.",
  missing_canonical: "Without a canonical, duplicate URLs can be indexed, splitting link equity.",
  malformed_canonical: "A relative or invalid canonical is often ignored, causing duplicate indexing.",
};

const CONFIDENCE: Partial<Record<IssueType, number>> = {
  missing_title: 0.99,
  missing_canonical: 0.98,
  missing_meta_description: 0.95,
  malformed_canonical: 0.9,
  duplicate_title: 0.85,
};

export const deterministicReasoner: Reasoner = {
  reason(finding, surface) {
    return {
      finding,
      whatIsWrong: finding.message,
      whyItMatters: WHY[finding.issueType] ?? "This affects how search engines understand the page.",
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
    default:
      return {};
  }
}

function canonicalFix(issue: IssueType, surface: SeoSurface): RemediationInstruction["canonicalFix"] {
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
