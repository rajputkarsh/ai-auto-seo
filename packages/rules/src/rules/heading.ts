import type { Rule } from "../rule";

/**
 * Checks the page's primary heading.
 *
 * `missing_h1` is a solid signal — a page with no H1 gives search engines no
 * primary topic. `multiple_h1` is reported at LOW severity only: multiple H1s
 * are legal under HTML5 sectioning and Google tolerates them, so it is an
 * advisory, not a defect.
 */
export const headingRule: Rule = {
  id: "heading",
  evaluate({ surface }) {
    const count = surface.h1Count;
    if (count === undefined) return [];

    if (count === 0) {
      return [
        {
          issueType: "missing_h1",
          severity: "medium",
          url: surface.url,
          route: surface.route,
          message: "Page has no <h1>, so its primary topic is unclear to search engines.",
          evidence: { h1Count: count },
        },
      ];
    }

    if (count > 1) {
      return [
        {
          issueType: "multiple_h1",
          severity: "low",
          url: surface.url,
          route: surface.route,
          message: `Page has ${count} <h1> elements; a single primary heading is clearer.`,
          evidence: { h1Count: count },
        },
      ];
    }

    return [];
  },
};
