import type { Rule } from "../rule";

/**
 * Flags structured data that is present but broken.
 *
 * Deliberately does NOT flag *missing* structured data. JSON-LD is optional and
 * only meaningful for certain page types (article, product, organisation…), so
 * "no JSON-LD" fires on the majority of perfectly healthy pages — high volume,
 * low signal. Broken JSON-LD, by contrast, is an unambiguous defect: the author
 * intended rich results and will silently get none.
 */
export const structuredDataRule: Rule = {
  id: "structured-data",
  evaluate({ surface }) {
    const invalid = (surface.jsonLd ?? []).filter((block) => !block.valid);
    if (invalid.length === 0) return [];

    const errors = invalid.flatMap((block) => block.errors ?? []);
    return [
      {
        issueType: "invalid_structured_data",
        severity: "medium",
        url: surface.url,
        route: surface.route,
        message: `Page has ${invalid.length} invalid JSON-LD block(s); rich results will not be generated.`,
        evidence: { invalidCount: invalid.length, errors },
      },
    ];
  },
};
