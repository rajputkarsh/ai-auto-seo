import type { Rule } from "../rule";

/**
 * Flags a page that is explicitly excluded from the index.
 *
 * Only fires on an explicit `noindex` — an absent robots meta means indexable
 * by default and must stay silent. A `noindex` is sometimes intentional
 * (staging, thank-you pages), but when accidental it is the single most
 * damaging silent SEO failure, so it is reported at high severity. Phase 2's
 * regression deltas make this precise by comparing against the previous scan
 * (index true → false), rather than inferring intent from a single snapshot.
 */
export const robotsRule: Rule = {
  id: "robots",
  evaluate({ surface }) {
    if (surface.robots?.index === false) {
      return [
        {
          issueType: "noindex_unexpected",
          severity: "high",
          url: surface.url,
          route: surface.route,
          message: "Page is marked noindex, so search engines will not index it.",
          evidence: { robots: surface.robots },
        },
      ];
    }
    return [];
  },
};
