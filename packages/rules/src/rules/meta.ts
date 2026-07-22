import type { Rule } from "../rule";

export const metaDescriptionRule: Rule = {
  id: "meta-description",
  evaluate({ surface }) {
    if (!surface.description) {
      return [
        {
          issueType: "missing_meta_description",
          severity: "medium",
          url: surface.url,
          route: surface.route,
          message: "Page has no meta description; the search snippet will be auto-generated.",
        },
      ];
    }
    return [];
  },
};
