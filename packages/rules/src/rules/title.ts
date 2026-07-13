import type { Finding } from "@awe/core";
import type { Rule } from "../rule";

export const titleRule: Rule = {
  id: "title",
  evaluate({ surface, siteSurfaces }) {
    const findings: Finding[] = [];

    if (!surface.title) {
      findings.push({
        issueType: "missing_title",
        severity: "high",
        url: surface.url,
        route: surface.route,
        message: "Page has no <title>, a primary ranking and click-through signal.",
      });
      return findings;
    }

    if (siteSurfaces) {
      const dupes = siteSurfaces.filter((s) => s.url !== surface.url && s.title === surface.title);
      if (dupes.length > 0) {
        findings.push({
          issueType: "duplicate_title",
          severity: "medium",
          url: surface.url,
          route: surface.route,
          message: `Title "${surface.title}" is duplicated on ${dupes.length} other page(s).`,
          evidence: { duplicateUrls: dupes.map((d) => d.url) },
        });
      }
    }
    return findings;
  },
};
