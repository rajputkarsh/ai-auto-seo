import type { Finding } from "@awe/core";
import type { Rule } from "../rule";

/**
 * Canonical URL checks.
 *
 * Note: the extractor resolves relative canonicals against the page URL before
 * this runs, so `/pricing` arrives absolute and is NOT flagged — relative
 * canonicals are valid and search engines resolve them. `malformed_canonical`
 * therefore fires only on values that remain unusable after resolution, such as
 * a `javascript:` or `mailto:` href.
 */
export const canonicalRule: Rule = {
  id: "canonical",
  evaluate({ surface }) {
    const findings: Finding[] = [];
    const canonical = surface.canonical;

    if (canonical == null || canonical === "") {
      findings.push({
        issueType: "missing_canonical",
        severity: "high",
        url: surface.url,
        route: surface.route,
        message: "Page is missing a canonical URL; search engines may index duplicate versions.",
        evidence: { canonical: canonical ?? null },
      });
    } else if (!isAbsoluteHttpUrl(canonical)) {
      findings.push({
        issueType: "malformed_canonical",
        severity: "medium",
        url: surface.url,
        route: surface.route,
        message: `Canonical "${canonical}" is not an absolute http(s) URL and may be ignored.`,
        evidence: { canonical },
      });
    }
    return findings;
  },
};

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
